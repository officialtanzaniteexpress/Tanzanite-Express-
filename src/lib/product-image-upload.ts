import { ProductImageMeta } from '../types/marketplace';
import { auth } from './firebase';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
export const MAX_RAW_PRODUCT_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_UPLOAD_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

export interface PreparedImageResult {
  blob: Blob;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  fileName: string;
  width?: number;
  height?: number;
}

export function validateProductImageFile(file: File): void {
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mime) && !ALLOWED_EXTENSIONS.test(file.name)) {
    throw new Error(`Unsupported file "${file.name}". Please choose a JPG, JPEG, PNG, or WEBP image.`);
  }
  if (file.size === 0) {
    throw new Error(`File "${file.name}" is empty.`);
  }
  if (file.size > MAX_RAW_PRODUCT_IMAGE_BYTES) {
    throw new Error(`Image "${file.name}" exceeds 12 MB raw upload limit.`);
  }
}

export async function optimizeProductImage(file: File): Promise<PreparedImageResult> {
  validateProductImageFile(file);

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Unable to decode image "${file.name}".`));
      el.src = objectUrl;
    });

    const maxEdge = 1600;
    let { width, height } = img;
    const needsResize = width > maxEdge || height > maxEdge;

    if (!needsResize && file.size <= 1.5 * 1024 * 1024 && ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
      const normalizedMime =
        file.type.toLowerCase() === 'image/jpg'
          ? 'image/jpeg'
          : (file.type.toLowerCase() as 'image/jpeg' | 'image/png' | 'image/webp');
      return {
        blob: file,
        mimeType: normalizedMime,
        fileName: file.name,
        width,
        height,
      };
    }

    if (needsResize) {
      const scale = Math.min(maxEdge / width, maxEdge / height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const fallbackMime =
        file.type.toLowerCase() === 'image/png'
          ? 'image/png'
          : file.type.toLowerCase() === 'image/webp'
            ? 'image/webp'
            : 'image/jpeg';
      return { blob: file, mimeType: fallbackMime, fileName: file.name, width, height };
    }

    ctx.drawImage(img, 0, 0, width, height);

    const preferPng = file.type.toLowerCase() === 'image/png' && file.size < 2.2 * 1024 * 1024;
    const targetMime: 'image/png' | 'image/webp' | 'image/jpeg' = preferPng
      ? 'image/png'
      : file.type.toLowerCase() === 'image/webp'
        ? 'image/webp'
        : 'image/jpeg';

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), targetMime, targetMime === 'image/png' ? undefined : 0.85)
    );

    if (!blob) {
      throw new Error(`Compression failed for "${file.name}".`);
    }
    if (blob.size > MAX_UPLOAD_PRODUCT_IMAGE_BYTES) {
      throw new Error(`Compressed image "${file.name}" still exceeds 5 MB limit.`);
    }

    return {
      blob,
      mimeType: targetMime,
      fileName: file.name,
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function uploadProductImageWithProgress(
  file: File,
  onProgress: (pct: number) => void,
  productId?: string
): Promise<ProductImageMeta> {
  onProgress(5);
  const prepared = await optimizeProductImage(file);
  onProgress(20);

  const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
  if (!token) {
    throw new Error('Authentication required to upload product images.');
  }

  return new Promise<ProductImageMeta>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/supplier/product-images');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', prepared.mimeType);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(prepared.fileName));
    if (productId) {
      xhr.setRequestHeader('X-Product-Id', productId);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const uploadPct = 20 + Math.round((evt.loaded / evt.total) * 75);
        onProgress(Math.min(95, uploadPct));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && data.image) {
          onProgress(100);
          resolve({
            ...data.image,
            width: prepared.width,
            height: prepared.height,
          });
        } else {
          reject(new Error(data.error || `Image upload failed (${xhr.status})`));
        }
      } catch {
        reject(new Error(`Image upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error while uploading image.'));
    xhr.send(prepared.blob);
  });
}

export async function deleteUploadedProductImage(imageId: string): Promise<void> {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
  const res = await fetch(`/api/supplier/product-images/${encodeURIComponent(imageId)}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to remove image (${res.status})`);
  }
}

export function extractMediaId(url: string): string | null {
  const match = url.trim().match(/^\/api\/media\/products\/([a-zA-Z0-9_-]{3,80})(?:\?.*)?$/);
  return match ? match[1] : null;
}

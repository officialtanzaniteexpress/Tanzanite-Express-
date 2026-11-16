import fs from 'fs';
import path from 'path';
import { PaymentSubmission, ProductImageMeta } from '../types/marketplace.ts';
import { FIREBASE_STORAGE_BUCKET, getStorageBucket } from './firebase-admin.ts';
import type { StoreSnapshot } from './store.ts';

export const PRODUCT_IMAGES_DIR = path.resolve(process.cwd(), '.mik-data', 'product-images');
export const PAYMENT_RECEIPTS_DIR = path.resolve(process.cwd(), '.mik-data', 'payment-receipts');
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB strict backend limit
export const MAX_RECEIPT_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB strict receipt limit

export type AllowedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{3,80}$/;

const storageDiag: {
  bucket: string;
  status: 'connected' | 'offline_fallback' | 'degraded';
  lastError: string | null;
  lastSuccessAt: string | null;
} = {
  bucket: FIREBASE_STORAGE_BUCKET,
  status: 'offline_fallback',
  lastError: null,
  lastSuccessAt: null,
};

function isCredentialOrBucketError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err || '').toLowerCase();
  return (
    msg.includes('could not load the default credentials') ||
    msg.includes('default credentials') ||
    msg.includes('unable to detect a project id') ||
    msg.includes('unauthenticated') ||
    msg.includes('bucket does not exist') ||
    msg.includes('does not have storage')
  );
}

export function getStorageDiagnostics() {
  return { ...storageDiag };
}

function assertSafeId(id: string, label: string): string {
  if (!SAFE_ID_REGEX.test(id)) {
    throw new Error(`Invalid ${label} identifier.`);
  }
  return id;
}

export function mimeToExtension(mime: AllowedImageMime): 'jpg' | 'png' | 'webp' {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

export function extensionToMime(ext: string): AllowedImageMime {
  const clean = ext.toLowerCase().replace(/^\./, '');
  if (clean === 'png') return 'image/png';
  if (clean === 'webp') return 'image/webp';
  return 'image/jpeg';
}

export function detectImageMimeFromBuffer(buf: Buffer): AllowedImageMime | null {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;

  // Reject HTML / SVG / XML payloads explicitly
  const headText = buf.subarray(0, Math.min(buf.length, 256)).toString('utf-8').trimStart().toLowerCase();
  if (
    headText.startsWith('<svg') ||
    headText.startsWith('<?xml') ||
    headText.startsWith('<html') ||
    headText.startsWith('<!doctype')
  ) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

export function getImageDiskPath(supplierId: string, imageId: string, mimeType: AllowedImageMime): string {
  const safeSup = assertSafeId(supplierId, 'supplier');
  const safeImg = assertSafeId(imageId, 'image');
  const ext = mimeToExtension(mimeType);
  const resolved = path.resolve(PRODUCT_IMAGES_DIR, safeSup, `${safeImg}.${ext}`);
  if (!resolved.startsWith(PRODUCT_IMAGES_DIR + path.sep)) {
    throw new Error('Unsafe storage path rejected.');
  }
  return resolved;
}

export function buildProductStoragePath(
  supplierId: string,
  imageId: string,
  mimeType: AllowedImageMime
): string {
  const safeSup = assertSafeId(supplierId, 'supplier');
  const safeImg = assertSafeId(imageId, 'image');
  const ext = mimeToExtension(mimeType);
  return `products/${safeSup}/${safeImg}.${ext}`;
}

export function saveProductImageFile(
  supplierId: string,
  imageId: string,
  mimeType: AllowedImageMime,
  buffer: Buffer
): { filePath: string; storagePath: string; sizeBytes: number } {
  if (buffer.length === 0) {
    throw new Error('Image file is empty.');
  }
  if (buffer.length > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error('Image file exceeds 5 MB maximum size.');
  }
  const detected = detectImageMimeFromBuffer(buffer);
  if (!detected || detected !== mimeType) {
    throw new Error('Image signature does not match an allowed JPG, PNG, or WEBP file.');
  }

  const filePath = getImageDiskPath(supplierId, imageId, detected);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return {
    filePath,
    storagePath: buildProductStoragePath(supplierId, imageId, detected),
    sizeBytes: buffer.length,
  };
}

export async function uploadProductImageToStorage(
  meta: ProductImageMeta,
  buffer: Buffer
): Promise<{ uploaded: boolean; storagePath: string }> {
  const storagePath =
    meta.storagePath || buildProductStoragePath(meta.supplierId, meta.id, meta.mimeType);
  try {
    const bucket = getStorageBucket();
    await bucket.file(storagePath).save(buffer, {
      resumable: false,
      metadata: {
        contentType: meta.mimeType,
        cacheControl: 'public, max-age=86400',
        metadata: {
          imageId: meta.id,
          supplierId: meta.supplierId,
          productId: meta.productId || '',
        },
      },
    });
    storageDiag.status = 'connected';
    storageDiag.lastError = null;
    storageDiag.lastSuccessAt = new Date().toISOString();
    return { uploaded: true, storagePath };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 220);
    storageDiag.lastError = msg;
    storageDiag.status = isCredentialOrBucketError(err) ? 'offline_fallback' : 'degraded';
    return { uploaded: false, storagePath };
  }
}

export function readProductImageFile(meta: ProductImageMeta): Buffer | null {
  try {
    const filePath = getImageDiskPath(meta.supplierId, meta.id, meta.mimeType);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

export async function readProductImageFromStorage(meta: ProductImageMeta): Promise<Buffer | null> {
  const storagePath =
    meta.storagePath || buildProductStoragePath(meta.supplierId, meta.id, meta.mimeType);
  try {
    const bucket = getStorageBucket();
    const [buf] = await bucket.file(storagePath).download();
    storageDiag.status = 'connected';
    storageDiag.lastError = null;
    storageDiag.lastSuccessAt = new Date().toISOString();
    return buf;
  } catch (err) {
    if (!isCredentialOrBucketError(err)) {
      const code = (err as any)?.code;
      if (code !== 404) {
        storageDiag.lastError = (err instanceof Error ? err.message : String(err)).slice(0, 220);
        storageDiag.status = 'degraded';
      }
    }
    return null;
  }
}

export function deleteProductImageFile(meta: ProductImageMeta): boolean {
  try {
    const filePath = getImageDiskPath(meta.supplierId, meta.id, meta.mimeType);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function deleteProductImageFromStorage(meta: ProductImageMeta): Promise<void> {
  deleteProductImageFile(meta);
  const storagePath =
    meta.storagePath || buildProductStoragePath(meta.supplierId, meta.id, meta.mimeType);
  try {
    const bucket = getStorageBucket();
    await bucket.file(storagePath).delete({ ignoreNotFound: true });
    storageDiag.lastSuccessAt = new Date().toISOString();
  } catch (err) {
    if (isCredentialOrBucketError(err)) {
      storageDiag.status = 'offline_fallback';
    }
  }
}

export function extractMediaIdFromUrl(url: string): string | null {
  const match = url.trim().match(/^\/api\/media\/products\/([a-zA-Z0-9_-]{3,80})(?:\?.*)?$/);
  return match ? match[1] : null;
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(name || 'product-image').replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 120) || 'product-image';
}

export function findOrphanedMediaIds(store: StoreSnapshot, candidateUrls: string[]): string[] {
  const stillReferencedIds = new Set<string>();
  for (const prod of Object.values(store.products)) {
    for (const url of prod.images || []) {
      const id = extractMediaIdFromUrl(url);
      if (id) stillReferencedIds.add(id);
    }
  }
  const orphaned: string[] = [];
  for (const url of candidateUrls) {
    const id = extractMediaIdFromUrl(url);
    if (id && !stillReferencedIds.has(id) && store.productImages[id]) {
      orphaned.push(id);
    }
  }
  return Array.from(new Set(orphaned));
}

export async function readProductImageWithStorageFallback(
  meta: ProductImageMeta
): Promise<{ buffer: Buffer; recoveredFromCloud: boolean } | null> {
  const onDisk = readProductImageFile(meta);
  if (onDisk) {
    return { buffer: onDisk, recoveredFromCloud: false };
  }
  const remote = await readProductImageFromStorage(meta);
  if (!remote) return null;
  try {
    saveProductImageFile(meta.supplierId, meta.id, meta.mimeType, remote);
  } catch {
    // Serve buffer even if disk re-hydration fails
  }
  return { buffer: remote, recoveredFromCloud: true };
}

// ------------------------------------------------------------------
// PAYMENT RECEIPT BINARY STORAGE (FIREBASE STORAGE + LOCAL CACHE)
// Keeps base64 binaries OUT of Firestore documents and store JSON.
// ------------------------------------------------------------------
function getReceiptDiskPath(orderId: string, submissionId: string, mimeType: AllowedImageMime): string {
  const safeOrder = assertSafeId(orderId, 'order');
  const safeSub = assertSafeId(submissionId, 'submission');
  const ext = mimeToExtension(mimeType);
  const resolved = path.resolve(PAYMENT_RECEIPTS_DIR, safeOrder, `${safeSub}.${ext}`);
  if (!resolved.startsWith(PAYMENT_RECEIPTS_DIR + path.sep)) {
    throw new Error('Unsafe receipt storage path rejected.');
  }
  return resolved;
}

export async function savePaymentReceiptFile(
  orderId: string,
  submissionId: string,
  dataUrl: string
): Promise<{
  storagePath: string;
  mimeType: AllowedImageMime;
  sizeBytes: number;
  uploadedToCloud: boolean;
}> {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new Error('Receipt must be a valid base64 PNG, JPG, or WEBP image.');
  }
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0) {
    throw new Error('Receipt image is empty.');
  }
  if (buffer.length > MAX_RECEIPT_IMAGE_BYTES) {
    throw new Error('Receipt screenshot exceeds 2 MB decoded size limit.');
  }
  const detectedMime = detectImageMimeFromBuffer(buffer);
  if (!detectedMime) {
    throw new Error('Receipt file binary signature is not a valid PNG, JPG, or WEBP image.');
  }

  const diskPath = getReceiptDiskPath(orderId, submissionId, detectedMime);
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  fs.writeFileSync(diskPath, buffer);

  const safeOrder = assertSafeId(orderId, 'order');
  const safeSub = assertSafeId(submissionId, 'submission');
  const ext = mimeToExtension(detectedMime);
  const storagePath = `receipts/${safeOrder}/${safeSub}.${ext}`;

  let uploadedToCloud = false;
  try {
    const bucket = getStorageBucket();
    await bucket.file(storagePath).save(buffer, {
      resumable: false,
      metadata: {
        contentType: detectedMime,
        cacheControl: 'private, max-age=0',
        metadata: {
          orderId,
          submissionId,
        },
      },
    });
    storageDiag.status = 'connected';
    storageDiag.lastError = null;
    storageDiag.lastSuccessAt = new Date().toISOString();
    uploadedToCloud = true;
  } catch (err) {
    storageDiag.lastError = (err instanceof Error ? err.message : String(err)).slice(0, 220);
    storageDiag.status = isCredentialOrBucketError(err) ? 'offline_fallback' : 'degraded';
  }

  return {
    storagePath,
    mimeType: detectedMime,
    sizeBytes: buffer.length,
    uploadedToCloud,
  };
}

export async function readPaymentReceiptDataUrl(sub: PaymentSubmission): Promise<string | null> {
  // 1. Check local receipt disk cache
  const candidateMimes: AllowedImageMime[] = sub.receiptMimeType
    ? [sub.receiptMimeType]
    : ['image/png', 'image/jpeg', 'image/webp'];

  for (const mime of candidateMimes) {
    try {
      const diskPath = getReceiptDiskPath(sub.orderId, sub.id, mime);
      if (fs.existsSync(diskPath)) {
        const buf = fs.readFileSync(diskPath);
        return `data:${mime};base64,${buf.toString('base64')}`;
      }
    } catch {
      // Ignore path lookup errors and try next strategy
    }
  }

  // 2. Fallback to Firebase Storage if storagePath exists
  if (sub.receiptStoragePath) {
    try {
      const bucket = getStorageBucket();
      const [buf] = await bucket.file(sub.receiptStoragePath).download();
      const mime =
        sub.receiptMimeType ||
        detectImageMimeFromBuffer(buf) ||
        extensionToMime(path.extname(sub.receiptStoragePath));
      try {
        const diskPath = getReceiptDiskPath(sub.orderId, sub.id, mime);
        fs.mkdirSync(path.dirname(diskPath), { recursive: true });
        fs.writeFileSync(diskPath, buf);
      } catch {
        // Non-fatal cache write failure
      }
      storageDiag.status = 'connected';
      storageDiag.lastSuccessAt = new Date().toISOString();
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch (err) {
      if (!isCredentialOrBucketError(err)) {
        storageDiag.lastError = (err instanceof Error ? err.message : String(err)).slice(0, 220);
      }
    }
  }

  // 3. Backward compatibility fallback for legacy inline records
  if (sub.receiptImageDataUrl && sub.receiptImageDataUrl.startsWith('data:image/')) {
    return sub.receiptImageDataUrl;
  }

  return null;
}

export function verifyProductMediaIntegrity(store: StoreSnapshot): {
  totalMetadataRecords: number;
  presentOnDisk: number;
  missingFromDisk: number;
  recoveredFromCloudBlob: number;
  orphanedFilesCount: number;
} {
  const entries = Object.values(store.productImages || {});
  let presentOnDisk = 0;
  let missingFromDisk = 0;
  const knownFiles = new Set<string>();

  for (const meta of entries) {
    try {
      const p = getImageDiskPath(meta.supplierId, meta.id, meta.mimeType);
      knownFiles.add(p);
      if (fs.existsSync(p)) {
        presentOnDisk += 1;
      } else {
        missingFromDisk += 1;
      }
    } catch {
      missingFromDisk += 1;
    }
  }

  let orphanedFilesCount = 0;
  try {
    if (fs.existsSync(PRODUCT_IMAGES_DIR)) {
      const supDirs = fs.readdirSync(PRODUCT_IMAGES_DIR);
      for (const dirName of supDirs) {
        const subDir = path.join(PRODUCT_IMAGES_DIR, dirName);
        if (!fs.statSync(subDir).isDirectory()) continue;
        for (const file of fs.readdirSync(subDir)) {
          const full = path.join(subDir, file);
          if (!knownFiles.has(full)) {
            orphanedFilesCount += 1;
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  return {
    totalMetadataRecords: entries.length,
    presentOnDisk,
    missingFromDisk,
    recoveredFromCloudBlob: 0,
    orphanedFilesCount,
  };
}

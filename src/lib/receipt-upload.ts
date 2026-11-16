export async function compressReceiptImage(
  file: File
): Promise<{ dataUrl: string; fileName: string }> {
  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!validTypes.includes(file.type.toLowerCase())) {
    throw new Error('Please upload a PNG, JPG, or WEBP receipt image.');
  }
  if (file.size > 6 * 1024 * 1024) {
    throw new Error('Receipt file is too large (max 6 MB before compression).');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read receipt file.'));
    reader.readAsDataURL(file);
  });

  // Compress large photos cleanly onto an HTML canvas so payload stays well below 1.8 MB
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Invalid receipt image file.'));
    image.src = rawDataUrl;
  });

  const maxDim = 1400;
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: rawDataUrl, fileName: file.name };
  }
  ctx.drawImage(img, 0, 0, width, height);
  const compressed = canvas.toDataURL('image/jpeg', 0.82);
  if (compressed.length > 2_300_000) {
    throw new Error('Compressed receipt exceeds 1.8 MB limit. Please upload a smaller image.');
  }
  return { dataUrl: compressed, fileName: file.name };
}

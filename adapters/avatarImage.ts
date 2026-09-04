/**
 * Shrink a picked photo so it can live on savigna_profiles.photo_url (no bucket).
 */

const AVATAR_PX = 256;
const JPEG_QUALITY = 0.72;
const MAX_DATA_URL_CHARS = 120_000;

export async function readImageFileAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose a photo');
  }
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
  if (!url.startsWith('data:image/')) {
    throw new Error('Choose a photo');
  }
  return compressAvatarDataUrl(url);
}

export async function compressAvatarDataUrl(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined') return dataUrl;
  const image = await loadImage(dataUrl);
  let size = AVATAR_PX;
  let quality = JPEG_QUALITY;
  let out = drawJpeg(image, size, quality);
  while (out.length > MAX_DATA_URL_CHARS && size > 96) {
    size = Math.round(size * 0.75);
    quality = Math.max(0.45, quality - 0.1);
    out = drawJpeg(image, size, quality);
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read image'));
    image.src = src;
  });
}

function drawJpeg(image: HTMLImageElement, size: number, quality: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return image.src;
  const min = Math.min(image.width, image.height) || 1;
  const sx = (image.width - min) / 2;
  const sy = (image.height - min) / 2;
  ctx.drawImage(image, sx, sy, min, min, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', quality);
}

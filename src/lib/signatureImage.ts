/**
 * Signature-image normalization.
 *
 * Uploaded signatures are embedded into the exported PDF via pdflatex's
 * `\includegraphics`, which reads only PNG/JPG (never GIF) and picks the format
 * from the file *extension* — and the compile pipeline always writes the bytes
 * as `attachments/signature.png` with `\setSignatureImage{signature.png}`. So a
 * JPG or GIF upload stored under that name renders wrong or fails the compile,
 * and the in-app preview (which also assumed PNG) was equally wrong.
 *
 * Normalizing every non-PNG upload to real PNG bytes at load time makes
 * `signature.png` / `image/png` honest everywhere at once — no per-format
 * extension plumbing, and formats pdflatex can't embed (GIF, WebP) just work.
 */

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be decoded.'));
    img.src = src;
  });
}

/**
 * Read an uploaded signature file and return PNG-encoded base64 (no data-URL
 * prefix). PNG uploads pass through untouched; JPG/GIF/WebP are repainted onto a
 * canvas and re-encoded as PNG with transparency preserved. Rejects if the image
 * can't be decoded or a 2D canvas isn't available.
 */
export async function loadSignatureAsPngBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  if (file.type === 'image/png') return arrayBufferToBase64(buffer);

  const url = URL.createObjectURL(new Blob([buffer], { type: file.type || 'application/octet-stream' }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image conversion is not available in this browser.');
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  } finally {
    URL.revokeObjectURL(url);
  }
}

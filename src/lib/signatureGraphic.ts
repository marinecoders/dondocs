/** Signature graphics are rasterized before use so only visible pixels enter the PDF. */
export const MAX_SIGNATURE_GRAPHIC_BYTES = 2 * 1024 * 1024;

export async function readSignatureGraphic(file: File): Promise<string> {
  if (file.size < 33 || file.size > MAX_SIGNATURE_GRAPHIC_BYTES) {
    throw new Error('Choose a PNG up to 2 MB.');
  }
  const bytes = await file.arrayBuffer();
  const view = new DataView(bytes);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a ||
      view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) {
    throw new Error('Choose a PNG image.');
  }
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || Math.max(width, height) > 4096 || width * height > 8_000_000) {
    throw new Error('Choose a smaller PNG image.');
  }
  for (let offset = 8; offset + 12 <= bytes.byteLength;) {
    const length = view.getUint32(offset);
    if (length > bytes.byteLength - offset - 12) throw new Error('The PNG image is incomplete.');
    if (view.getUint32(offset + 4) === 0x6163544c) throw new Error('Choose a still PNG image.');
    offset += 12 + length;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The signature image could not be read.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let visible = false;
    for (let i = 0; i < data.length; i += 4) {
      const darkness = 255 - (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      if (darkness * data[i + 3] / 255 > 5.5) { visible = true; break; }
    }
    if (!visible) throw new Error('The signature image has no visible ink.');
    const png = canvas.toDataURL('image/png').split(',')[1];
    if (!png || png.length > 4 * Math.floor(MAX_SIGNATURE_GRAPHIC_BYTES / 3)) {
      throw new Error('Choose a smaller signature image.');
    }
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

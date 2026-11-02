import { validateFigureAsset } from '@/services/latex/figureAssets';
import { figureExtension } from './figures';

/** Store the same orientation the browser displays; pdfTeX ignores JPEG EXIF. */
export async function prepareFigureUpload(file: File) {
  const extension = figureExtension(file.type, file.name);
  const type = extension === 'pdf' ? 'application/pdf' : extension === 'jpg' ? 'image/jpeg' : 'image/png';
  let bytes = await file.arrayBuffer();
  await validateFigureAsset(new Uint8Array(bytes), `figure.${extension}`);
  if (extension === 'pdf') return { bytes, type, width: undefined, height: undefined };

  let image: ImageBitmap | HTMLImageElement;
  let release: () => void;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    image = bitmap;
    release = () => bitmap.close();
  } else {
    const url = URL.createObjectURL(file);
    const element = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        element.onload = () => resolve();
        element.onerror = () => reject(new Error('Cannot decode this photo. Choose a valid PNG or JPEG.'));
        element.src = url;
      });
    } catch (error) { URL.revokeObjectURL(url); throw error; }
    image = element;
    release = () => URL.revokeObjectURL(url);
  }
  try {
    const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
    const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
    if (extension === 'jpg') {
      // Keep every decoded pixel. Re-encoding applies orientation and drops
      // camera/location tags without resizing the photograph.
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Cannot prepare this photo. Try another browser.');
        context.drawImage(image, 0, 0);
        bytes = await (await canvas.convertToBlob({ type, quality: .92 })).arrayBuffer();
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Cannot prepare this photo. Try another browser.');
        context.drawImage(image, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
          value => value ? resolve(value) : reject(new Error('Cannot prepare this photo. Choose another JPEG.')), type, .92,
        ));
        bytes = await blob.arrayBuffer();
      }
      await validateFigureAsset(new Uint8Array(bytes), 'figure.jpg');
    }
    return { bytes, type, width, height };
  } finally { release(); }
}

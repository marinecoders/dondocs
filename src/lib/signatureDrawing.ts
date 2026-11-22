export interface SignaturePoint { readonly x: number; readonly y: number }
export type SignatureStroke = readonly SignaturePoint[];

export const SIGNATURE_DRAWING = {
  width: 800, height: 400, lineWidth: 6, padding: 12,
  maxStrokes: 128, maxPoints: 20_000, minimumLength: 8,
} as const;

/** Coordinates stay independent of device pixel ratio and the pad's screen size. */
export function signaturePoint(clientX: number, clientY: number, rectangle: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): SignaturePoint {
  if (![clientX, clientY, rectangle.left, rectangle.top, rectangle.width, rectangle.height].every(Number.isFinite)
    || rectangle.width <= 0 || rectangle.height <= 0) throw new Error('The signature drawing area is unavailable.');
  return {
    x: Math.round(Math.max(0, Math.min(SIGNATURE_DRAWING.width, (clientX - rectangle.left) / rectangle.width * SIGNATURE_DRAWING.width)) * 10) / 10,
    y: Math.round(Math.max(0, Math.min(SIGNATURE_DRAWING.height, (clientY - rectangle.top) / rectangle.height * SIGNATURE_DRAWING.height)) * 10) / 10,
  };
}

export function signatureDrawingBounds(strokes: readonly SignatureStroke[]) {
  if (strokes.length > SIGNATURE_DRAWING.maxStrokes) throw new Error('The signature has too many strokes. Clear it and try again.');
  let points = 0, length = 0, left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const stroke of strokes) {
    for (const [index, point] of stroke.entries()) {
      if (++points > SIGNATURE_DRAWING.maxPoints) throw new Error('The signature has too much detail. Clear it and try again.');
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > SIGNATURE_DRAWING.width || point.y < 0 || point.y > SIGNATURE_DRAWING.height) {
        throw new Error('The signature contains an invalid drawing point.');
      }
      left = Math.min(left, point.x); top = Math.min(top, point.y);
      right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
      if (index) length += Math.hypot(point.x - stroke[index - 1].x, point.y - stroke[index - 1].y);
    }
  }
  if (length < SIGNATURE_DRAWING.minimumLength) throw new Error('Draw a signature before using it.');
  return {
    left: Math.floor(left) - SIGNATURE_DRAWING.padding,
    top: Math.floor(top) - SIGNATURE_DRAWING.padding,
    width: Math.ceil(right) - Math.floor(left) + SIGNATURE_DRAWING.padding * 2,
    height: Math.ceil(bottom) - Math.floor(top) + SIGNATURE_DRAWING.padding * 2,
  };
}

export function hasSignatureDrawing(strokes: readonly SignatureStroke[]): boolean {
  try { signatureDrawingBounds(strokes); return true; } catch { return false; }
}

/** Export only the ink; the pad's white background and cursor are not retained. */
export async function renderSignatureDrawing(strokes: readonly SignatureStroke[]): Promise<File> {
  const bounds = signatureDrawingBounds(strokes);
  const canvas = document.createElement('canvas');
  canvas.width = bounds.width; canvas.height = bounds.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not create a signature image. You can upload an image instead.');
  context.translate(-bounds.left, -bounds.top);
  context.lineWidth = SIGNATURE_DRAWING.lineWidth;
  context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = '#000000'; context.fillStyle = '#000000';
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    context.beginPath(); context.moveTo(stroke[0].x, stroke[0].y);
    for (const point of stroke.slice(1)) context.lineTo(point.x, point.y);
    if (stroke.length === 1) { context.arc(stroke[0].x, stroke[0].y, SIGNATURE_DRAWING.lineWidth / 2, 0, Math.PI * 2); context.fill(); }
    else context.stroke();
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob || !blob.size || blob.size > 2 * 1024 * 1024) throw new Error('The signature image could not be created. Clear it and try again.');
  return new File([blob], 'drawn-signature.png', { type: 'image/png' });
}

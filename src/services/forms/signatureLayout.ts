import { pdfjs } from 'react-pdf';
import { HARDENED_PDF_OPTIONS } from '@/components/pdf/pdfConfig';

export interface Slot { name: string; label: string; page: number; box: number[] }
export async function readSignatureLayout(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const task = pdfjs.getDocument({ ...HARDENED_PDF_OPTIONS, data: bytes });
  try {
    const pdf = await task.promise;
    const slots: Slot[] = [];
    const sizes: number[][] = [];
    for (let index = 0; index < pdf.numPages; index++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(index + 1);
      const view = page.getViewport({ scale: 1 });
      sizes.push([view.width, view.height]);
      for (const widget of await page.getAnnotations()) {
        if (widget.fieldType !== 'Sig' || !widget.fieldName || !Array.isArray(widget.rect)) continue;
        const [x1, y1, x2, y2] = view.convertToViewportRectangle(widget.rect);
        slots.push({ name: widget.fieldName, label: widget.alternativeText || widget.fieldName, page: index,
          box: [Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1)] });
      }
    }
    return { sizes, slots };
  } finally { await task.destroy(); }
}

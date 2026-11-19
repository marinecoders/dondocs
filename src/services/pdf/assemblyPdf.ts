import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';

export const PROTECTED_PDF_LIMITS = Object.freeze({
  bytes: 25 * 1024 * 1024,
  pages: 50,
  pagePixels: 4_000_000,
  totalPixels: 32_000_000,
  imagePixels: 40_000_000,
  pngBytes: 32 * 1024 * 1024,
  milliseconds: 45_000,
});

export const PROTECTED_PDF_NOTICE = 'This PDF has permission restrictions. Its pages will be included as images. Selectable text, interactive fields and digital signatures do not carry into that assembled copy. The uploaded original remains unchanged.';

function bytesOf(data: Uint8Array | ArrayBuffer): Uint8Array {
  // PDF.js may transfer its input buffer to its worker. Never pass the retained source.
  return new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
}

function pagePng(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.throwIfAborted();
    signal.addEventListener('abort', abort, { once: true });
    try {
      canvas.toBlob(value => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(signal.reason);
        else if (value) resolve(value);
        else reject(new Error('The protected PDF page image could not be prepared.'));
      }, 'image/png');
    } catch (error) {
      signal.removeEventListener('abort', abort);
      reject(error);
    }
  });
}

function checkImages(pdf: PDFDocument): void {
  let total = 0;
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    const width = object.dict.lookup(PDFName.of('Width'), PDFNumber)?.asNumber() ?? NaN;
    const height = object.dict.lookup(PDFName.of('Height'), PDFNumber)?.asNumber() ?? NaN;
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > PROTECTED_PDF_LIMITS.imagePixels
      || (total += pixels) > PROTECTED_PDF_LIMITS.imagePixels) {
      throw new Error('This protected PDF contains too much image data. Split it or export an unprotected copy in your PDF application.');
    }
  }
}

/** pdf-lib does not decrypt streams when ignoreEncryption is set. A document
 * that opens without a user password can still produce silently blank copies.
 * Render only that encrypted case to a separate, bounded visual derivative.
 */
export async function loadAssemblyPdf(data: Uint8Array | ArrayBuffer, signal?: AbortSignal): Promise<{ pdf: PDFDocument; pageImages: boolean }> {
  signal?.throwIfAborted();
  const source = bytesOf(data);
  const pdf = await PDFDocument.load(source, { ignoreEncryption: true });
  signal?.throwIfAborted();
  if (!pdf.isEncrypted) return { pdf, pageImages: false };
  if (source.byteLength > PROTECTED_PDF_LIMITS.bytes) throw new Error('Protected PDFs must be 25 MB or smaller. Split this PDF and try again.');
  checkImages(pdf);
  const [{ pdfjs }, { HARDENED_PDF_OPTIONS }] = await Promise.all([import('react-pdf'), import('@/components/pdf/pdfConfig')]);
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const task = pdfjs.getDocument({ data: source, password: '', ...HARDENED_PDF_OPTIONS, stopAtErrors: true });
  signal?.addEventListener('abort', abort, { once: true });
  const stop = () => { void task.destroy().catch(() => {}); };
  controller.signal.addEventListener('abort', stop, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Protected PDF preparation timed out. Split the PDF and try again.')), PROTECTED_PDF_LIMITS.milliseconds);
  try {
    const documentPdf = await task.promise;
    controller.signal.throwIfAborted();
    if (documentPdf.numPages < 1 || documentPdf.numPages > PROTECTED_PDF_LIMITS.pages) throw new Error('Protected PDFs support 1–50 pages. Split this PDF and try again.');
    const output = await PDFDocument.create();
    let pixels = 0, pngBytes = 0;
    for (let number = 1; number <= documentPdf.numPages; number++) {
      controller.signal.throwIfAborted();
      const page = await documentPdf.getPage(number);
      try {
        const base = page.getViewport({ scale: 1 });
        if (![base.width, base.height].every(value => Number.isFinite(value) && value > 0 && value <= 14_400)) throw new Error('This protected PDF has unsupported page dimensions.');
        const scale = Math.min(2, 4096 / Math.max(base.width, base.height), Math.sqrt(PROTECTED_PDF_LIMITS.pagePixels / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
        pixels += width * height;
        if (pixels > PROTECTED_PDF_LIMITS.totalPixels) throw new Error('Protected PDF page images exceed the preparation limit. Split the PDF and try again.');
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        try {
          const context = canvas.getContext('2d');
          if (!context) throw new Error('This browser cannot prepare protected PDF pages. Export an unprotected copy in your PDF application.');
          const render = page.render({ canvas, canvasContext: context, viewport, background: 'white' });
          const cancel = () => render.cancel();
          controller.signal.addEventListener('abort', cancel, { once: true });
          try { await render.promise; } finally { controller.signal.removeEventListener('abort', cancel); }
          controller.signal.throwIfAborted();
          const blob = await pagePng(canvas, controller.signal);
          pngBytes += blob.size;
          if (pngBytes > PROTECTED_PDF_LIMITS.pngBytes) throw new Error('Protected PDF images exceed 32 MB. Split the PDF and try again.');
          const image = await output.embedPng(await blob.arrayBuffer());
          controller.signal.throwIfAborted();
          output.addPage([base.width, base.height]).drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
        } finally { canvas.width = canvas.height = 0; }
      } finally { page.cleanup(); }
    }
    controller.signal.throwIfAborted();
    // embedPage reads another document's resources directly, unlike copyPages
    // which flushes them first. Install pending PNG streams before returning.
    await output.flush();
    controller.signal.throwIfAborted();
    return { pdf: output, pageImages: true };
  } catch (error) {
    controller.signal.throwIfAborted();
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('This PDF needs an opening password. Open it in your PDF application and export a readable copy before attaching it.', { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', stop);
    await task.destroy().catch(() => {});
  }
}

/** Attach-time check uses the same loader as the final assembly. */
export async function inspectAssemblyPdf(data: Uint8Array | ArrayBuffer): Promise<{ pageCount: number; pageImages: boolean }> {
  const { pdf, pageImages } = await loadAssemblyPdf(data);
  if (!pdf.getPageCount()) throw new Error('The PDF has no pages.');
  for (const page of pdf.getPages()) if (!page.node.get(PDFName.of('Contents'))) throw new Error('The PDF contains an empty or unreadable page.');
  return { pageCount: pdf.getPageCount(), pageImages };
}

import { pdfjs } from 'react-pdf';
import { HARDENED_PDF_OPTIONS } from '@/components/pdf/pdfConfig';
import { LocalOcrWorker, type OcrText } from './localOcrWorker';
import { inspectRasterImage } from '@/services/docx/imageAssets';

export const SCAN_MAX_BYTES = 20 * 1024 * 1024;
export const SCAN_MAX_PAGES = 12;
export const SCAN_MAX_PIXELS = 8_000_000;
export const SCAN_MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
export interface ScanPage extends OcrText { preview: Blob; page: number }
export interface ScanProgress { page: number; total: number; fraction: number }

export function validateScanFile(file: Pick<File, 'name' | 'size' | 'type'>): 'pdf' | 'image' {
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > SCAN_MAX_BYTES) throw new Error('Choose a nonempty file up to 20 MB.');
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return 'pdf';
  if (/\.(?:png|jpe?g)$/i.test(file.name) || /^(?:image\/png|image\/jpeg)$/.test(file.type)) {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image up to 10 MB.');
    return 'image';
  }
  throw new Error('Choose a PDF, PNG, or JPEG image.');
}

export function scanDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || width * height > 80_000_000 || Math.max(width, height) > 30_000) throw new Error('The source image dimensions are unsupported.');
  const scale = Math.min(2, 2600 / Math.max(width, height), Math.sqrt(SCAN_MAX_PIXELS / (width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The page image could not be prepared.')), 'image/png'));
}

/** Recognize one bounded page at a time; source bytes never leave this browser. */
export async function recognizeScannedFile(file: File, signal: AbortSignal, onProgress: (progress: ScanProgress) => void): Promise<ScanPage[]> {
  const format = validateScanFile(file);
  signal.throwIfAborted();
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  // Inspect encoded headers before allocating a decoded bitmap. The existing
  // inspector caps images at 10 MB / 40 megapixels and rejects malformed data.
  if (format === 'image') {
    await inspectRasterImage(sourceBytes, sourceBytes[0] === 137 ? 'image/png' : 'image/jpeg');
    signal.throwIfAborted();
  }
  const worker = new LocalOcrWorker(signal, fraction => onProgress({ page: currentPage, total, fraction }));
  let currentPage = 0;
  let total = 1;
  let previewBytes = 0;
  const pages: ScanPage[] = [];
  const recognize = async (canvas: HTMLCanvasElement) => {
    try {
      signal.throwIfAborted();
      const preview = await canvasBlob(canvas);
      previewBytes += preview.size;
      if (previewBytes > SCAN_MAX_PREVIEW_BYTES) throw new Error('Prepared page images exceed 32 MB. Split this document and try again.');
      const result = await worker.recognize(new Uint8Array(await preview.arrayBuffer()));
      signal.throwIfAborted();
      pages.push({ ...result, page: currentPage, preview });
    } finally { canvas.width = canvas.height = 0; }
  };
  try {
    await worker.initialize();
    signal.throwIfAborted();
    if (format === 'image') {
      const bitmap = await createImageBitmap(file);
      try {
        signal.throwIfAborted();
        const dimensions = scanDimensions(bitmap.width, bitmap.height);
        const canvas = document.createElement('canvas');
        Object.assign(canvas, dimensions);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser cannot prepare an image for text recognition.');
        context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        currentPage = 1;
        await recognize(canvas);
      } finally { bitmap.close(); }
    } else {
      const task = pdfjs.getDocument({ data: sourceBytes, maxImageSize: 40_000_000, ...HARDENED_PDF_OPTIONS });
      const abort = () => { void task.destroy(); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        const pdf = await task.promise;
        total = pdf.numPages;
        if (total > SCAN_MAX_PAGES) throw new Error(`Scan import supports up to ${SCAN_MAX_PAGES} pages. Split this PDF and try again.`);
        for (currentPage = 1; currentPage <= total; currentPage++) {
          signal.throwIfAborted();
          const page = await pdf.getPage(currentPage);
          try {
            const base = page.getViewport({ scale: 1 });
            const dimensions = scanDimensions(base.width * 2, base.height * 2);
            const viewport = page.getViewport({ scale: dimensions.width / base.width });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            try {
              const context = canvas.getContext('2d');
              if (!context) throw new Error('This browser cannot prepare PDF pages for text recognition.');
              await page.render({ canvas, canvasContext: context, viewport }).promise;
              await recognize(canvas);
            } finally { canvas.width = canvas.height = 0; }
          } finally { page.cleanup(); }
        }
      } finally {
        signal.removeEventListener('abort', abort);
        await task.destroy();
      }
    }
    if (pages.reduce((length, page) => length + page.text.length, 0) > 500_000) throw new Error('Recognized text exceeds the import limit. Split the document and try again.');
    return pages;
  } finally { worker.close(); }
}

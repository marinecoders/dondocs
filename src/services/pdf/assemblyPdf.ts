import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRawStream, PDFStream, PDFString } from 'pdf-lib';
import type { PDFPageProxy } from 'pdfjs-dist';
import { createPdfResourceValidator } from './validatePdfResources';

export const PROTECTED_PDF_LIMITS = Object.freeze({
  bytes: 25 * 1024 * 1024,
  pages: 50,
  pagePixels: 4_000_000,
  totalPixels: 32_000_000,
  imagePixels: 40_000_000,
  pngBytes: 32 * 1024 * 1024,
  milliseconds: 45_000,
});

export type PdfImageCopyReason = 'permissions' | 'annotations';
export const PROTECTED_PDF_NOTICE = 'This PDF has permission restrictions. Its printed pages will be included as images. Selectable text, interactive fields and digital signatures do not carry into that assembled copy. The uploaded original remains unchanged.';
export const ANNOTATED_PDF_NOTICE = 'This PDF includes printable annotations or form fields. Its printed pages will be included as images to preserve those appearances. Selectable text, interactive fields and digital signatures do not carry into that assembled copy. The uploaded original remains unchanged.';

export function pdfImageCopyNotice(reason?: PdfImageCopyReason): string {
  return reason === 'annotations' ? ANNOTATED_PDF_NOTICE : PROTECTED_PDF_NOTICE;
}

function hasFieldValue(annotation: PDFDict): boolean {
  const seen = new Set<PDFDict>();
  const fields: PDFDict[] = [];
  let field: PDFDict | undefined = annotation;
  while (field) {
    if (seen.has(field) || seen.size >= 64) throw new Error('PDF form field inheritance is cyclic or too deep. Export a flattened copy and attach it again.');
    seen.add(field);
    fields.push(field);
    const parent: unknown = field.lookup(PDFName.of('Parent'));
    field = parent instanceof PDFDict ? parent : undefined;
  }
  for (const key of ['V', 'DV']) for (const candidate of fields) {
    if (!candidate.has(PDFName.of(key))) continue;
    const value = candidate.lookup(PDFName.of(key));
    if (!value || value === PDFNull) return false;
    if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText().length > 0;
    if (value instanceof PDFArray) return value.size() > 0;
    return true;
  }
  return false;
}

const FORM_APPEARANCE_ERROR = 'DonDocs cannot verify the saved appearance of a valued printable form field. Open it in your PDF application, export an unprotected, flattened PDF, and attach that copy.';
const XFA_ERROR = 'This PDF contains XFA form data that cannot be included reliably. Open it in a PDF application that supports XFA, print a flattened PDF, and attach that copy.';

function inspectFormMetadata(pdf: PDFDocument): { needsAppearances: boolean | undefined } {
  // Context lookup only reads the already-parsed object map. Opaque encrypted
  // object-stream entries remain unknown; this never decrypts or walks pages.
  const form = pdf.context.lookup(pdf.catalog.get(PDFName.of('AcroForm')));
  if (!(form instanceof PDFDict)) return { needsAppearances: pdf.catalog.has(PDFName.of('AcroForm')) ? undefined : false };
  const rawNeed = form.get(PDFName.of('NeedAppearances'), true);
  const need = pdf.context.lookup(rawNeed);
  if (pdf.isEncrypted) return { needsAppearances: need instanceof PDFBool ? need.asBoolean() : rawNeed === undefined ? false : undefined };
  const xfa = form.lookup(PDFName.of('XFA'));
  if (xfa && xfa !== PDFNull && (!(xfa instanceof PDFArray) || xfa.size() > 0)
    && (!(xfa instanceof PDFStream) || xfa.getContentsSize() > 0)) throw new Error(XFA_ERROR);
  return { needsAppearances: form.lookup(PDFName.of('NeedAppearances')) === PDFBool.True };
}

/** Page embedding omits annotations. Only printable, visible appearances need
 * flattening; ordinary links and non-printing review notes keep the vector path.
 */
function hasPrintableAnnotations(pdf: PDFDocument, needsAppearances: boolean | undefined): boolean {
  let printable = false;
  for (const page of pdf.getPages()) for (const reference of page.node.Annots()?.asArray() ?? []) {
    const annotation = pdf.context.lookup(reference);
    if (!(annotation instanceof PDFDict)) continue;
    const subtype = annotation.lookup(PDFName.of('Subtype'));
    if (subtype === PDFName.of('Popup')) continue;
    const flags = annotation.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0;
    // NoView affects display, not printing. Invisible and Hidden suppress both.
    if (!(flags & 4) || flags & 3) continue;
    const rectangle = annotation.lookup(PDFName.of('Rect'));
    if (rectangle instanceof PDFArray && rectangle.size() === 4) {
      const coordinates = Array.from({ length: 4 }, (_, index) => rectangle.lookup(index, PDFNumber).asNumber());
      if (coordinates[0] === coordinates[2] || coordinates[1] === coordinates[3]) continue;
    }
    const appearances = annotation.lookup(PDFName.of('AP'));
    const normal = appearances instanceof PDFDict ? appearances.lookup(PDFName.of('N')) : undefined;
    const state = annotation.lookup(PDFName.of('AS'));
    const appearance = normal instanceof PDFDict && state instanceof PDFName ? normal.lookup(state) : normal;
    if (subtype === PDFName.of('Link') && !(appearance instanceof PDFStream)) continue;
    printable = true;
    if (subtype === PDFName.of('Widget')) {
      if (hasFieldValue(annotation) && (needsAppearances !== false || !(appearance instanceof PDFStream))) {
        throw new Error(FORM_APPEARANCE_ERROR);
      }
    }
  }
  return printable;
}

async function checkRenderedFormFields(page: PDFPageProxy, needsAppearances: boolean | undefined, widgetType: number): Promise<void> {
  for (const annotation of await page.getAnnotations({ intent: 'print' })) {
    if (annotation.annotationType !== widgetType) continue;
    const rectangle: unknown = annotation.rect;
    if (Array.isArray(rectangle) && (rectangle[0] === rectangle[2] || rectangle[1] === rectangle[3])) continue;
    const value: unknown = annotation.fieldValue ?? annotation.defaultFieldValue;
    const valued = typeof value === 'string' ? value.length > 0 : Array.isArray(value) ? value.length > 0 : value != null;
    if (valued && (needsAppearances !== false || !annotation.hasAppearance)) throw new Error(FORM_APPEARANCE_ERROR);
  }
}

/** PDF.js can resolve a failed image as null and still fulfill render.promise.
 * Validate each page's own dependencies, never process-wide console messages.
 */
async function assertDecodedImages(page: PDFPageProxy, imageKinds: ReadonlySet<number>, signal: AbortSignal): Promise<void> {
  const operators = await page.getOperatorList({ intent: 'print' });
  const checked = new Set<string>();
  for (let index = 0; index < operators.fnArray.length; index++) {
    signal.throwIfAborted();
    if (!imageKinds.has(operators.fnArray[index])) continue;
    const id: unknown = operators.argsArray[index]?.[0];
    if (typeof id !== 'string') throw new Error('A PDF image has an unreadable reference.');
    if (checked.has(id)) continue;
    checked.add(id);
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      try {
        const objects = id.startsWith('g_') ? page.commonObjs : page.objs;
        objects.get(id, (image: unknown) => {
          signal.removeEventListener('abort', abort);
          if (signal.aborted) reject(signal.reason);
          else if (!image) reject(new Error('A PDF image could not be decoded. Export a readable copy in your PDF application and attach it again.'));
          else resolve();
        });
      } catch (error) {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    });
  }
}

/** Copying a page dictionary does not decode its content streams. Probe those
 * streams before accepting a source, without contaminating the final document
 * with pdf-lib's deferred, potentially failing embedded-page resources.
 */
export async function assertAssemblyPagesReadable(pdf: PDFDocument, signal?: AbortSignal): Promise<void> {
  const probe = await PDFDocument.create();
  const validateResources = createPdfResourceValidator(pdf, signal);
  for (const [index, page] of pdf.getPages().entries()) {
    signal?.throwIfAborted();
    try {
      await validateResources(page);
      await (await probe.embedPage(page)).embed();
    } catch (cause) {
      signal?.throwIfAborted();
      const detail = cause instanceof Error ? ` ${cause.message}` : '';
      throw new Error(`PDF page ${index + 1} is unreadable.${detail} Export a readable copy in your PDF application and attach it again.`, { cause });
    }
  }
}

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
        else reject(new Error('The PDF page image could not be prepared.'));
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
    if (!(object instanceof PDFRawStream)) continue;
    const metadata = (name: string) => pdf.isEncrypted ? object.dict.get(PDFName.of(name)) : object.dict.lookup(PDFName.of(name));
    const subtype = metadata('Subtype');
    if (subtype && !(subtype instanceof PDFName)) throw new Error('This PDF has unreadable image metadata. Export an unprotected, flattened copy and attach it again.');
    if (subtype !== PDFName.of('Image')) continue;
    const rawWidth = metadata('Width'), rawHeight = metadata('Height');
    if (!(rawWidth instanceof PDFNumber) || !(rawHeight instanceof PDFNumber)) throw new Error('This PDF has unreadable image dimensions. Export an unprotected, flattened copy and attach it again.');
    const width = rawWidth.asNumber(), height = rawHeight.asNumber();
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > PROTECTED_PDF_LIMITS.imagePixels
      || (total += pixels) > PROTECTED_PDF_LIMITS.imagePixels) {
      throw new Error('This PDF contains too much image data. Split it or export an unprotected copy in your PDF application.');
    }
  }
}

/** pdf-lib does not decrypt streams when ignoreEncryption is set. A document
 * that opens without a user password can still produce silently blank copies.
 * Render that encrypted case, or printable enclosure annotations, to a separate,
 * bounded visual derivative. Basic-letter copies preserve ordinary annotations.
 */
export async function loadAssemblyPdf(data: Uint8Array | ArrayBuffer, signal?: AbortSignal, options: { preserveAnnotations?: boolean; forcePageImages?: boolean; onPageImage?: (image: { bytes: Uint8Array; width: number; height: number }) => void | Promise<void> } = {}): Promise<{ pdf: PDFDocument; pageImages: boolean; imageCopyReason?: PdfImageCopyReason }> {
  signal?.throwIfAborted();
  const source = bytesOf(data);
  const pdf = await PDFDocument.load(source, { ignoreEncryption: true });
  signal?.throwIfAborted();
  const { needsAppearances } = inspectFormMetadata(pdf);
  // pdf-lib cannot decrypt compressed page dictionaries. Let PDF.js inspect
  // encrypted form/annotation metadata after loading it with the empty password.
  const printableAnnotations = !pdf.isEncrypted && hasPrintableAnnotations(pdf, needsAppearances);
  const imageCopyReason = pdf.isEncrypted ? 'permissions' : !options.preserveAnnotations && printableAnnotations ? 'annotations' : undefined;
  if (!imageCopyReason && !options.forcePageImages) return { pdf, pageImages: false };
  if (source.byteLength > PROTECTED_PDF_LIMITS.bytes) throw new Error('PDF image copies must be 25 MB or smaller. Split this PDF and try again.');
  if (typeof document === 'undefined') throw new Error('This environment cannot prepare PDF page images. Export an unprotected, flattened copy in your PDF application and attach it again.');
  checkImages(pdf);
  const [{ pdfjs }, { HARDENED_PDF_OPTIONS }] = await Promise.all([import('react-pdf'), import('@/components/pdf/pdfConfig')]);
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const task = pdfjs.getDocument({ data: source, password: '', ...HARDENED_PDF_OPTIONS, enableXfa: false, stopAtErrors: true });
  signal?.addEventListener('abort', abort, { once: true });
  const stop = () => { void task.destroy().catch(() => {}); };
  controller.signal.addEventListener('abort', stop, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('PDF image preparation timed out. Split the PDF and try again.')), PROTECTED_PDF_LIMITS.milliseconds);
  try {
    const documentPdf = await task.promise;
    controller.signal.throwIfAborted();
    const metadata = await documentPdf.getMetadata();
    if ('IsXFAPresent' in metadata.info && metadata.info.IsXFAPresent) throw new Error(XFA_ERROR);
    controller.signal.throwIfAborted();
    if (documentPdf.numPages < 1 || documentPdf.numPages > PROTECTED_PDF_LIMITS.pages) throw new Error('PDF image copies support 1–50 pages. Split this PDF and try again.');
    const output = await PDFDocument.create();
    const imageKinds = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintImageXObjectRepeat]);
    let pixels = 0, pngBytes = 0;
    for (let number = 1; number <= documentPdf.numPages; number++) {
      controller.signal.throwIfAborted();
      const page = await documentPdf.getPage(number);
      try {
        await checkRenderedFormFields(page, needsAppearances, pdfjs.AnnotationType.WIDGET);
        controller.signal.throwIfAborted();
        const base = page.getViewport({ scale: 1 });
        if (![base.width, base.height].every(value => Number.isFinite(value) && value > 0 && value <= 14_400)) throw new Error('This PDF has unsupported page dimensions.');
        const scale = Math.min(2, 4096 / Math.max(base.width, base.height), Math.sqrt(PROTECTED_PDF_LIMITS.pagePixels / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
        pixels += width * height;
        if (pixels > PROTECTED_PDF_LIMITS.totalPixels) throw new Error('PDF page images exceed the preparation limit. Split the PDF and try again.');
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        try {
          const context = canvas.getContext('2d');
          if (!context) throw new Error('This browser cannot prepare PDF page images. Export an unprotected copy in your PDF application.');
          const render = page.render({ canvas, canvasContext: context, viewport, background: 'white', intent: 'print' });
          const cancel = () => render.cancel();
          controller.signal.addEventListener('abort', cancel, { once: true });
          try { await render.promise; } finally { controller.signal.removeEventListener('abort', cancel); }
          controller.signal.throwIfAborted();
          await assertDecodedImages(page, imageKinds, controller.signal);
          const blob = await pagePng(canvas, controller.signal);
          pngBytes += blob.size;
          if (pngBytes > PROTECTED_PDF_LIMITS.pngBytes) throw new Error('PDF page images exceed 32 MB. Split the PDF and try again.');
          const imageBytes = new Uint8Array(await blob.arrayBuffer());
          await options.onPageImage?.({ bytes: imageBytes, width: base.width, height: base.height });
          controller.signal.throwIfAborted();
          const image = await output.embedPng(imageBytes);
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
    return { pdf: output, pageImages: true, imageCopyReason };
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
export async function inspectAssemblyPdf(data: Uint8Array | ArrayBuffer): Promise<{ pageCount: number; pageImages: boolean; imageCopyReason?: PdfImageCopyReason }> {
  const { pdf, pageImages, imageCopyReason } = await loadAssemblyPdf(data);
  if (!pdf.getPageCount()) throw new Error('The PDF has no pages.');
  for (const page of pdf.getPages()) if (!page.node.get(PDFName.of('Contents'))) throw new Error('The PDF contains an empty or unreadable page.');
  await assertAssemblyPagesReadable(pdf);
  return { pageCount: pdf.getPageCount(), pageImages, ...(imageCopyReason ? { imageCopyReason } : {}) };
}

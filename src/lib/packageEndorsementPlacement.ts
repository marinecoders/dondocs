import { deriveOverallClassLevel } from './overallClassification';
import { correspondencePortions } from './renderedDocument';
import type { NativePackageMember, PackageMember } from './actionPackages';

export interface PackageEndorsementMeasurement {
  fits: boolean;
  reason: string;
  previousBottom?: number;
  sourceTop?: number;
  sourceBottom?: number;
  targetBottom?: number;
  targetTop?: number;
}
function qualified(member: PackageMember): member is NativePackageMember {
  return member.kind === 'native' && member.session.documentCategory !== 'forms' && member.session.documentMode === 'compliant'
    && !member.session.paragraphs.some(paragraph => paragraph.figure || paragraph.bodyTable)
    && ['naval_letter', 'same_page_endorsement', 'new_page_endorsement'].includes(member.session.docType)
    && (!member.session.formData.signatureType || member.session.formData.signatureType === 'none')
    && !member.session.formData.signatureImage && !member.session.formData.appendEndorsement
    && !member.session.formData.additionalEndorsements?.length
    && deriveOverallClassLevel(member.session.formData.classLevel ?? 'unclassified', correspondencePortions({ ...member.session, endItems: member.session.endItems ?? [], publicationTables: member.session.publicationTables ?? {} })) === 'unclassified'
    && member.session.enclosures.every(enclosure => !enclosure.hasFile)
    && !!member.session.formData.sigLast?.trim();
}
export function canMeasurePackageEndorsement(previous: PackageMember | undefined, next: PackageMember): boolean {
  return !!previous && qualified(previous) && qualified(next) && next.role === 'endorsement'
    && ['same_page_endorsement', 'new_page_endorsement'].includes(next.session.docType);
}
/** Measure every visible ink pixel in the native content rectangle, including rules and graphics. */
export function packageInkBounds(data: Uint8ClampedArray, width: number, height: number): { top: number; bottom: number } | undefined {
  if (width !== 612 || height !== 792 || data.length !== width * height * 4) return undefined;
  let top = height, bottom = -1;
  for (let y = 36; y < height - 54; y++) for (let x = 36; x < width - 36; x++) {
    const index = (y * width + x) * 4;
    if (data[index + 3] > 16 && Math.min(data[index], data[index + 1], data[index + 2]) < 245) { top = Math.min(top, y); bottom = y; }
  }
  return bottom < 0 ? undefined : { top: height - top + 2, bottom: height - bottom - 2 };
}
function printedName(member: NativePackageMember): string {
  const form = member.session.formData;
  return [form.sigFirst ? `${form.sigFirst[0]}.` : '', form.sigMiddle ? `${form.sigMiddle[0]}.` : '', form.sigLast ?? ''].filter(Boolean).join(' ').replace(/\s/g, '').toUpperCase();
}

/** SECNAV M-5216.5 Ch 9 para1: the entire endorsement must fit on the preceding signature page. */
export async function measurePackageEndorsement(previousBytes: ArrayBuffer, nextBytes: ArrayBuffer, previous: PackageMember, next: PackageMember,
  signal: AbortSignal): Promise<PackageEndorsementMeasurement> {
  const fallback = (reason: string): PackageEndorsementMeasurement => ({ fits: false, reason });
  if (!canMeasurePackageEndorsement(previous, next)) return fallback('The preceding member and endorsement are not qualified unsigned native correspondence.');
  signal.throwIfAborted();
  const tasks: Array<{ destroy(): Promise<void> }> = [];
  const stop = () => { void Promise.allSettled(tasks.map(task => task.destroy())); };
  const timeout = setTimeout(stop, 45_000); signal.addEventListener('abort', stop, { once: true });
  try {
    const [{ pdfjs }, { HARDENED_PDF_OPTIONS }] = await Promise.all([import('react-pdf'), import('@/components/pdf/pdfConfig')]);
    signal.throwIfAborted();
    const documents: Array<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>> = [];
    for (const bytes of [previousBytes, nextBytes]) {
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), ...HARDENED_PDF_OPTIONS }); tasks.push(task); documents.push(await task.promise);
    }
    signal.throwIfAborted();
    if (documents[1].numPages !== 1) return fallback('The endorsement occupies more than one page.');
    const measured: Array<{ top: number; bottom: number }> = [];
    for (const [index, documentPdf] of documents.entries()) {
      const page = await documentPdf.getPage(index ? 1 : documentPdf.numPages), viewport = page.getViewport({ scale: 1 });
      if (page.rotate !== 0 || viewport.width !== 612 || viewport.height !== 792 || (await page.getAnnotations()).length)
        return fallback('Page rotation, annotations or page size prevent qualified same-page placement.');
      const text = (await page.getTextContent()).items.filter(item => 'str' in item).map(item => 'str' in item ? item.str : '').join('').replace(/\s/g, '').toUpperCase();
      if (!text.includes(printedName((index ? next : previous) as NativePackageMember))) return fallback('The printed signer was not identified on the final page.');
      const canvas = document.createElement('canvas'); canvas.width = 612; canvas.height = 792;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return fallback('The PDF measurement surface is unavailable.');
      const task = page.render({ canvas, canvasContext: context, viewport, background: 'white' });
      const cancel = () => task.cancel(); signal.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, 15_000);
      try { await task.promise; signal.throwIfAborted(); measured.push(packageInkBounds(context.getImageData(0, 0, 612, 792).data, 612, 792)!); }
      finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); canvas.width = 0; canvas.height = 0; page.cleanup(); }
    }
    const [before, endorsement] = measured;
    if (!before || !endorsement) return fallback('Visible content could not be measured.');
    const targetTop = before.bottom - 24, targetBottom = targetTop - (endorsement.top - endorsement.bottom);
    if (targetBottom < 72 || targetTop <= targetBottom) return fallback('The complete endorsement does not fit below the preceding signature page content.');
    return { fits: true, reason: 'The entire unsigned native endorsement fits below measured signature-page content with a 24 pt separation and 72 pt bottom margin.',
      previousBottom: before.bottom, sourceTop: endorsement.top, sourceBottom: endorsement.bottom, targetTop, targetBottom };
  } catch { signal.throwIfAborted(); return fallback('PDF geometry could not be qualified; the preserved new-page layout is used.'); }
  finally { clearTimeout(timeout); signal.removeEventListener('abort', stop); await Promise.allSettled(tasks.map(task => task.destroy())); }
}

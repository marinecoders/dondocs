import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFContext } from 'pdf-lib';
import { safeUrl } from '@/lib/url-safety';

/** PDF URI actions use an ASCII URI, with international host/path characters
 * encoded by the URL parser after the application's scheme policy. */
export function taggedReferenceUrl(value: string | undefined): string | null {
  const safe = safeUrl(value);
  return safe ? new URL(safe).href : null;
}

/** Only external, explicit URI actions are admitted; no scripts, file launches,
 * additional actions, form widgets or inferred source associations. */
export function readTaggedLink(context: PDFContext, value: unknown): { ref: PDFRef; annotation: PDFDict; uri: string } {
  if (!(value instanceof PDFRef)) throw new Error('Tagged link annotations must be indirect objects.');
  const annotation = context.lookup(value, PDFDict);
  const name = PDFName.of;
  if (annotation.lookup(name('Subtype'), PDFName) !== name('Link') || annotation.has(name('AA')) || annotation.has(name('Dest'))
    || annotation.has(name('AP')) || annotation.has(name('FS'))) throw new Error('Only plain URI link annotations are supported in tagged output.');
  const action = annotation.lookup(name('A'), PDFDict);
  if (action.lookup(name('S'), PDFName) !== name('URI') || action.has(name('Next')) || action.has(name('IsMap'))) throw new Error('Unsupported tagged PDF link action.');
  const raw = action.lookup(name('URI'));
  if (!(raw instanceof PDFString || raw instanceof PDFHexString)) throw new Error('Tagged link URI is missing.');
  if (raw.asBytes().some(byte => byte < 0x21 || byte > 0x7e)) throw new Error('Tagged link URI actions must use an encoded ASCII URI.');
  const uri = raw.decodeText();
  if (!uri || uri.length > 8192 || taggedReferenceUrl(uri) !== uri) throw new Error('Tagged link URI is unsafe or not canonical.');
  const rect = annotation.lookup(name('Rect'), PDFArray);
  if (rect.size() !== 4 || rect.asArray().some(n => !(n instanceof PDFNumber) || !Number.isFinite(n.asNumber()))
    || rect.lookup(2, PDFNumber).asNumber() <= rect.lookup(0, PDFNumber).asNumber()
    || rect.lookup(3, PDFNumber).asNumber() <= rect.lookup(1, PDFNumber).asNumber()) throw new Error('Tagged link rectangle is invalid.');
  return { ref: value, annotation, uri };
}

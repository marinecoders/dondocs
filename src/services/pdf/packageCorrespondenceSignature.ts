import { PDFCrossRefSection, PDFDocument, PDFTrailer, PDFTrailerDict } from 'pdf-lib';
import { portableResourceDigest } from '@/lib/portableResources';
import { officialEdition } from '@/services/forms/nativeCatalog';
import { formAssetUrl } from '@/lib/releasePaths';
import { loadTemplatePage } from './loadTemplatePage';
import { MAX_SIGNING_PDF_BYTES } from '@/lib/manualSignatureFields';

/** Create an unsigned handoff from freshly rendered correspondence. The signer
 * sees the letter pages followed by a reusable signature sheet. The original
 * sheet is the first PDF revision so its maintained signature slot is verifiable. */
export async function prepareCorrespondenceSignature(rendered: ArrayBuffer, suppliedSheet?: ArrayBuffer) {
  const sizeError = 'Signing supports PDFs up to 20 MB.';
  if (rendered.byteLength > MAX_SIGNING_PDF_BYTES) throw new Error(sizeError);
  const profile = officialEdition('package_correspondence')!;
  const sheet = suppliedSheet ?? await loadTemplatePage(formAssetUrl(profile.directory, profile.file));
  if (await portableResourceDigest(sheet) !== profile.sha256) throw new Error('The correspondence signature sheet has changed.');
  const prior = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(new TextDecoder().decode(sheet.slice(-100)));
  if (!prior) throw new Error('The signature sheet has no readable cross-reference table.');
  const pdf = await PDFDocument.load(sheet, { updateMetadata: false });
  const letter = await PDFDocument.load(rendered, { updateMetadata: false });
  const pages = await pdf.copyPages(letter, letter.getPageIndices());
  pages.forEach((page, index) => pdf.insertPage(index, page));
  await pdf.flush();
  const { context } = pdf;
  const chunks: Uint8Array[] = [new Uint8Array(sheet)];
  let size = sheet.byteLength;
  const append = (bytes: Uint8Array) => {
    size += bytes.length;
    if (size > MAX_SIGNING_PDF_BYTES) throw new Error(sizeError);
    chunks.push(bytes);
  };
  const encode = new TextEncoder();
  append(encode.encode('\n'));
  const xref = PDFCrossRefSection.create();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    xref.addEntry(ref, size);
    append(encode.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    const length = object.sizeInBytes();
    if (length > MAX_SIGNING_PDF_BYTES - size) throw new Error(sizeError);
    const bytes = new Uint8Array(length);
    object.copyBytesInto(bytes, 0);
    append(bytes);
    append(encode.encode('\nendobj\n'));
  }
  const trailer = PDFTrailerDict.of(context.obj({ ...context.trailerInfo, Size: context.largestObjectNumber + 1, Prev: Number(prior[1]) }));
  const last = PDFTrailer.forLastCrossRefSectionOffset(size);
  append(encode.encode(xref.toString() + '\n' + trailer.toString() + '\n' + last.toString()));
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

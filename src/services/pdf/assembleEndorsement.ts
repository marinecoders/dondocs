import { PDFDocument, PDFName } from 'pdf-lib';
import { debug } from '@/lib/debug';

/**
 * Assemble an endorsement onto the basic letter it endorses.
 *
 * An endorsement is written on correspondence that comes up the chain: you
 * receive a letter, endorse it, and forward the assembly. SECNAV M-5216.5 Ch 9
 * Fig 9-3 ("Assembly of an Endorsement") is the basic letter followed by the
 * endorsement — which is what this produces: the uploaded letter's pages first,
 * the generated endorsement after.
 *
 * New-page only, by design. Ch 9 ¶1 makes a new-page endorsement always valid
 * ("If not, use a new-page endorsement"); same-page is the optional space-saver.
 * DonDocs cannot reliably place text on the signature page of a letter it did
 * not generate, so it does not try — it appends the endorsement on its own
 * page(s), which is always correct.
 */

export interface AssembleResult {
  /** The combined PDF: basic-letter pages, then endorsement pages. */
  pdfBytes: Uint8Array;
  /** How many pages the basic letter contributed (endorsement starts after). */
  basicLetterPageCount: number;
  ok: true;
}

export interface AssembleFailure {
  /** The endorsement unchanged — never a silently dropped export. */
  pdfBytes: Uint8Array;
  ok: false;
  /** Human-readable reason the upload could not be assembled. */
  error: string;
}

function toUint8(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * Validate the uploaded basic letter enough to embed it. Mirrors the check
 * mergeEnclosures runs on enclosure PDFs: it must load, have pages, and every
 * page must carry a content stream (an empty page cannot be copied).
 */
async function loadBasicLetter(
  data: Uint8Array | ArrayBuffer
): Promise<{ pdf: PDFDocument } | { error: string }> {
  try {
    // ignoreEncryption matches the enclosure path — a permissions-only password
    // (common on official PDFs) still copies; a truly encrypted body throws.
    const pdf = await PDFDocument.load(toUint8(data), { ignoreEncryption: true });
    const pageCount = pdf.getPageCount();
    if (pageCount === 0) return { error: 'The basic-letter PDF has no pages.' };
    for (let i = 0; i < pageCount; i++) {
      const contents = pdf.getPage(i).node.get(PDFName.of('Contents'));
      if (!contents) {
        return { error: `Page ${i + 1} of the basic letter is empty or corrupted.` };
      }
    }
    return { pdf };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'The basic-letter PDF could not be read.' };
  }
}

/**
 * Prepend the basic letter to the endorsement. On any problem with the upload,
 * returns the endorsement unchanged with `ok: false` and a reason — the caller
 * surfaces it rather than shipping a half-assembled or silently dropped export.
 */
export async function assembleEndorsement(
  endorsementPdfBytes: Uint8Array,
  basicLetterData: Uint8Array | ArrayBuffer
): Promise<AssembleResult | AssembleFailure> {
  const basic = await loadBasicLetter(basicLetterData);
  if ('error' in basic) {
    debug.error('AssembleEndorsement', 'Basic letter rejected:', basic.error);
    return { pdfBytes: endorsementPdfBytes, ok: false, error: basic.error };
  }

  try {
    const endorsement = await PDFDocument.load(endorsementPdfBytes);
    const out = await PDFDocument.create();

    const basicPages = await out.copyPages(basic.pdf, basic.pdf.getPageIndices());
    for (const page of basicPages) out.addPage(page);

    const endorsementPages = await out.copyPages(endorsement, endorsement.getPageIndices());
    for (const page of endorsementPages) out.addPage(page);

    const pdfBytes = await out.save();
    return { pdfBytes, basicLetterPageCount: basic.pdf.getPageCount(), ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Assembly failed.';
    debug.error('AssembleEndorsement', 'Assembly failed:', error);
    return { pdfBytes: endorsementPdfBytes, ok: false, error };
  }
}

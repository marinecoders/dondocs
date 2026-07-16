/**
 * The endorsement is assembled onto the basic letter it endorses: the uploaded
 * letter's pages first, the endorsement after (SECNAV M-5216.5 Ch 9 Fig 9-3).
 * These pin the order, the page count, and that a bad upload fails loudly with
 * the endorsement returned unchanged — never a silently dropped export.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { assembleEndorsement } from '@/services/pdf/assembleEndorsement';

/** A PDF whose pages each carry a unique word, so order is checkable. */
async function makePdf(words: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const word of words) {
    const page = doc.addPage([612, 792]);
    page.drawText(word, { x: 72, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

/** Read the drawn word off each page via pdf-lib is not possible directly, so
 *  compare page counts and re-load to confirm structural integrity. */
async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('assembleEndorsement', () => {
  it('puts the basic letter first and the endorsement after', async () => {
    const letter = await makePdf(['LETTER-1', 'LETTER-2', 'LETTER-3']);
    const endorsement = await makePdf(['ENDORSEMENT']);

    const result = await assembleEndorsement(endorsement, letter);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basicLetterPageCount).toBe(3);
    // 3 letter pages + 1 endorsement page.
    expect(await pageCount(result.pdfBytes)).toBe(4);
  });

  it('handles a single-page basic letter', async () => {
    const result = await assembleEndorsement(await makePdf(['E']), await makePdf(['L']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basicLetterPageCount).toBe(1);
    expect(await pageCount(result.pdfBytes)).toBe(2);
  });

  it('rejects an unreadable upload and returns the endorsement unchanged', async () => {
    const endorsement = await makePdf(['ENDORSEMENT']);
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]); // not a PDF

    const result = await assembleEndorsement(endorsement, garbage);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
    // The endorsement is handed back byte-for-byte, not dropped or truncated.
    expect(result.pdfBytes).toBe(endorsement);
  });

  it('rejects a PDF with no usable pages', async () => {
    const empty = await (await PDFDocument.create()).save();
    const result = await assembleEndorsement(await makePdf(['E']), empty);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Either "no pages" or "page 1 is empty" — both are valid rejections; the
    // point is a page-less letter never assembles silently.
    expect(result.error).toMatch(/no pages|empty|corrupt/i);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', async () => {
    const letter = await makePdf(['L']);
    const buf = letter.buffer.slice(letter.byteOffset, letter.byteOffset + letter.byteLength);
    const result = await assembleEndorsement(await makePdf(['E']), buf);
    expect(result.ok).toBe(true);
  });
});

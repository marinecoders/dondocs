/**
 * Word exports must carry the same page furniture the PDF does: the subject
 * repeated on continuation pages (SECNAV M-5216.5 ¶7-16) and a centered page
 * number starting at 2 (¶7-17).
 *
 * Neither survived pandoc. `\fancyhead` and `\fancyfoot` are not constructs its
 * LaTeX reader understands, so both were dropped silently — a two-page letter
 * exported to Word came out with no header parts, no footer parts and no PAGE
 * field at all, while the PDF built from the same document had both. A 1stSgt
 * reported the missing subject line; the missing page numbers turned up while
 * reproducing it.
 *
 * These assertions read the compiled zip, not the LaTeX: the whole failure mode
 * was source that looked correct and output that lacked it.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { applyPageFurniture, extractSubjectFromDocument } from '@/services/docx/pandoc-converter';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';

// Synchronous toolchain check at module load — see `docx-compile.test.ts` for
// the rationale. Marks tests SKIPPED (not falsely PASSED) when pandoc is gone.
const pandocAvailable =
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pandocAvailable) {
  console.warn(
    '[docx-page-furniture] pandoc not found on PATH — the furniture checks below will be SKIPPED.'
  );
}

const SUBJECT = 'OPERATIONAL READINESS REPORT';

/** Compile a real letter, then run the production post-pass step over it. */
async function furnish(furniture: Parameters<typeof applyPageFurniture>[2]) {
  const store = buildBaseline('naval_letter');
  store.formData.subject = SUBJECT;
  const result = await compileDocxFixture(store);
  expect(result.ok, formatDocxFailure('page-furniture', result)).toBe(true);

  const zip = await JSZip.loadAsync(result.docxBytes!);
  const before = await zip.file('word/document.xml')!.async('string');
  const after = await applyPageFurniture(zip, before, furniture);
  zip.file('word/document.xml', after);

  const read = async (name: string) => {
    const f = zip.file(name);
    return f ? f.async('string') : null;
  };
  return { zip, xml: after, read };
}

describe.skipIf(!pandocAvailable)('DOCX page furniture', () => {
  it('repeats the subject on continuation pages but not on page 1', async () => {
    const { xml, read } = await furnish({
      marking: '',
      continuationSubject: `Subj:  ${SUBJECT}`,
      wantsPageNumbers: true,
      startPage: 1,
      fontSizePt: 12,
    });

    // Page 1 and later pages must be distinguishable at all.
    expect(xml).toContain('<w:titlePg/>');

    // The default header carries the subject; the first-page header must not.
    expect(await read('word/header2.xml')).toContain(`Subj:  ${SUBJECT}`);
    expect(await read('word/header1.xml')).not.toContain(SUBJECT);

    // An absent reference makes Word inherit the default, which would put the
    // continuation subject on page 1 — so page 1's parts must exist explicitly.
    expect(xml).toContain('<w:headerReference w:type="first"');
    expect(xml).toContain('<w:headerReference w:type="default"');
  }, 120_000);

  it('leaves one blank line between the subject and the body', async () => {
    // SECNAV M-5216.5 ¶7-16: "Continue the text beginning on the second line
    // below the subject" — one clear line between them.
    //
    // The header opens at w:header=720 and the body at w:top=1440, so the
    // subject has to end at 1200 to leave a line. Measured on the PDF for the
    // same document: subject at 0.661in, body at 1.053in, a 28.2pt gap against
    // a 14.4pt line — the same one-blank-line relationship. This keeps the two
    // exports agreeing rather than each drifting to its own spacing.
    const { read } = await furnish({
      marking: '',
      continuationSubject: `Subj:  ${SUBJECT}`,
      wantsPageNumbers: true,
      startPage: 1,
      fontSizePt: 12,
    });

    // 12pt Times sets a ~276 twip line. Header opens at 720, body at 1440, so
    // the subject must start at 1440 - 2*276 = 888 to leave one clear line.
    expect(
      await read('word/header2.xml'),
      'the subject sits less than a clear line off the body',
    ).toContain('<w:spacing w:before="168"/>');
  }, 120_000);

  it('drops the lead-in when a marking already occupies the line above', async () => {
    // A marking, the subject and a clear line need three line-heights, but the
    // header opens only 720 twips above the body — 828 at 12pt. There is no
    // room for a lead-in, so the subject follows the marking directly and the
    // gap runs short of a full line on a classified letter. Recorded here so
    // it is a known limit rather than a surprise.
    const { read } = await furnish({
      marking: 'SECRET',
      continuationSubject: `Subj:  ${SUBJECT}`,
      wantsPageNumbers: true,
      startPage: 1,
      fontSizePt: 12,
    });

    const header = (await read('word/header2.xml'))!;
    expect(header).toContain('SECRET');
    expect(header, 'double-spaced the subject away from the body').not.toContain('w:before=');
  }, 120_000);

  it('numbers pages 2+ from the centered footer, leaving page 1 unnumbered', async () => {
    const { xml, read } = await furnish({
      marking: '',
      continuationSubject: '',
      wantsPageNumbers: true,
      startPage: 1,
      fontSizePt: 12,
    });

    const defaultFooter = await read('word/footer2.xml');
    expect(defaultFooter).toContain('PAGE');
    // ¶7-17: "Center page numbers 1/2 inch from the bottom edge."
    expect(defaultFooter).toContain('<w:jc w:val="center"/>');

    // ¶7-17: "Do not number ... the first page of a multiple-page letter."
    expect(await read('word/footer1.xml')).not.toContain('PAGE');
    expect(xml).toContain('<w:footerReference w:type="first"');
  }, 120_000);

  it('keeps the classification marking on page 1 once page 1 has its own header', async () => {
    // The regression this guards: turning on titlePg gives page 1 a separate
    // header, and a marking written only into the default one silently vanishes
    // from the first page of every classified letter.
    const { read } = await furnish({
      marking: 'SECRET',
      continuationSubject: `Subj:  ${SUBJECT}`,
      wantsPageNumbers: true,
      startPage: 1,
      fontSizePt: 12,
    });

    for (const part of ['header1.xml', 'header2.xml', 'footer1.xml', 'footer2.xml']) {
      expect(await read(`word/${part}`), `${part} lost the marking`).toContain('SECRET');
    }
  }, 120_000);

  it('declares every part it writes in content types and relationships', async () => {
    // A part that exists in the zip but is undeclared makes Word repair the
    // file on open, which users read as "DonDocs produced a corrupt document".
    const { xml, read } = await furnish({
      marking: 'CUI',
      continuationSubject: `Subj:  ${SUBJECT}`,
      wantsPageNumbers: true,
      startPage: 1,
      fontSizePt: 12,
    });

    const contentTypes = (await read('[Content_Types].xml'))!;
    const rels = (await read('word/_rels/document.xml.rels'))!;

    for (const name of ['header1.xml', 'header2.xml', 'footer1.xml', 'footer2.xml']) {
      expect(contentTypes, `${name} undeclared`).toContain(`/word/${name}`);
      expect(rels, `${name} unreferenced`).toContain(`Target="${name}"`);
    }

    // Every r:id used in sectPr must resolve to a declared relationship.
    const usedIds = [...xml.matchAll(/<w:(?:header|footer)Reference [^>]*r:id="([^"]+)"/g)].map(m => m[1]);
    expect(usedIds).toHaveLength(4);
    for (const id of usedIds) {
      expect(rels, `${id} not declared`).toContain(`Id="${id}"`);
    }
  }, 120_000);

  it('places sectPr children in schema order', async () => {
    // CT_SectPr is a sequence: header/footer references first, w:titlePg after
    // page setup. Word repairs a file whose sectPr is out of order.
    const { xml } = await furnish({
      marking: '',
      continuationSubject: `Subj:  ${SUBJECT}`,
      wantsPageNumbers: true,
      startPage: 1,
      fontSizePt: 12,
    });

    const sectPr = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)![0];
    const firstRef = sectPr.indexOf('<w:headerReference');
    const pgSz = sectPr.indexOf('<w:pgSz');
    const titlePg = sectPr.indexOf('<w:titlePg/>');

    expect(firstRef).toBeGreaterThan(-1);
    expect(firstRef).toBeLessThan(pgSz);
    expect(titlePg).toBeGreaterThan(pgSz);
  }, 120_000);

  it('numbers an endorsement from its own starting page, first sheet included', async () => {
    // An endorsement continues the basic letter's sequence: Ch 9 Fig 9-2 numbers
    // its opening sheet, and the number starts where the letter left off.
    // Neither survives pandoc — \setcounter{page} is dropped like the rest of
    // the page furniture — so both are the post-pass's job.
    const { xml, read } = await furnish({
      marking: '',
      continuationSubject: '',
      wantsPageNumbers: true,
      startPage: 3,
      fontSizePt: 12,
    });

    expect(xml, 'Word restarts at 1 without an explicit pgNumType').toContain(
      '<w:pgNumType w:start="3"/>',
    );
    expect(await read('word/footer1.xml'), "the endorsement's own sheet is numbered").toContain('PAGE');
  }, 120_000);

  it('leaves an unclassified single-page letter with no header or footer parts', async () => {
    // The zip had none of these before; a document wanting no furniture should
    // not start carrying four empty parts.
    const store = buildBaseline('naval_letter');
    const result = await compileDocxFixture(store);
    expect(result.ok, formatDocxFailure('no-furniture', result)).toBe(true);
    const zip = await JSZip.loadAsync(result.docxBytes!);
    const parts = Object.keys(zip.files).filter(n => /word\/(header|footer)\d*\.xml/.test(n));
    expect(parts).toEqual([]);
  }, 120_000);
});

/**
 * The subject is recovered from the rendered document rather than threaded down
 * from the store, so it has to survive every shape the address block takes. The
 * PDF templates carry \ContinuationSubject for all of these; matching only the
 * letter's "Subj:" would leave memoranda repeating their subject in the PDF and
 * silently not in Word.
 */
describe.skipIf(!pandocAvailable)('continuation subject recovery', () => {
  it.each([
    ['naval_letter', 'Subj:'],
    ['action_memorandum', 'SUBJECT:'],
    ['information_memorandum', 'SUBJECT:'],
    ['business_letter', 'SUBJECT:'],
  ])('recovers the subject and its label from a %s (%s)', async (docType, expectedLabel) => {
    const store = buildBaseline(docType);
    store.formData.subject = SUBJECT;
    const result = await compileDocxFixture(store);
    expect(result.ok, formatDocxFailure(`subject-${docType}`, result)).toBe(true);

    const zip = await JSZip.loadAsync(result.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');

    // Title-cased by some layouts, upper-cased by others — compare case-folded.
    // The label travels with the text: the PDF heads letters with "Subj:" and
    // memoranda with "SUBJECT:", and Word has to say the same thing.
    const line = extractSubjectFromDocument(xml);
    expect(line, `no subject recovered for ${docType}; its continuation header would be blank`)
      .not.toBe('');
    expect(line.toUpperCase()).toContain(SUBJECT.toUpperCase());
    expect(line.startsWith(expectedLabel), `${docType} header should lead with "${expectedLabel}", got "${line}"`)
      .toBe(true);
  }, 120_000);

  it('recovers nothing from a document with no subject line', async () => {
    // A same-page endorsement sets skipSubject; an empty result is correct and
    // must not fall through to some other paragraph's text.
    const store = buildBaseline('same_page_endorsement');
    store.formData.subject = SUBJECT;
    const result = await compileDocxFixture(store);
    expect(result.ok, formatDocxFailure('subject-none', result)).toBe(true);

    const zip = await JSZip.loadAsync(result.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(extractSubjectFromDocument(xml)).toBe('');
  }, 120_000);
});

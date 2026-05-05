/**
 * Differential PDF ⇿ DOCX content check.
 *
 * The pairwise compile matrix proves both paths COMPILE; this test
 * proves they emit consistent CONTENT. For a curated subset of
 * fixtures, compile both PDF (xelatex) and DOCX (pandoc), extract the
 * rendered text from each, and assert the user-supplied subject line
 * survives in BOTH outputs.
 *
 * Why this catches a real bug class:
 *
 *   When PR #67 first added the "underline subject" checkbox, the
 *   SwiftLaTeX template had a hard-coded `\setSubject{\uline{#1}}`
 *   that wrapped every subject in `\uline{}` regardless of the flag.
 *   The flat-generator (DOCX path) correctly honored the flag. The
 *   compile matrix was green — both paths produced valid output —
 *   but a user toggling the checkbox saw the underline in PDF and
 *   no underline in DOCX. A subject-survives-in-both content check
 *   would have caught the SOURCE divergence (PDF's subject string
 *   has `\uline{...}` wrapper that DOCX's doesn't, or vice versa).
 *
 * Curated subset rather than the full pairwise matrix because:
 *   - PDF text extraction (~100 ms) + DOCX extraction (~50 ms) per
 *     fixture is non-trivial; running on all 380 would add ~1 min
 *     to CI. The 10 fixtures here cover every doc type's UI mode
 *     (standard, joint, MOA, executive, business) plus the most
 *     bug-prone flag combinations (CUI, hyperlinks, special chars,
 *     digital signature) at sufficient depth.
 *   - The compile matrix already exercises the full pairwise
 *     coverage on the COMPILE side; this is a cross-check, not a
 *     replacement.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { compileFixture, type TestStore } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { applyFlags, buildBaseline, type DocType } from '../_helpers/compileMatrix';

// pdf-parse and mammoth are pure-JS — no native deps. Both export
// methods returning extracted plain text.
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

const xelatexAvailable =
  spawnSync('xelatex', ['--version'], { encoding: 'utf-8' }).status === 0;
const pandocAvailable =
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

const toolchainAvailable = xelatexAvailable && pandocAvailable;

if (!toolchainAvailable) {
  console.warn(
    '[differential] xelatex and/or pandoc missing — every differential check below will be SKIPPED.'
  );
}

/**
 * The curated fixture list. Each entry is a (doc-type × representative
 * flag set) tuple chosen to span every UI mode and the most bug-prone
 * dimensions. The `expected` field is a token (case-insensitive) that
 * must appear in BOTH extracted PDF and DOCX outputs for that fixture.
 *
 * Note: endorsements have a different content model — the basic
 * letter's subject is referenced indirectly via the basic-letter ID,
 * not rendered verbatim. So the endorsement fixtures check for the
 * "ENDORSEMENT on ..." token instead of a subject string.
 */
interface DiffFixture {
  name: string;
  store: TestStore;
  /** Substring that must appear in extracted text from BOTH outputs.
   *  Compared case-insensitively. */
  expected: string;
}

function navalLetter(flagDescription: string, flags: Parameters<typeof applyFlags>[1]): DiffFixture {
  return {
    name: `naval_letter:${flagDescription}`,
    store: applyFlags(buildBaseline('naval_letter'), flags),
    expected: 'OPERATIONAL READINESS REPORT',
  };
}

function plain(docType: DocType, flagDescription: string, flags: Parameters<typeof applyFlags>[1], expected: string): DiffFixture {
  return {
    name: `${docType}:${flagDescription}`,
    store: applyFlags(buildBaseline(docType), flags),
    expected,
  };
}

const FIXTURES: DiffFixture[] = [
  // Standard SECNAV letter — the dominant code path
  navalLetter('baseline', {}),
  navalLetter('cui+hyperlinks', { classLevel: 'cui', includeHyperlinks: true, hasReferences: true }),
  // specialChars overwrites the subject in applyFlags() with
  // 'BUDGET & POLICY: 50% INCREASE FOR Q1 #1 PRIORITY' — assert on a
  // distinctive un-special-cased word from that.
  plain('naval_letter', 'specialChars', { specialCharsInSubject: true }, 'BUDGET'),

  // Business letter — different layout, different code path
  plain('business_letter', 'baseline', {}, 'OPERATIONAL READINESS REPORT'),
  plain('business_letter', 'digital-sig', { signatureType: 'digital' }, 'OPERATIONAL READINESS REPORT'),

  // Executive correspondence — title-case subject; this is also the
  // doc type whose template had the missing \fi we just fixed
  plain('executive_correspondence', 'digital-sig', { signatureType: 'digital' }, 'Quarterly Report on Personnel Readiness'),

  // Joint letter / Joint memorandum — different code paths, joint*
  // fields with their own subject
  plain('joint_letter', 'baseline', {}, 'JOINT POLICY STATEMENT ON READINESS'),
  plain('joint_memorandum', 'baseline', {}, 'JOINT POLICY STATEMENT ON READINESS'),

  // MOA — uses senior/junior fields with moaSubject
  plain('moa', 'baseline', {}, 'AGREEMENT ON JOINT OPERATIONS'),

  // Same-page endorsement — basic-letter subject is NOT rendered
  // verbatim; instead the endorsement label "FIRST ENDORSEMENT on
  // <basic letter id>" appears. Both PDF and DOCX must include the
  // endorsement marker — divergence here would mean one path lost
  // the endorsement framing entirely.
  plain('same_page_endorsement', 'baseline', {}, 'ENDORSEMENT'),
];

async function extractPdfText(pdfBytes: Uint8Array): Promise<string> {
  // pdf-parse 2.x: instantiate PDFParse with the byte buffer, await
  // getText(), which returns { text, ... }. The class API is
  // session-scoped — call destroy() so the underlying pdf.js worker
  // releases its resources before the next fixture's compile.
  const parser = new PDFParse({ data: new Uint8Array(pdfBytes) });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(docxBytes: Uint8Array): Promise<string> {
  const buf = Buffer.from(docxBytes);
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value;
}

describe('Differential PDF ⇿ DOCX content', () => {
  describe.each(FIXTURES)('$name', ({ name, store, expected }) => {
    it.skipIf(!toolchainAvailable)(
      'expected text appears in both extracted PDF and DOCX outputs',
      async () => {
        const [pdfResult, docxResult] = await Promise.all([
          compileFixture(store),
          compileDocxFixture(store),
        ]);

        // First confirm both paths actually produced output. The
        // pairwise matrix should have caught any compile failure
        // earlier; this is defense in depth — if a fixture fails to
        // compile here, the diagnostic helps narrow it down to one
        // path or the other.
        if (!pdfResult.ok) {
          throw new Error(
            `${name}: PDF compile failed (xelatex exit ${pdfResult.exitCode}); ` +
            `error: ${pdfResult.errors[0] ?? '(none)'}`
          );
        }
        if (!docxResult.ok) {
          throw new Error(
            `${name}: DOCX compile failed (pandoc exit ${docxResult.exitCode}); ` +
            `last log line: ${docxResult.log.split('\n').slice(-1)[0]}`
          );
        }

        const pdfText = (await extractPdfText(pdfResult.pdfBytes!)).toLowerCase();
        const docxText = (await extractDocxText(docxResult.docxBytes!)).toLowerCase();

        const needle = expected.toLowerCase();

        expect(pdfText, `${name}: "${expected}" missing from PDF`).toContain(needle);
        expect(docxText, `${name}: "${expected}" missing from DOCX`).toContain(needle);
      },
      90_000
    );
  });
});

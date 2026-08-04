/**
 * A new-page endorsement must not repeat "Subj:" in the page header of its own
 * first sheet — that sheet already carries the real Subj: line in its address
 * block, and the header sits on top of the letterhead seal.
 *
 * Reported from the field: with "show subject line on continuation pages"
 * enabled, the subject appeared on the endorsement's first page as well.
 *
 * Cause: `main.tex` picks the first sheet's page style with
 *
 *     \@ifundefined{ps@firstpage}{\thispagestyle{documentpage}}{\thispagestyle{firstpage}}
 *
 * and `new_page_endorsement.tex` is the only one of the twenty templates that
 * defines a `documentpage` carrying `\fancyhead[L]{Subj: ...}` while defining
 * no `firstpage` at all. Its first sheet therefore falls through to the
 * continuation style.
 *
 * The omission is not gratuitous — Ch 9 Fig 9-2 numbers the endorsement's own
 * sheet, and `documentpage` is what carries the page number — so the fix keeps
 * the footer and drops only the header.
 *
 * Counting occurrences on the rendered page is the point: the duplicate is a
 * second physical "Subj:" on the sheet, which no source-level assertion sees.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';

const toolchain =
  spawnSync('pdflatex', ['--version'], { encoding: 'utf-8' }).status === 0 &&
  spawnSync('pdftotext', ['-v'], { encoding: 'utf-8' }).status === 0;

if (!toolchain) {
  console.warn('[endorsement-first-page-header] pdflatex/pdftotext missing — SKIPPING.');
}

/** Text of one page of a compiled PDF. */
async function pageText(pdf: Uint8Array, page: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-endorse-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, pdf);
  return spawnSync(
    'pdftotext',
    ['-f', String(page), '-l', String(page), '-layout', pdfPath, '-'],
    { encoding: 'utf-8' },
  ).stdout || '';
}

function endorsementStore() {
  const store = buildBaseline('new_page_endorsement');
  store.formData.subject = 'OPERATIONAL READINESS REPORT';
  // The setting the field user had on — it is what puts Subj: in the header.
  store.formData.showSubjectOnContinuation = true;
  return store;
}

describe.skipIf(!toolchain)('new-page endorsement first sheet', () => {
  it('carries exactly one Subj: line on its own first page', async () => {
    const result = await compileFixture(endorsementStore());
    expect(result.ok, formatFailure('endorsement-first-page', result)).toBe(true);

    const page1 = await pageText(result.pdfBytes!, 1);
    const occurrences = (page1.match(/Subj:/g) || []).length;

    expect(
      occurrences,
      `page 1 shows Subj: ${occurrences} times. Two means the continuation ` +
        "header is rendering on the endorsement's own first sheet, on top of " +
        `the letterhead seal.\n\n--- page 1 ---\n${page1.slice(0, 700)}`,
    ).toBe(1);
  }, 180_000);

  it('still numbers its own first sheet', async () => {
    // The half of `documentpage` the endorsement genuinely wanted. Ch 9
    // Fig 9-2 numbers the endorsement's sheet because it continues the basic
    // letter's sequence — unlike a letter's first page, which is unnumbered.
    // Without this, "give the endorsement a firstpage style" reads as "make it
    // look like a letter's first page" and the footer quietly disappears.
    const store = endorsementStore();
    store.formData.startingPageNumber = 3;

    const result = await compileFixture(store);
    expect(result.ok, formatFailure('endorsement-first-page-number', result)).toBe(true);

    const page1 = await pageText(result.pdfBytes!, 1);
    expect(
      page1.split('\n').map(l => l.trim()).includes('3'),
      `page 1 should print its page number ("3") per Fig 9-2.\n\n${page1.slice(-400)}`,
    ).toBe(true);
  }, 180_000);

  it('still repeats Subj: on a genuine continuation page', async () => {
    // The control: dropping the header from page 1 must not disable it for the
    // pages it is actually for.
    const store = endorsementStore();
    store.paragraphs = Array.from({ length: 26 }, (_, i) => ({
      text: `Paragraph ${i + 1}. ` + 'The quick brown fox jumps over the lazy dog. '.repeat(8),
      level: 0,
    }));

    const result = await compileFixture(store);
    expect(result.ok, formatFailure('endorsement-continuation', result)).toBe(true);

    const page2 = await pageText(result.pdfBytes!, 2);
    expect(page2, 'page 2 should carry the repeated subject (¶7-16)').toContain('Subj:');
  }, 180_000);
});

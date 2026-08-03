/**
 * The PDF must indent a subparagraph's first line only — the same rule the
 * DOCX path follows, from the same paragraph of the manual.
 *
 * SECNAV M-5216.5 Ch 7 ¶13: "All other lines of a subparagraph continue at the
 * left margin. Do not indent the continuation lines of a subparagraph."
 *
 * The PDF generator used `\leftskip`, which shifts every line of the paragraph,
 * under a comment asserting that ¶13 wanted continuation lines at the label
 * position — the opposite of what ¶13 says. Fixing only the Word path would
 * have left the two exports disagreeing about the same sentence.
 *
 * Measured off the rendered page: `pdftotext -layout` preserves horizontal
 * position, so the wrapped line's leading whitespace is the actual indent.
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
  console.warn('[pdf-subparagraph-indent] pdflatex/pdftotext missing — SKIPPING.');
}

/** Long enough that the subparagraph must wrap onto a second line. */
const LONG = 'Marines assigned to the detachment will complete the required '
  + 'annual training before the end of the reporting period, and the training '
  + 'officer will record completion in the unit tracker without delay.';

async function layoutText(pdf: Uint8Array): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-indent-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, pdf);
  const res = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' });
  return (res.stdout || '').split('\n');
}

const indentOf = (line: string) => line.length - line.trimStart().length;

/** The rendered lines of the paragraph that begins with `marker`. */
function paragraphLines(lines: string[], marker: string): { first: string; wrapped: string } {
  const i = lines.findIndex(l => l.includes(marker));
  expect(i, `no rendered line contains ${marker}`).toBeGreaterThan(-1);
  return { first: lines[i], wrapped: lines[i + 1] };
}

describe.skipIf(!toolchain)('PDF subparagraph indentation', () => {
  it('indents the first line and returns wrapped lines to the left margin', async () => {
    const store = buildBaseline('naval_letter');
    store.paragraphs = [
      { text: `PARENT ${LONG}`, level: 0 },
      { text: `CHILD ${LONG}`, level: 1 },
    ];

    const result = await compileFixture(store);
    expect(result.ok, formatFailure('pdf-subparagraph-indent', result)).toBe(true);
    const lines = await layoutText(result.pdfBytes!);

    const parent = paragraphLines(lines, 'PARENT');
    const child = paragraphLines(lines, 'CHILD');

    // The first line is indented relative to a level-0 paragraph...
    expect(
      indentOf(child.first),
      'the subparagraph\'s first line is not indented at all',
    ).toBeGreaterThan(indentOf(parent.first));

    // ...and the line after it comes back to the margin. Under \leftskip both
    // lines sat at the same indent, which is what ¶13 forbids.
    expect(
      indentOf(child.wrapped),
      `wrapped line sits at column ${indentOf(child.wrapped)}, first line at ` +
        `${indentOf(child.first)} — ¶13 requires continuation lines at the ` +
        `left margin.\n\n  first:   "${child.first}"\n  wrapped: "${child.wrapped}"`,
    ).toBeLessThan(indentOf(child.first));
  }, 180_000);

  it('leaves business letters on the block indent', async () => {
    // Ch 11 has no equivalent rule and the business layout deliberately indents
    // the whole block — the same split the DOCX path makes.
    const store = buildBaseline('business_letter');
    store.paragraphs = [{ text: `BIZKID ${LONG}`, level: 1 }];

    const result = await compileFixture(store);
    expect(result.ok, formatFailure('pdf-business-indent', result)).toBe(true);
    const lines = await layoutText(result.pdfBytes!);

    const biz = paragraphLines(lines, 'BIZKID');
    expect(indentOf(biz.wrapped)).toBeGreaterThanOrEqual(indentOf(biz.first) - 1);
  }, 180_000);
});

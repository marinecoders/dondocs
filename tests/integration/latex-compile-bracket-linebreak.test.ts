/**
 * A manual line break inside a paragraph must not swallow a following `[`.
 *
 * `processBodyText` turns each newline into `\\`. LaTeX then reads a `[` that
 * opens the next line as `\\`'s optional vertical-space argument, so the
 * bracket disappears into "Missing number, treated as zero" and no PDF is
 * produced. The default body placeholder is `[Your content here. ...]`, so
 * pressing Enter on the line above it was enough to kill the export.
 *
 * Sibling of `latex-compile-crlf-paragraph.test.ts`: same conversion, another
 * way for a plain keystroke to reach TeX as syntax.
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
  console.warn('[latex-compile-bracket-linebreak] pdflatex/pdftotext missing — SKIPPING.');
}

async function pdfText(pdf: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-bracket-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, pdf);
  return spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' }).stdout || '';
}

/** The store's own default body text, which is what users hit this with. */
const PLACEHOLDER = '[Your content here. Click "Templates" to load a pre-built letter format.]';

describe.skipIf(!toolchain)('line break before a bracketed line', () => {
  it.each([
    ['top-level paragraph', 0],
    ['subparagraph', 1],
  ])('compiles when a %s wraps a line onto a `[`', async (_label, level) => {
    const store = buildBaseline('naval_letter');
    store.paragraphs = [{ text: `Reference is enclosed.\n${PLACEHOLDER}`, level }];

    const result = await compileFixture(store);
    expect(result.ok, formatFailure('bracket-linebreak', result)).toBe(true);
  }, 180_000);

  it('still renders the bracket rather than eating it', async () => {
    const store = buildBaseline('naval_letter');
    store.paragraphs = [{ text: 'First line.\n[Bracketed second line.]', level: 0 }];

    const result = await compileFixture(store);
    expect(result.ok, formatFailure('bracket-preserved', result)).toBe(true);
    expect(await pdfText(result.pdfBytes!), 'the bracketed text vanished from the page')
      .toContain('[Bracketed second line.]');
  }, 180_000);

  it('keeps the deliberate blank-line spacing intact', async () => {
    // The guard must not disturb `\\[\baselineskip]`, which is emitted for a
    // pasted blank line and legitimately carries an optional argument.
    const store = buildBaseline('naval_letter');
    store.paragraphs = [{ text: 'Above the gap.\n\nBelow the gap.', level: 0 }];

    const result = await compileFixture(store);
    expect(result.ok, formatFailure('blank-line-spacing', result)).toBe(true);
    const text = await pdfText(result.pdfBytes!);
    expect(text).toContain('Above the gap.');
    expect(text).toContain('Below the gap.');
  }, 180_000);
});

/**
 * A paragraph heading takes a period only when text follows it.
 *
 * SECNAV M-5216.5 Ch 7 ¶13d says to underline a heading and capitalize its key
 * words, and stops there. The manual demonstrates the rest: of its own 75
 * standalone Title Case headings, 69 carry no punctuation at all ("14.
 * Signature Line", "a. General"). The period belongs to the sentence the
 * heading introduces, so a heading that introduces nothing does not get one.
 *
 * Reading the rendered page rather than the LaTeX, because the period sits
 * next to \underline and the question is what actually prints.
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
  console.warn('[heading-period] pdflatex/pdftotext missing — SKIPPING.');
}

/** Rendered lines, whitespace collapsed, in document order. */
async function renderedLines(pdf: Uint8Array): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-heading-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, pdf);
  const text = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' }).stdout || '';
  return text.split('\n').map((l) => l.trim().replace(/\s+/g, ' '));
}

function lineWith(lines: string[], needle: string): string {
  const line = lines.find((l) => l.includes(needle));
  expect(line, `could not find a rendered line containing "${needle}"`).toBeDefined();
  return line!;
}

describe.skipIf(!toolchain)('paragraph heading punctuation', () => {
  it('leaves a heading bare when it has no text, and keeps the period when it does', async () => {
    const store = buildBaseline('naval_letter');
    store.paragraphs = [
      { text: '', header: 'Format', level: 0 },
      { text: 'The first subparagraph carries body text.', header: '', level: 1 },
      { text: 'Body text follows this heading on the same line.', header: 'General Rules', level: 0 },
      { text: '', header: 'Deadline', level: 1 },
    ];

    const result = await compileFixture(store);
    expect(result.ok, formatFailure('heading-period', result)).toBe(true);

    const lines = await renderedLines(result.pdfBytes!);

    expect(lineWith(lines, 'Format'), 'a heading with no text of its own takes no punctuation').toBe(
      '1. Format',
    );
    expect(lineWith(lines, 'Deadline'), 'the rule holds at subparagraph level too').toBe(
      'a. Deadline',
    );
    expect(
      lineWith(lines, 'General Rules'),
      'a heading that introduces a sentence still keeps its period',
    ).toBe('2. General Rules. Body text follows this heading on the same line.');
  }, 180_000);
});

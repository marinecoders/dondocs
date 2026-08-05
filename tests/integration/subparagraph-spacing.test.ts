/**
 * Every paragraph gets a blank line before it, at every level of subparagraphing.
 *
 * SECNAV M-5216.5 Ch 7 ¶13 draws no distinction between the levels: "each
 * paragraph OR SUBPARAGRAPH begins on the second line below the previous
 * paragraph or subparagraph." Figure 7-8 prints the legend's hard-return mark
 * between every pair it shows — 1./2., a./b., (1)/(2), (a)/(b) — so the gap is
 * the same all the way down.
 *
 * Subparagraphs used to get \vspace{6pt} against a top-level paragraph's 12pt,
 * i.e. half a line, which reads as "these run together". A reviewer in the
 * field marked exactly that: an insert caret before every (1)/(2)/(3) and
 * "Space between each (#)" in the margin.
 *
 * Measuring baselines is the point. The bug is a visual gap, and a source-level
 * assertion on "\vspace{12pt}" would pass just as happily on a template that
 * swallowed the space downstream.
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
  console.warn('[subparagraph-spacing] pdflatex/pdftotext missing — SKIPPING.');
}

/** First word of each rendered line, with its baseline, in document order. */
async function renderedLines(pdf: Uint8Array): Promise<{ y: number; text: string }[]> {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-spacing-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, pdf);
  const xml =
    spawnSync('pdftotext', ['-bbox', pdfPath, '-'], { encoding: 'utf-8' }).stdout || '';
  const rows = new Map<number, { x: number; w: string }[]>();
  for (const m of xml.matchAll(
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)<\/word>/g,
  )) {
    const y = Math.round(parseFloat(m[2]));
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push({ x: parseFloat(m[1]), w: m[3] });
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, ws]) => ({
      y,
      text: ws.sort((a, b) => a.x - b.x).map((v) => v.w).join(' '),
    }));
}

function storeWithSubparagraphs() {
  const store = buildBaseline('naval_letter');
  // Each body paragraph is long enough to wrap, so the test can tell a
  // within-paragraph line gap from a between-paragraph one.
  const long = 'that will certainly wrap onto a second rendered line for measurement purposes here';
  store.paragraphs = [
    { text: `Level zero text ${long}.`, level: 0 },
    { text: `First subparagraph text ${long}.`, level: 1 },
    { text: `Second subparagraph text ${long}.`, level: 1 },
    { text: `First deep subparagraph text ${long}.`, level: 2 },
    { text: `Second deep subparagraph text ${long}.`, level: 2 },
  ];
  return store;
}

describe.skipIf(!toolchain)('subparagraph spacing', () => {
  it('puts a full blank line before a subparagraph at every level', async () => {
    const result = await compileFixture(storeWithSubparagraphs());
    expect(result.ok, formatFailure('subparagraph-spacing', result)).toBe(true);

    const lines = await renderedLines(result.pdfBytes!);

    // Single spacing, measured inside a body paragraph. Not Math.min over the
    // whole page — the letterhead is set in a smaller face with tighter
    // leading, and using it as the baseline makes every threshold trivial.
    const zero = lines.findIndex((l) => l.text.includes('Level zero text'));
    expect(zero, 'could not find the level-zero paragraph').toBeGreaterThan(0);
    const pitch = lines[zero + 1].y - lines[zero].y;

    // Each subparagraph opener must sit a blank line below the line above it —
    // i.e. roughly double the single-line pitch, not the ~1.4x that 6pt gave.
    for (const opener of ['First subparagraph', 'Second subparagraph', 'First deep', 'Second deep']) {
      const i = lines.findIndex((l) => l.text.includes(opener));
      expect(i, `could not find the "${opener}" paragraph`).toBeGreaterThan(0);
      const gap = lines[i].y - lines[i - 1].y;
      expect(
        gap,
        `"${opener}" opens ${gap.toFixed(1)}pt below the previous line; a single ` +
          `line is ${pitch.toFixed(1)}pt, so ¶13's blank line needs about ` +
          `${(pitch * 2).toFixed(1)}pt. 6pt of padding gives ~${(pitch + 6).toFixed(1)}pt.`,
      ).toBeGreaterThan(pitch + 10);
    }
  }, 180_000);

  it('gives a subparagraph the same gap a top-level paragraph gets', async () => {
    // ¶13 names them in the same breath, so the two must not differ.
    const store = buildBaseline('naval_letter');
    const long = 'that will certainly wrap onto a second rendered line for measurement purposes here';
    store.paragraphs = [
      { text: `Alpha text ${long}.`, level: 0 },
      { text: `Bravo text ${long}.`, level: 0 },
      { text: `Charlie text ${long}.`, level: 1 },
    ];
    const result = await compileFixture(store);
    expect(result.ok, formatFailure('subparagraph-spacing-parity', result)).toBe(true);

    const lines = await renderedLines(result.pdfBytes!);
    const gapBefore = (needle: string) => {
      const i = lines.findIndex((l) => l.text.includes(needle));
      expect(i, `could not find "${needle}"`).toBeGreaterThan(0);
      return lines[i].y - lines[i - 1].y;
    };

    const topLevel = gapBefore('Bravo text');
    const subParagraph = gapBefore('Charlie text');
    expect(
      Math.abs(subParagraph - topLevel),
      `a top-level paragraph opens ${topLevel.toFixed(1)}pt below its predecessor ` +
        `but a subparagraph opens ${subParagraph.toFixed(1)}pt below — ¶13 gives ` +
        `them the same gap.`,
    ).toBeLessThan(2);
  }, 180_000);
});

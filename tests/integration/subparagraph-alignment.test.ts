/**
 * A subparagraph's label sits under its parent's text.
 *
 * SECNAV M-5216.5 Figure 7-8 says it outright — "Indent each new subdivision
 * to align with the first letter of the paragraph above" — and its own
 * typography bears it out: the label of each level starts where the level
 * above prints its text. The figure also shows why a constant step cannot
 * work, printing a subdivision under "10." further right than one under "1.".
 *
 * The old fixed 0.25in was out by 32pt at level 1 and 126pt at level 3.
 *
 * This measures the rendered page rather than the LaTeX, because the whole
 * claim is about where glyphs land.
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

if (!toolchain) console.warn('[subparagraph-alignment] toolchain missing — SKIPPING.');

async function words(pdf: Uint8Array) {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-align-'));
  const p = join(dir, 'out.pdf');
  await writeFile(p, pdf);
  const xml = spawnSync('pdftotext', ['-bbox', p, '-'], { encoding: 'utf-8' }).stdout || '';
  const out: { x: number; y: number; w: string }[] = [];
  for (const m of xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/g))
    out.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), w: m[3] });
  return out;
}

describe.skipIf(!toolchain)('subparagraph alignment', () => {
  for (const font of ['times', 'courier'] as const) {
    it(`starts each label under its parent's text (${font})`, async () => {
      const store = buildBaseline('naval_letter');
      store.formData!.fontFamily = font;
      store.formData!.fontSize = '12pt';
      store.paragraphs = [
        { text: 'ZEROMARK parent text.', level: 0 },
        { text: 'ONEMARK child text.', level: 1 },
        { text: 'TWOMARK grandchild text.', level: 2 },
        { text: 'THREEMARK great grandchild text.', level: 3 },
      ];

      const result = await compileFixture(store);
      expect(result.ok, formatFailure(`subparagraph-alignment-${font}`, result)).toBe(true);
      const ws = await words(result.pdfBytes!);

      const rowFor = (mark: string) => {
        const t = ws.find((w) => w.w === mark);
        expect(t, `no rendered word ${mark}`).toBeDefined();
        const line = ws.filter((w) => Math.abs(w.y - t!.y) < 2).sort((a, b) => a.x - b.x);
        return { labelX: line[0].x, textX: t!.x };
      };

      const marks = ['ZEROMARK', 'ONEMARK', 'TWOMARK', 'THREEMARK'];
      const rows = marks.map(rowFor);
      for (let i = 1; i < rows.length; i++) {
        const drift = rows[i].labelX - rows[i - 1].textX;
        expect(
          Math.abs(drift),
          `${marks[i]} label sits ${drift.toFixed(1)}pt from where ${marks[i - 1]} ` +
            `begins its text; Figure 7-8 puts them in the same column`,
        ).toBeLessThan(1);
      }
    }, 180_000);
  }
});

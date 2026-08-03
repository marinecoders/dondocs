/**
 * The PDF and the DOCX must label paragraphs identically.
 *
 * They did not. SECNAV M-5216.5 Figure 7-8 runs the four-mark cycle twice and
 * underlines the counter the second time — the PDF underlined nothing, and the
 * DOCX underlined the whole label including its period or parentheses. Reported
 * from the field as "some are underlined, some are not".
 *
 * `paragraphLabel.ts` holds the rule and its unit test spells out every level;
 * these check that both renderers actually apply it, since the previous
 * divergence lived entirely in two copies of the same function.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';

const latexOk =
  spawnSync('pdflatex', ['--version'], { encoding: 'utf-8' }).status === 0 &&
  spawnSync('pdftotext', ['-v'], { encoding: 'utf-8' }).status === 0;
const pandocOk = spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!latexOk || !pandocOk) {
  console.warn('[label-underline-parity] toolchain incomplete — some checks SKIPPED.');
}

/** One paragraph at each of the eight levels the figure defines. */
function eightLevels() {
  const store = buildBaseline('naval_letter');
  store.paragraphs = Array.from({ length: 8 }, (_, level) => ({
    text: `MARKER${level} body text.`,
    level,
  }));
  return store;
}

describe.skipIf(!latexOk)('PDF paragraph labels', () => {
  it('renders every level without leaking markup', async () => {
    const result = await compileFixture(eightLevels());
    expect(result.ok, formatFailure('label-parity-pdf', result)).toBe(true);

    const dir = await mkdtemp(join(tmpdir(), 'dondocs-labels-'));
    const pdfPath = join(dir, 'out.pdf');
    await writeFile(pdfPath, result.pdfBytes!);
    const text = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' }).stdout;

    expect(text, 'raw LaTeX reached the page').not.toContain('uline');
    // Levels 4-7 repeat the marks of 0-3, so each appears twice.
    for (const [level, mark] of [[0, '1.'], [1, 'a.'], [2, '(1)'], [3, '(a)']] as const) {
      const line = text.split('\n').find(l => l.includes(`MARKER${level}`));
      expect(line, `level ${level} did not render`).toBeDefined();
      expect(line, `level ${level} lost its "${mark}"`).toContain(mark);
    }
  }, 180_000);
});

describe.skipIf(!pandocOk)('DOCX paragraph labels', () => {
  it('underlines the counter on levels 4-7 and nothing on 0-3', async () => {
    const result = await compileDocxFixture(eightLevels());
    expect(result.ok, formatDocxFailure('label-parity-docx', result)).toBe(true);

    const zip = await JSZip.loadAsync(result.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');

    expect(xml, 'raw LaTeX leaked into the document').not.toContain('uline');

    const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
    const forLevel = (level: number) =>
      paragraphs.find(p =>
        (p.match(/<w:t[^>]*>([^<]*)</g) || []).join('').includes(`MARKER${level}`),
      );

    for (const level of [0, 1, 2, 3]) {
      const p = forLevel(level);
      expect(p, `level ${level} did not render`).toBeDefined();
      expect(p, `level ${level} should not be underlined`).not.toContain('<w:u ');
    }
    for (const level of [4, 5, 6, 7]) {
      const p = forLevel(level);
      expect(p, `level ${level} did not render`).toBeDefined();
      expect(p, `level ${level} lost its underline`).toContain('<w:u ');
    }
  }, 180_000);

  it('leaves the period and parentheses outside the underline', async () => {
    // Figure 7-8 underlines the numeral or letter only. An underline run
    // carrying "1." or "(1)" means the whole label was wrapped instead.
    const result = await compileDocxFixture(eightLevels());
    expect(result.ok, formatDocxFailure('label-parity-punctuation', result)).toBe(true);

    const zip = await JSZip.loadAsync(result.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');

    // Every run that carries an underline, paired with its text.
    const underlinedText = [...xml.matchAll(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:u [\s\S]*?<w:t[^>]*>([^<]*)</g)]
      .map(m => m[1]);

    expect(underlinedText.length, 'no underlined runs at all').toBeGreaterThan(0);
    for (const text of underlinedText) {
      expect(text, `"${text}" is underlined but carries punctuation`).toMatch(/^[0-9a-z]+$/);
    }
  }, 180_000);
});

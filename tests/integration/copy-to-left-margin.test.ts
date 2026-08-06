/**
 * "Copy to:" and "Distribution:" addressees sit at the left margin.
 *
 * SECNAV M-5216.5 Ch 7 15b puts the label at the left margin; 15c lists the
 * addressees "in a single column at the left margin and single spaced below"
 * that line, and closes "Use this format for the 'Distribution:' lines as
 * well". The manual renders a Copy to block five times across Ch 7 and every
 * one looks like:
 *
 *     Copy to:
 *     CNO (N1, N2, N3/5)
 *     COMNAVPERSCOM (PERS 313C, PERS 49)
 *
 * Both exports used a two-column tabular, which put the first addressee beside
 * the label and every one of them 47pt in from the margin.
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

const toolchain =
  spawnSync('pdflatex', ['--version'], { encoding: 'utf-8' }).status === 0 &&
  spawnSync('pdftotext', ['-v'], { encoding: 'utf-8' }).status === 0;
const pandocAvailable = spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

const MARGIN_PT = 72;
function fixture() {
  const s = buildBaseline('naval_letter');
  s.copyTos = [{ text: 'CTONE Senior Watch Officer' }, { text: 'CTTWO Operations Officer' }];
  s.distributions = [{ text: 'DSONE Action Addressee' }, { text: 'DSTWO Second Addressee' }];
  return s;
}
const MARKS = ['CTONE', 'CTTWO', 'DSONE', 'DSTWO'];

describe.skipIf(!toolchain)('copy-to and distribution at the left margin (PDF)', () => {
  it('starts every addressee on its own line at the margin', async () => {
    const result = await compileFixture(fixture());
    expect(result.ok, formatFailure('copy-to-left-margin', result)).toBe(true);

    const dir = await mkdtemp(join(tmpdir(), 'dondocs-ct-'));
    const p = join(dir, 'out.pdf');
    await writeFile(p, result.pdfBytes!);
    const xml = spawnSync('pdftotext', ['-bbox', p, '-'], { encoding: 'utf-8' }).stdout || '';
    const words: { x: number; y: number; w: string }[] = [];
    for (const m of xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/g))
      words.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), w: m[3] });

    const label = words.find((w) => w.w === 'Copy');
    expect(label, 'no "Copy to:" label rendered').toBeDefined();
    expect(label!.x, 'the label itself belongs at the left margin (15b)').toBeCloseTo(MARGIN_PT, 0);

    for (const mark of MARKS) {
      const hit = words.find((w) => w.w === mark);
      expect(hit, `no addressee rendered for ${mark}`).toBeDefined();
      expect(
        hit!.x,
        `${mark} starts at ${hit!.x.toFixed(1)}pt; 15c puts every addressee at the ` +
          `${MARGIN_PT}pt left margin, not indented past the label`,
      ).toBeCloseTo(MARGIN_PT, 0);
      // and on its own line, not sharing the label's
      expect(Math.abs(hit!.y - label!.y), `${mark} shares the label's line`).toBeGreaterThan(2);
    }
  }, 180_000);
});

describe.skipIf(!pandocAvailable)('copy-to and distribution at the left margin (DOCX)', () => {
  it('gives every addressee its own unindented paragraph', async () => {
    const result = await compileDocxFixture(fixture());
    expect(result.ok, formatDocxFailure('docx-copy-to-left-margin', result)).toBe(true);

    const zip = await JSZip.loadAsync(result.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');
    const paras = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];

    for (const mark of MARKS) {
      const para = paras.find((p) =>
        (p.match(/<w:t[^>]*>([^<]*)</g) || [])
          .map((t) => t.replace(/^<w:t[^>]*>/, '').replace(/<$/, ''))
          .join('')
          .includes(mark),
      );
      expect(para, `no paragraph carries ${mark}`).toBeDefined();
      expect(/<w:ind[^>]*\/>/.test(para!), `${mark} carries an indent; 15c wants it flush`).toBe(false);
      const before = xml.slice(0, xml.indexOf(para!));
      const inTable = before.lastIndexOf('<w:tbl>') > before.lastIndexOf('</w:tbl>');
      expect(inTable, `${mark} is still inside a table, which is what indented it`).toBe(false);
    }
  }, 120_000);
});

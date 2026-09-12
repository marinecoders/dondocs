/**
 * The blank line before Subj: survives a To: that wraps.
 *
 * The address block closed the row before Subj: with \tabularnewline[12pt].
 * That only deepens the row by 12pt past the strut, and a p{} cell already
 * two lines tall is deeper than that on its own — so the space vanished and
 * Subj: sat directly under a long addressee. Measured off the PDF because a
 * source assertion on either spelling says nothing about the rendered gap.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { buildBaseline, type DocType } from '../_helpers/compileMatrix';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

/** First word of each rendered line, with its baseline, in document order. */
async function renderedLines(pdf: Uint8Array): Promise<{ y: number; text: string }[]> {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-subj-gap-'));
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

/** Baseline gap from the last line of the To: block to the Subj: line. */
async function gapBeforeSubject(docType: DocType, to: string) {
  const store = buildBaseline(docType);
  store.formData.to = to;
  store.formData.via = '';
  const result = await compileFixture(store);
  expect(result.ok, formatFailure(`subject-gap-${docType}`, result)).toBe(true);

  const lines = await renderedLines(result.pdfBytes!);
  const subj = lines.findIndex((l) => l.text.startsWith('Subj:'));
  expect(subj, 'could not find the Subj: line').toBeGreaterThan(0);
  const to0 = lines.findIndex((l) => l.text.startsWith('To:'));
  expect(to0, 'could not find the To: line').toBeGreaterThan(0);
  return {
    toLines: subj - to0,
    gap: lines[subj].y - lines[subj - 1].y,
    pitch: lines[to0].y - lines[to0 - 1].y,
  };
}

const LONG_TO =
  'Commanding Officer, Marine Corps Communication-Electronics School, ' +
  'Marine Air Ground Task Force Training Command, Twentynine Palms';

describe('blank line before Subj:', () => {
  describeToolchainRequirement('address-block-subject-gap');

  for (const docType of ['naval_letter', 'standard_letter', 'mfr'] as const) {
    it.skipIf(!hasPdfToolchain)(`${docType}: keeps the gap when the To: line wraps`, async () => {
      const short = await gapBeforeSubject(docType, 'Commanding General, II MEF');
      const long = await gapBeforeSubject(docType, LONG_TO);

      expect(short.toLines, 'the short addressee should fit on one line').toBe(1);
      expect(long.toLines, 'the long addressee should wrap').toBeGreaterThan(1);
      expect(short.gap).toBeGreaterThan(short.pitch + 10);
      expect(
        Math.abs(long.gap - short.gap),
        `Subj: opens ${long.gap.toFixed(1)}pt below a wrapped To: but ` +
          `${short.gap.toFixed(1)}pt below a one-line To:`,
      ).toBeLessThan(2);
    }, 180_000);
  }
});

/**
 * Finding 22: prove placement on the official printed cells, not just bounds.
 * NAVMC 11537A's six-page source is DLA NONSN00013495 (Rev. 1-2015), SHA-256
 * 1a720f6046fc2a43a8c5b881b8667cf81cfdfa9618deaa4694f86e52052093e1.
 * The old AcroForm cache lost pages 3-6 and offset their widgets by -756 pt.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderFormPdf } from '@/services/pdf/genericFormRenderer';
import { assertFormConfig, type FormValues } from '@/types/formConfig';
import { describeToolchainRequirement, hasPdfToolchain } from '../_helpers/pdfToolchain';

if (!hasPdfToolchain) describeToolchainRequirement('form-library-geometry');

async function render(directory: string, values: FormValues, check: (pdf: string) => void) {
  const root = join(process.cwd(), 'public/templates', directory);
  const config = assertFormConfig(JSON.parse(await readFile(join(root, 'form.json'), 'utf8')), directory);
  const temp = await mkdtemp(join(tmpdir(), 'form-library-geometry-'));
  try {
    const pdf = join(temp, 'filled.pdf');
    await writeFile(pdf, await renderFormPdf(config, values, {}, async (_, file) => new Uint8Array(await readFile(join(root, file)))));
    check(pdf);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function words(pdf: string, page: number) {
  return execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-bbox', pdf, '-'], { encoding: 'utf8' });
}

function wordBox(xml: string, value: string) {
  const match = [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
    .find(match => match[5] === value);
  expect(match, `Rendered value ${value} must be visible`).toBeDefined();
  return { left: Number(match![1]), top: Number(match![2]), right: Number(match![3]), bottom: Number(match![4]) };
}

describe.runIf(hasPdfToolchain)('repaired official form placements', () => {
  it('restores the RRELM body and places names in each later-page header', async () => {
    await render('NAVMC11537A - Reserve Reenlistment Extension Lateral Move (rrelm) Request', {
      name2: 'RRELMTHREE', name3: 'RRELMFOUR', name4: 'RRELMFIVE', name5: 'RRELMSIX',
    }, pdf => {
      const markers = ['RRELMTHREE', 'RRELMFOUR', 'RRELMFIVE', 'RRELMSIX'];
      const headings = ['Medical', 'Recommendations', 'recommended', 'Commanding'];
      for (const [index, marker] of markers.entries()) {
        const xml = words(pdf, index + 3);
        expect(xml).toContain(headings[index]);
        const box = wordBox(xml, marker);
        expect(box.left).toBeGreaterThan(120);
        expect(box.right).toBeLessThan(510);
        expect(box.top).toBeGreaterThan(50);
        expect(box.bottom).toBeLessThan(85);
      }
      expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Pages:\s+6/);
    });
  });

  it('writes a landscape stroke comment into the printed backstroke comment row', async () => {
    await render('NAVMC11631 - Water Survival Stroke Evaluation Checklist', { comments: 'STROKECHECK' }, pdf => {
      const box = wordBox(words(pdf, 2), 'STROKECHECK');
      expect(box.left).toBeGreaterThan(639);
      expect(box.right).toBeLessThan(757);
      expect(box.top).toBeGreaterThan(215);
      expect(box.bottom).toBeLessThan(231);
    });
  });

  it('writes every incident number down its margin rule and restores the drawing state', async () => {
    await render('OPNAV5580-1 - Incident Report', {
      incidentNumber: 'SIDEONE', incidentNumber2: 'HEADERMARK',
      incidentNumber3: 'SIDETWO', incidentNumber4: 'SIDETHREE', incidentNumber5: 'SIDEFOUR',
    }, pdf => {
      for (const [index, marker] of ['SIDEONE', 'SIDETWO', 'SIDETHREE', 'SIDEFOUR'].entries()) {
        const box = wordBox(words(pdf, index + 1), marker);
        expect(box.left).toBeGreaterThan(578);
        expect(box.right).toBeLessThan(600);
        expect(box.top).toBeGreaterThan(112);
        expect(box.bottom).toBeLessThan(243);
        expect(box.bottom - box.top).toBeGreaterThan(box.right - box.left);
      }
      const header = wordBox(words(pdf, 1), 'HEADERMARK');
      expect(header.left).toBeGreaterThan(340);
      expect(header.right).toBeLessThan(483);
      expect(header.top).toBeGreaterThan(48);
      expect(header.bottom).toBeLessThan(73);
      expect(header.right - header.left).toBeGreaterThan(header.bottom - header.top);
    });
  });
});

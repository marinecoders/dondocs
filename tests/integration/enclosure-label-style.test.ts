import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument } from 'pdf-lib';
import { mergeEnclosures, type EnclosureData } from '@/services/pdf/mergeEnclosures';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

// Read identifiers back from the rendered enclosure page.


async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText('DRAWING CONTENT', { x: 72, y: 400 });
  return doc.save();
}

async function mergedPageText(style?: 'corner' | 'footer', header?: { line1: string; line2: string }): Promise<string> {
  const enclosure = { number: 1, title: 'Wiring Diagram', data: await onePagePdf() } as unknown as EnclosureData;
  const result = await mergeEnclosures(await onePagePdf(), [enclosure], undefined, false, [], style ? { enclosureLabel: style, header } : {});
  const pdf = join(mkdtempSync(join(tmpdir(), 'encl-')), 'o.pdf');
  writeFileSync(pdf, result.pdfBytes);
  return spawnSync('pdftotext', ['-f', '2', '-l', '2', '-layout', pdf, '-'], { encoding: 'utf8' }).stdout;
}

describeToolchainRequirement('enclosure-label-style');

describe.skipIf(!hasPdfToolchain)('enclosure label placement', () => {
  it('correspondence keeps the parenthesised corner label', async () => {
    expect(await mergedPageText()).toMatch(/Enclosure \(1\)/);
  });

  it('technical publications identify the first page above its number', async () => {
    const text = await mergedPageText('footer');
    expect(text).toMatch(/Enclosure \(1\)/);
    expect(text.indexOf('Enclosure (1)')).toBeGreaterThan(text.indexOf('DRAWING CONTENT'));
  });

  it('technical publications print the short title without a repeated date', async () => {
    const text = await mergedPageText('footer', { line1: 'MI 12345A-24/1', line2: '15 December 2024' });
    const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    expect(lines[0]).toMatch(/MI 12345A-24\/1/);
    expect(lines[0]).not.toMatch(/15 December 2024/);
    expect(lines[0]).not.toMatch(/DRAWING CONTENT/);
  });
});

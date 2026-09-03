import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument } from 'pdf-lib';
import { mergeEnclosures, type EnclosureData } from '@/services/pdf/mergeEnclosures';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

// The label is read back off the rendered page. A correspondence enclosure
// keeps "Enclosure (1)" in the corner; a technical publication carries
// "Enclosure 1" centred in the footer, as MIL-STD-38784C lays it out.


async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
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

  it('technical publications label the footer, no parentheses', async () => {
    const text = await mergedPageText('footer');
    expect(text).toMatch(/Enclosure 1\b/);
    expect(text).not.toMatch(/Enclosure \(1\)/);
    // -layout keeps horizontal position: a centred label starts well past the
    // left margin on a 612pt page, where a corner label would sit far right.
    const line = text.split('\n').find((l) => /Enclosure 1/.test(l)) ?? '';
    const lead = line.length - line.trimStart().length;
    expect(lead).toBeGreaterThan(20);
  });

  it('technical publications centre the short title and date at the top', async () => {
    const text = await mergedPageText('footer', { line1: 'MI 12345A-24/1', line2: '15 December 2024' });
    const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    expect(lines[0]).toMatch(/MI 12345A-24\/1/);
    expect(lines[1]).toMatch(/15 December 2024/);
    for (const l of lines.slice(0, 2)) expect(l.length - l.trimStart().length).toBeGreaterThanOrEqual(15);
  });
});

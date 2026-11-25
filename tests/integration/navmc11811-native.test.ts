import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { generateOfficialPage11Pdf, type Page11StandingDates } from '@/services/pdf/navmc11811Native';
import type { Navmc11811Data } from '@/stores/formStore';

const source = readFileSync('public/templates/NAVMC11811 - Administrative Remarks/2014-05/original.pdf');
const original = new Uint8Array(source).buffer;
const dates: Page11StandingDates = ['2026-11-20', '2026-11-21', '2026-11-22'];
const data: Navmc11811Data = {
  lastName: 'Training', firstName: 'Example', middleName: 'F.',
  edipi: '0012345678', box11: '00003', entryDate: '23 Nov 26',
  remarksText: 'Synthetic & <training> remarks.\nSecond line.',
  remarksTextRight: 'Right column.',
  signatureBlocks: [{ statement: 'Typed acknowledgment', name: 'T. EXAMPLE' }],
};

it.skipIf(spawnSync('qpdf', ['--version']).status !== 0)('writes native XFA values and preserves the original bytes and fill permissions', async () => {
  const output = Buffer.from(await generateOfficialPage11Pdf(data, original, dates));
  expect(output.subarray(0, source.length).equals(source)).toBe(true);
  const dir = mkdtempSync(join(tmpdir(), 'dondocs-native-page11-'));
  try {
    const file = join(dir, 'filled.pdf');
    writeFileSync(file, output);
    const qpdf = (...args: string[]) => execFileSync('qpdf', [...args, file], { encoding: 'utf8' });
    expect(qpdf('--check')).toContain('No syntax or stream encoding errors found');
    expect(qpdf('--show-object=trailer')).toContain('/Type /XRef');
    expect(qpdf('--show-encryption')).toContain('modify forms: allowed');
    expect(qpdf('--show-encryption')).toContain('modify other: not allowed');
    expect(qpdf('--show-object=43')).toContain('/Perms');
    expect(qpdf('--show-object=51')).toContain('(form) 64 0 R');
    const datasets = qpdf('--show-object=5', '--filtered-stream-data');
    expect(datasets).toContain('<NameLFM>TRAINING, EXAMPLE, F.</NameLFM>');
    expect(datasets).toContain('<_11>00003</_11>');
    expect(datasets).toContain('<Remarks1>Synthetic &amp; &lt;training&gt; remarks.\nSecond line.\n\n23 Nov 26</Remarks1>');
    expect(datasets).toContain('<Remarks2>Right column.\n\n\nTyped acknowledgment\n\n\nT. EXAMPLE</Remarks2>');
    expect(datasets).not.toContain(data.edipi);
    for (const [index, date] of dates.entries()) expect(datasets).toContain(`<Date${index + 1}>${date}</Date${index + 1}>`);
    expect(qpdf('--show-object=64', '--filtered-stream-data')).toContain('<field name="EDIPI"><value><text>0012345678</text></value></field>');

    // The expected checksum comes from Acrobat's save of the original form
    // with these three synthetic edits.
    const acrobatValues = {
      ...data, lastName: '', firstName: '', middleName: '', box11: '', entryDate: '', remarksText: '',
      remarksTextRight: 'Synthetic remarks edited in Adobe Acrobat.', signatureBlocks: [],
    };
    writeFileSync(file, await generateOfficialPage11Pdf(acrobatValues, original, ['', '2026-11-23', '']));
    expect(qpdf('--show-object=64', '--filtered-stream-data')).toContain('checksum="ivHOHane0rxTZcPOh/x2HwOrz+A="');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects draft values that could be lost in the official form', async () => {
  await expect(generateOfficialPage11Pdf({ ...data, edipi: '123' }, original, dates)).rejects.toThrow('10-digit EDIPI');
  await expect(generateOfficialPage11Pdf(data, original, ['2026-02-30', '', ''])).rejects.toThrow('valid counseling dates');
  const signatureBlocks = [{ name: 'T. EXAMPLE', statement: 'Acknowledged', style: 'digital' as const }];
  await expect(generateOfficialPage11Pdf({ ...data, signatureBlocks }, original, dates)).rejects.toThrow('only supports the saved signature text');
  await expect(generateOfficialPage11Pdf({ ...data, remarksText: 'Line of text.\n'.repeat(50) }, original, dates)).rejects.toThrow('Shorten the remarks');
  await expect(generateOfficialPage11Pdf(data, new ArrayBuffer(50), dates)).rejects.toThrow('could not be verified');
});

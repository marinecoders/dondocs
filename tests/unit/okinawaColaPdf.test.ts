import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it, vi } from 'vitest';
import { compileFormDefinition } from '@/services/forms/model';
import { renderForm } from '@/services/forms/render';

vi.mock('react-pdf', async () => ({ pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }));
vi.mock('@/components/pdf/pdfConfig', async () => {
  const { GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { HARDENED_PDF_OPTIONS: { isEvalSupported: false } };
});

it.each(['mem', 'both', 'dep'])('reopens the official COLA PDF with coverage %s and both signature boxes', async coverage => {
  const directory = 'public/templates/navmc/11106/1989-01';
  const original = await readFile(directory + '/original.pdf');
  const definition = compileFormDefinition(JSON.parse(await readFile(directory + '/form.json', 'utf8')));
  const answers = { NameApplc: 'EXAMPLE, MARINE', RadA1: coverage, DutyStatn: 'Okinawa', DateArrvl: '2026 01 15' };
  const result = await renderForm({ definition, answers, rows: {}, answerRevision: 1 }, 'export', async () => original);
  expect(original.equals(result.bytes.subarray(0, original.length))).toBe(true);
  const pdf = await getDocument({ data: result.bytes, isEvalSupported: false }).promise;
  try {
    const widgets = await pdf.getFieldObjects();
    for (const [key, value] of Object.entries(answers)) {
      const entries = widgets?.[definition.fields[key].sourceIds![0]];
      expect(entries?.some(entry => 'value' in entry && entry.value === value)).toBe(true);
    }
    for (const key of ['SigMem', 'SigCO']) {
      expect(widgets?.[definition.fields[key].sourceIds![0]]).toEqual([expect.objectContaining({ type: 'signature', page: 0 })]);
    }
  } finally { await pdf.destroy(); }
});

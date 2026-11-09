import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import mammoth from 'mammoth';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { moaFixture } from '../_helpers/moaFixture';

const pandocAvailable = spawnSync('pandoc', ['--version'], { encoding: 'utf8' }).status === 0;

describe('agreement Word exports', () => {
  it.skipIf(!pandocAvailable).each([
    ['moa', false], ['mou', false], ['moa', true], ['mou', true],
  ] as const)('%s preserves both middle initials (compact input: %s)', async (docType, compact) => {
    const store = moaFixture(docType);
    if (compact) Object.assign(store.formData, { seniorSigName: 'J.M. RIVERA', juniorSigName: 'A.T. MORGAN' });
    const result = await compileDocxFixture(store);
    if (!result.ok) throw new Error(formatDocxFailure(docType, result));
    const docx = await postProcessDocx(new Blob([new Uint8Array(result.docxBytes!)]), { docType });
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await docx.arrayBuffer()) });
    expect(value).toContain('A. T. MORGAN');
    expect(value).toContain('J. M. RIVERA');
    expect(value).toContain('Commanding Officer');
    expect(value).toContain('Commanding General');
    expect(value).toContain('Ser S-3/001');
    expect(value).toContain('Ser 002');
  });
});

it.skipIf(!pandocAvailable).each(['moa', 'mou'])('%s uses the same closing paragraph numbers as PDF', async docType => {
  const store = moaFixture(docType);
  store.paragraphs = [{ level: 0, text: 'PREAMBLE statement.' },
    ...Array.from({ length: 40 }, () => ({ level: 0, text: '' })),
    { level: 0, text: 'CLOSING responsibility.' }, { level: 0, text: '' }];
  const source = structuredClone(store.paragraphs);
  const result = await compileDocxFixture(store);
  if (!result.ok) throw new Error(formatDocxFailure(docType, result));
  const docx = await postProcessDocx(new Blob([new Uint8Array(result.docxBytes!)]), { docType });
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await docx.arrayBuffer()) });
  expect(value).toMatch(/2\.\s+CLOSING responsibility/);
  expect(value).not.toMatch(/42\./);
  expect(store.paragraphs).toEqual(source);
});

it('has Pandoc available for agreement Word checks in CI', () => {
  if (process.env.CI) expect(pandocAvailable).toBe(true);
});

it.skipIf(!pandocAvailable).each(['moa', 'mou'])('%s retains family names, suffixes and compact initials in Word', async docType => {
  const store = moaFixture(docType);
  Object.assign(store.formData, { seniorSigName: 'Jordan M. Rivera Jr.', juniorSigName: 'J.M de la Cruz' });
  const result = await compileDocxFixture(store);
  if (!result.ok) throw new Error(formatDocxFailure(docType, result));
  const docx = await postProcessDocx(new Blob([new Uint8Array(result.docxBytes!)]), { docType });
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await docx.arrayBuffer()) });
  expect(value).toContain('J. M. RIVERA JR.');
  expect(value).toContain('J. M. DE LA CRUZ');
});

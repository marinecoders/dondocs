import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { expect, it } from 'vitest';
import { describeToolchainRequirement, hasPdfToolchain } from '../_helpers/pdfToolchain';

describeToolchainRequirement('standalone TeX example');

it.skipIf(!hasPdfToolchain)('make pdf builds the checked-in example outside the source directory', async () => {
  const output = mkdtempSync(join(tmpdir(), 'dondocs-make-pdf-'));
  execFileSync('make', ['pdf', `TEX_BUILD_DIR=${output}`], { timeout: 120_000, stdio: 'pipe' });
  const bytes = readFileSync(join(output, 'main.pdf'));
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(pdf.getCreator()).toBe('DonDocs');
  expect(pdf.getProducer()).toBe('DonDocs (pdfTeX)');
  const text = execFileSync('pdftotext', [join(output, 'main.pdf'), '-'], { encoding: 'utf8' });
  expect(text).toContain('UNITED STATES MARINE CORPS');
  expect(text).toContain('SECNAV');
}, 120_000);

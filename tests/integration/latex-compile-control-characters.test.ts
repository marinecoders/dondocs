import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';
import { describeToolchainRequirement, hasPdfToolchain } from '../_helpers/pdfToolchain';

const CONTROLS = Array.from({ length: 32 }, (_, code) => code)
  .filter((code) => ![9, 10, 13].includes(code))
  .concat(0x7f)
  .map((code) => String.fromCharCode(code))
  .join('');

describe('control characters in document fields', () => {
  describeToolchainRequirement('latex-compile-control-characters');

  it.skipIf(!hasPdfToolchain)('compile in the fields a paste reaches', async () => {
    const store = buildBaseline('naval_letter');
    const text = `Alpha${CONTROLS}Bravo`;
    Object.assign(store.formData, { subject: text, from: text, to: text });
    store.references = [{ letter: 'a', title: text }];
    store.enclosures = [{ title: text }];
    store.copyTos = [{ text }];
    store.paragraphs = [{ level: 0, header: text, text }];

    const result = await compileFixture(store);
    expect(result.ok, formatFailure('control-characters', result)).toBe(true);
    const pdf = execFileSync('pdftotext', [join(result.workDir, 'main.pdf'), '-'], { encoding: 'utf8' });
    expect(pdf.toUpperCase().match(/ALPHA +BRAVO/g)?.length).toBeGreaterThanOrEqual(6);
  }, 180_000);
});

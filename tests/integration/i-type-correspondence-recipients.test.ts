import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { toStore } from '../../companion/letterInput';
import { companionPublication } from '../_helpers/companionPublication';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const copyTos = [{ text: 'SYNTHETIC COPY RECIPIENT' }];
const distributions = [{ text: 'SYNTHETIC LETTER DISTRIBUTION' }];

describeToolchainRequirement('i-type-correspondence-recipients');
describe.skipIf(!hasPdfToolchain)('I-Type correspondence recipients in rendered output', () => {
  it.each(['MI', 'TI', 'SI', 'LI'] as const)('omits inherited letter lists from the %s PDF and retains publication distribution', async (type) => {
    const store = { ...toStore(companionPublication(type)), copyTos, distributions };
    const result = await compileFixture(store);
    expect(result.ok, formatFailure(`i-type-correspondence-recipients-${type}`, result)).toBe(true);
    const extracted = spawnSync('pdftotext', ['-layout', join(result.workDir, 'main.pdf'), '-'], { encoding: 'utf8' });
    expect(extracted.status, extracted.stderr).toBe(0);
    expect(extracted.stdout).not.toContain('SYNTHETIC');
    expect(extracted.stdout).not.toContain('Copy to:');
    expect(extracted.stdout).toContain('DISTRIBUTION STATEMENT A:');
    expect(extracted.stdout).toContain('DISTRIBUTION: EDO');
    expect(store).toMatchObject({ copyTos, distributions });
  });

  it('continues to render both recipient lists for a naval letter', async () => {
    const store = { ...buildBaseline('naval_letter'), copyTos, distributions };
    const result = await compileFixture(store);
    expect(result.ok, formatFailure('naval-letter-correspondence-recipients', result)).toBe(true);
    const extracted = spawnSync('pdftotext', ['-layout', join(result.workDir, 'main.pdf'), '-'], { encoding: 'utf8' });
    expect(extracted.status, extracted.stderr).toBe(0);
    expect(extracted.stdout).toContain(copyTos[0].text);
    expect(extracted.stdout).toContain(distributions[0].text);
  });
});

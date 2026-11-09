import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { toStore } from '../../companion/letterInput';
import { companionPublication } from '../_helpers/companionPublication';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';
import { iTypeExportErrors } from '@/lib/iTypePreflight';

describeToolchainRequirement('i-type-required-body-tables');
describe.skipIf(!hasPdfToolchain)('I-Type required body table export', () => {
  it('blocks prose-only item data until the body table is attached and populated, then renders its columns', async () => {
    const store = toStore(companionPublication('TI'));
    const paragraph = { level: 0, header: 'Major Items Affected', text: 'SUPPORT BRACKET 1005-01-566-1100 A02557G 12345A.', tableKey: undefined as string | undefined };
    store.paragraphs.push(paragraph);
    expect(iTypeExportErrors(store).join(' ')).toContain('attach the Major Items Affected table');

    paragraph.tableKey = 'majorItems';
    store.publicationTables = { majorItems: [{ values: {} }] };
    expect(iTypeExportErrors(store).join(' ')).toContain('add at least one item row');

    store.publicationTables.majorItems[0].values = { description: 'SUPPORT BRACKET', nsn: '1005-01-566-1100', tamcn: 'A02557G', id: '12345A' };
    paragraph.text = '';
    expect(iTypeExportErrors(store)).toEqual([]);
    const result = await compileFixture(store);
    expect(result.ok, formatFailure('i-type-required-body-tables', result)).toBe(true);
    const extracted = spawnSync('pdftotext', ['-layout', join(result.workDir, 'main.pdf'), '-'], { encoding: 'utf8' });
    expect(extracted.status, extracted.stderr).toBe(0);
    const body = extracted.stdout.split('\f').slice(2).join('\n');
    expect(body).toMatch(/Description\s+NSN\s+TAMCN\s+I\.D\. No\./);
    expect(body).toMatch(/SUPPORT BRACKET\s+1005-01-566-1100\s+A02557G\s+12345A/);
  });
});

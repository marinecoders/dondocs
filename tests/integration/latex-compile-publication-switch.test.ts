import { describe, expect, it } from 'vitest';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { useDocumentStore } from '@/stores/documentStore';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

// Type changes preserve publication data so switching back can restore it.
// A non-publication template must never receive I-Type-only commands.
describeToolchainRequirement('publication table footnotes across document types');
describe.skipIf(!hasPdfToolchain)('publication table footnotes across document types', () => {
  it.each(['naval_letter', 'moa', 'i_type'])('compiles %s with retained publication metadata', async (docType) => {
    const store = {
      ...useDocumentStore.getState(),
      docType,
      paragraphs: [{
        level: 0, text: 'Inspect the assembly.', header: 'Materiel Required',
        tableKey: 'materielRequired',
        tableFootnotes: [{ id: '1', text: 'Quantity per assembly.' }],
      }],
      publicationTables: {},
    };
    const result = await compileFixture(store);
    expect(result.ok, formatFailure(docType, result)).toBe(true);
    expect(result.pdfBytes?.byteLength).toBeGreaterThan(0);
  });
});

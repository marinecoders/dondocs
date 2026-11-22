import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compileFixture } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';
import { sourcesOnPage } from '@/lib/previewSources';
import { ambiguousEndorsementBodySources } from '@/lib/previewSourceProvenance';

describe.skipIf(!hasPdfToolchain)('native endorsement source provenance', () => {
  it('does not send a second-endorsement paragraph back to the independently editable main body', async () => {
    const store = buildBaseline('naval_letter');
    const text = 'The participating commands approve these shared training arrangements.';
    store.paragraphs = [{ id: 'original', text, level: 0 }];
    Object.assign(store.formData, { appendEndorsement: true,
      endorsementBody: 'The first signer acknowledges this action.', endorsementSigLast: 'FIRST',
      additionalEndorsements: [{ id: 'second', endorsementBody: text, endorsementSigLast: 'SECOND' }],
    });
    const rendered = await compileFixture(store);
    expect(rendered.ok, rendered.logTail).toBe(true);
    const pdf = await getDocument({ data: new Uint8Array(rendered.pdfBytes!), useSystemFonts: true }).promise;
    try {
      expect(pdf.numPages).toBeGreaterThan(1);
      const page = (await (await pdf.getPage(2)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
      expect(page).toContain('SECOND ENDORSEMENT');
      const source = { id: 'original', paragraphId: 'original', text, label: 'Paragraph 1', sectionId: 'body' };
      // The independently editable endorsement really does contain the same
      // text; the hook's provenance guard must suppress that misleading link.
      expect(sourcesOnPage(page, [source])).toEqual([source]);
      const ambiguous = ambiguousEndorsementBodySources(store.docType, store.formData, store.paragraphs);
      expect(sourcesOnPage(page, [source].filter(candidate => !ambiguous.has(candidate.id)))).toEqual([]);
    } finally { await pdf.destroy(); }
  });
});

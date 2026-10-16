import { describe, expect, it } from 'vitest';
import type { Paragraph } from '@/types/document';
import { publicationReferences, validatePublicationReferences } from '@/lib/publicationReferences';
import { publicationReferenceText } from '@/services/latex/publicationReferenceText';
import { generateBodyTex } from '@/services/latex/generator';
import { useDocumentStore } from '@/stores/documentStore';

const id = 'ABCDEF0123456789ABCDEF0123456789';
const target: Paragraph = { level: 0, header: 'Inspection', text: 'Inspect the bracket.', referenceId: id };
const reference: Paragraph = { level: 0, header: 'Purpose', text: `See {{PUBREF_P_${id}}}.` };

describe('publication references', () => {
  it('keeps a reference attached to its target after renumbering', () => {
    const before = publicationReferences([reference, target]);
    const after = publicationReferences([reference, { level: 0, text: 'Extra paragraph.' }, target]);
    expect(publicationReferenceText(reference.text, before)).toContain('paragraph 2');
    expect(publicationReferenceText(reference.text, after)).toContain('paragraph 3');
    expect(publicationReferenceText(reference.text, after)).toContain('itype.p.2');
  });
  it('flags typed references that have no link', () => {
    expect(validatePublicationReferences([{ ...reference, text: 'See paragraph 2.' }, target]).join(' ')).toContain('Use Insert');
    expect(validatePublicationReferences([reference, target])).toEqual([]);
  });
  it('rejects deleted or duplicated targets', () => {
    expect(validatePublicationReferences([reference])).toContain('A publication reference has no target. Reinsert it or restore the deleted target.');
    expect(validatePublicationReferences([reference, target, target]).join(' ')).toContain('Duplicate reference');
  });
  it('numbers appendix figures, tables and footnotes separately', () => {
    const paragraphs: Paragraph[] = [
      target, { level: 0, appendix: true, header: 'Data', text: '' },
      { level: 0, figure: {}, text: 'Drawing' },
      { ...target, tableKey: 'materielRequired', tableFootnotes: [{ id: 'a', text: 'Install two.' }] },
    ];
    const refs = publicationReferences(paragraphs, { materielRequired: [{ values: { description: 'BOLT' } }] });
    expect(refs.map((r) => r.label)).toEqual(['paragraph 1', 'appendix A', 'figure A-1', 'paragraph A-1', 'table A-1', 'table A-1, footnote a']);
  });
  it('writes links for untitled paragraphs and table footnotes', () => {
    const store = { ...useDocumentStore.getState(), docType: 'i_type', paragraphs: [reference, { ...target, header: '', tableKey: 'materielRequired', tableFootnotes: [{ id: 'a', text: 'Install two.' }] }], publicationTables: { materielRequired: [{ values: { description: 'BOLT' } }] } };
    const tex = generateBodyTex(store);
    expect(tex).toContain('\\dondocsReferenceAnchor{itype.p.1}');
    expect(tex).toContain('\\dondocsReferenceAnchor{itype.note.1.A}');
    expect(tex).toContain('\\dondocsReferenceLink{itype.p.1}');
  });
  it('links external publications and preserves case-sensitive URLs in warnings', () => {
    expect(publicationReferenceText('See https://example.mil/CaseSensitive.', [], true)).toContain('\\dondocsExternalLink{https://example.mil/CaseSensitive}');
  });
  it('rejects footnotes that would not render', () => {
    expect(validatePublicationReferences([{ ...target, tableFootnotes: [{ id: 'a', text: '' }] }]).join(' ')).toContain('populated table');
  });
});

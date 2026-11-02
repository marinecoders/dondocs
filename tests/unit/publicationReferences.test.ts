import { describe, expect, it } from 'vitest';
import { DOC_TYPE_CONFIG, type Paragraph } from '@/types/document';
import { publicationReferences, validatePublicationReferences } from '@/lib/publicationReferences';
import { publicationReferenceText } from '@/services/latex/publicationReferenceText';
import { generateBodyTex } from '@/services/latex/generator';
import { useDocumentStore } from '@/stores/documentStore';
import { withoutTableFootnote } from '@/lib/tableFootnotes';
import { publicationNavigation } from '@/services/latex/publicationNavigation';

const id = 'ABCDEF0123456789ABCDEF0123456789';
const target: Paragraph = { level: 0, header: 'Inspection', text: 'Inspect the bracket.', referenceId: id };
const reference: Paragraph = { level: 0, header: 'Purpose', text: `See {{PUBREF_P_${id}}}.` };

describe('publication references', () => {
  it.each(Object.keys(DOC_TYPE_CONFIG).filter(type => type !== 'i_type' && type !== 'sl3'))(
    'does not emit publication tables or footnotes for %s after a format switch', (docType) => {
      const paragraphs = [{ ...target, tableKey: 'materielRequired', tableFootnotes: [{ id: '1', text: 'Publication-only note.' }] }];
      const tables = { materielRequired: [{ values: { description: 'PUBLICATION-ONLY-ITEM' } }] };
      const store = { ...useDocumentStore.getState(), docType, paragraphs, publicationTables: tables };
      const before = structuredClone({ paragraphs, tables });
      const tex = generateBodyTex(store);
      expect(tex).toContain('Inspect the bracket.');
      expect(tex).not.toContain('\\dondocsReferenceAnchor');
      expect(tex).not.toContain('Publication-only note.');
      expect(tex).not.toContain('PUBLICATION-ONLY-ITEM');
      expect({ paragraphs, tables }).toEqual(before);
      const restored = generateBodyTex({ ...store, docType: 'i_type' });
      expect(restored).toContain('\\dondocsReferenceAnchor{itype.note.0.1}');
      expect(restored).toContain('Publication-only note.');
      expect(restored).toContain('PUBLICATION-ONLY-ITEM');
    },
  );
  it('includes printed paragraph labels in bookmarks, including appendices', () => {
    const paragraphs: Paragraph[] = [target, { ...target, level: 1 }, { level: 0, appendix: true, header: 'Data', text: '' }, target];
    const navigation = publicationNavigation(paragraphs);
    expect(navigation.get('itype.p.0')?.title).toBe('1. Inspection');
    expect(navigation.get('itype.p.1')?.title).toBe('a. Inspection');
    expect(navigation.get('itype.p.3')?.title).toBe('A-1. Inspection');
  });
  it('does not exempt internal references because another URL is present', () => {
    expect(validatePublicationReferences([{ ...reference, text: 'See paragraph 2. Source: https://example.mil.' }, target]).join(' ')).toContain('Use Insert');
    const text = 'See [Example Manual, TM 123, paragraph 2](https://example.mil/Manual#paragraph-2).';
    expect(validatePublicationReferences([{ ...reference, text }])).toEqual([]);
    expect(publicationReferenceText(text, [])).toContain('\\dondocsExternalLink{https://example.mil/Manual\\#paragraph-2}{Example Manual, TM 123, paragraph 2}');
  });
  it('links table-cell notes as superscripts and rejects body or foreign-table citations', () => {
    const note = `{{PUBREF_N_${id}_1}}`;
    const p: Paragraph = { ...target, tableKey: 'materielRequired', tableFootnotes: [{ id: '1', text: 'Quantity per assembly.' }] };
    const tables = { materielRequired: [{ values: { description: `BOLT${note}` } }] };
    expect(validatePublicationReferences([p], tables)).toEqual([]);
    const refs = publicationReferences([p], tables);
    expect(publicationReferenceText(note, refs)).toBe('\\textsuperscript{\\dondocsReferenceLink{itype.note.0.1}{1}}');
    expect(validatePublicationReferences([{ ...p, text: note }], tables).join(' ')).toContain('only within');
    expect(validatePublicationReferences([p, { level: 0, text: '', tableKey: 'components' }], { ...tables, components: [{ values: { description: note } }] }).join(' ')).toContain('only within');
    expect(validatePublicationReferences([{ ...p, tableFootnotes: [{ id: '1', text: 'One.' }, { id: '3', text: 'Three.' }] }], tables).join(' ')).toContain('consecutively');
    const tex = generateBodyTex({ ...useDocumentStore.getState(), docType: 'i_type', paragraphs: [p], publicationTables: tables });
    expect(tex).toContain('BOLT\\textsuperscript{\\dondocsReferenceLink{itype.note.0.1}{1}}');
    expect(tex).toContain('\\hspace*{5\\fontdimen2\\font}');
  });
  it('renumbers remaining notes and their citations atomically when a note is removed', () => {
    const p = { ...target, tableKey: 'materielRequired', tableFootnotes: [1, 2, 3].map((n) => ({ id: String(n), text: `Note ${n}.` })) };
    const tables = { materielRequired: [{ values: { description: `BOLT{{PUBREF_N_${id}_2}}{{PUBREF_N_${id}_3}}` } }] };
    const updated = withoutTableFootnote([p], tables, 0, 1);
    expect(updated.paragraphs[0].tableFootnotes).toEqual([{ id: '1', text: 'Note 1.' }, { id: '2', text: 'Note 3.' }]);
    expect(updated.publicationTables.materielRequired[0].values.description).toBe(`BOLT{{PUBREF_N_${id}_2}}`);
    expect(validatePublicationReferences(updated.paragraphs, updated.publicationTables)).toEqual([]);
  });
  it('keeps a reference attached to its target after renumbering', () => {
    const before = publicationReferences([reference, target]);
    const after = publicationReferences([reference, { level: 0, text: 'Extra paragraph.' }, target]);
    expect(publicationReferenceText(reference.text, before)).toContain('paragraph 2');
    expect(publicationReferenceText(reference.text, after)).toContain('paragraph 3');
    expect(publicationReferenceText(reference.text, after)).toContain('itype.p.2');
  });
  it('retains references through snapshot restore and paragraph moves', () => {
    const original = useDocumentStore.getState();
    try {
      useDocumentStore.setState({ paragraphs: [reference, target], docType: 'i_type' });
      const snapshot = JSON.parse(JSON.stringify(useDocumentStore.getState().getSnapshot()));
      useDocumentStore.setState({ paragraphs: [] });
      useDocumentStore.getState().applySnapshot(snapshot);
      useDocumentStore.getState().reorderParagraphs(1, 0);
      const restored = useDocumentStore.getState().paragraphs;
      expect(validatePublicationReferences(restored)).toEqual([]);
      expect(publicationReferenceText(reference.text, publicationReferences(restored))).toContain('paragraph 1');
    } finally { useDocumentStore.setState(original); }
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

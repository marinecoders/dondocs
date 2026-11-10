import { describe, expect, it } from 'vitest';
import { toStore } from '../../companion/letterInput';
import { companionPublication } from '../_helpers/companionPublication';
import { iTypeExportErrors } from '@/lib/iTypePreflight';
import { I_TYPE_TABLES } from '@/data/techpub/tables';
import type { PublicationSection } from '@/data/techpub/sections';
import { validatePublicationTableAttachments } from '@/lib/publicationTableValidation';
import type { Paragraph, PublicationTableRow } from '@/types/document';

const values: Record<string, string> = { item: '1', description: 'SUPPORT BRACKET', nsn: '1005-01-566-1100', tamcn: 'A02557G', id: '12345A', pn: 'SYN-1', qty: '1' };

// The reported I-Type printed item data as prose under Major Items Affected.
// Checking only tables already present in publicationTables missed that case.
describe('required I-Type body tables', () => {
  it.each(I_TYPE_TABLES)('rejects item prose without the $name table', ({ key, name }) => {
    const store = toStore(companionPublication('TI'));
    store.paragraphs.push({ level: 0, publicationSection: key as PublicationSection, header: name, text: 'SUPPORT BRACKET 1005-01-566-1100 A02557G 12345A.' });
    expect(iTypeExportErrors(store).some((message) => message.includes(name) && message.includes('table'))).toBe(true);
  });

  it('rejects an attached table with no item rows when the section contains prose', () => {
    const store = toStore(companionPublication('TI'));
    store.paragraphs.push({ level: 0, header: 'Major Items Affected', text: 'The support bracket is affected.', tableKey: 'majorItems' });
    store.publicationTables = { majorItems: [{ values: {} }] };
    expect(iTypeExportErrors(store).some((message) => message.includes('Major Items Affected') && message.includes('row'))).toBe(true);
  });

  it.each(I_TYPE_TABLES)('accepts the populated $name table attached to its section', (spec) => {
    const store = toStore(companionPublication('TI'));
    store.paragraphs.push({ level: 0, publicationSection: spec.key as PublicationSection, header: spec.name, text: 'See the listed item.', tableKey: spec.key });
    store.publicationTables = { [spec.key]: [{ values: Object.fromEntries(spec.columns.map((column) => [column.key, values[column.key]])) }] };
    expect(iTypeExportErrors(store)).toEqual([]);
  });

  it.each(['', 'None.', 'N/A', '**Not applicable.**'])('keeps empty or explicitly inapplicable sections optional: %s', (text) => {
    const paragraphs = I_TYPE_TABLES.map((spec) => ({ level: 0, header: spec.name, text, tableKey: spec.key }));
    expect(validatePublicationTableAttachments(paragraphs)).toEqual([]);
  });

  it('requires the correct table on the actual body section', () => {
    const paragraph: Paragraph = { level: 0, header: 'Major Items Affected', text: 'The bracket is affected.', tableKey: 'components' };
    const rows: PublicationTableRow[] = [{ values }];
    expect(validatePublicationTableAttachments([paragraph], { components: rows }).join(' ')).toContain('attach the Major Items Affected table');
    paragraph.tableKey = undefined;
    expect(validatePublicationTableAttachments([
      { level: 0, header: 'Information', text: '', tableKey: 'majorItems' }, paragraph,
    ], { majorItems: rows }).join(' ')).toContain('Paragraph 2 (Major Items Affected): attach');
  });

  it('recognizes retained section identity and older documents with headings only', () => {
    expect(validatePublicationTableAttachments([{ level: 0, publicationSection: 'majorItems', header: 'Changed heading', text: 'Affected item.' }]).join(' ')).toContain('Major Items Affected');
    expect(validatePublicationTableAttachments([{ level: 0, header: 'Major Items Affected.', text: 'Affected item.' }])).toHaveLength(1);
  });

  it('checks child item prose without borrowing content from the following section', () => {
    const paragraph = { level: 0, header: 'Major Items Affected', text: '' };
    const child = { level: 1, text: 'SUPPORT BRACKET 1005-01-566-1100.' };
    expect(validatePublicationTableAttachments([paragraph, child]).join(' ')).toContain('attach the Major Items Affected table');
    expect(validatePublicationTableAttachments([
      paragraph, { level: 1, text: 'None.' }, { level: 0, header: 'Information', text: 'Inspect the bracket.' },
    ])).toEqual([]);
    expect(validatePublicationTableAttachments([
      paragraph, { level: 0, text: 'An unheaded following section.' },
    ])).toEqual([]);
  });

  it('does not count grouping labels as item rows', () => {
    const paragraph: Paragraph = { level: 0, header: 'Materiel Required', text: '', tableKey: 'materielRequired' };
    expect(validatePublicationTableAttachments([paragraph], { materielRequired: [{ values: { description: 'Consisting of:' } }] }).join(' ')).toContain('add at least one item row');
  });

  it('ignores similarly titled figures, callouts, procedures and appendix material', () => {
    const base = { level: 0, header: 'Major Items Affected', text: 'Reference material.' };
    const paragraphs: Paragraph[] = [{ ...base, figure: {} }, { ...base, callout: 'note' }, { ...base, procedure: true }, { ...base, appendix: true }, base];
    expect(validatePublicationTableAttachments(paragraphs)).toEqual([]);
  });

  it('does not enforce publication tables on correspondence or change saved prose', () => {
    const store = toStore(companionPublication('TI'));
    store.docType = 'naval_letter';
    store.paragraphs.push({ level: 0, header: 'Major Items Affected', text: 'Retained letter content.' });
    const original = structuredClone(store.paragraphs);
    expect(iTypeExportErrors(store)).toEqual([]);
    expect(store.paragraphs).toEqual(original);
  });
});

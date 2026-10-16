import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';

// "Clear all fields" empties the paragraphs, references and enclosures. A
// publication's end items and table rows are document content in the same
// sense, and were left behind: the next publication's headings picked up the
// previous one's parts lists.
describe('clearing fields on a publication', () => {
  beforeEach(() => {
    useDocumentStore.getState().resetForm();
  });

  it('empties the end items and every table with the rest of the content', () => {
    const s = useDocumentStore.getState();
    s.setDocType('i_type');
    useDocumentStore.setState({
      endItems: [{ nsn: '1005-01-566-1100', tamcn: 'A02550G', id: '11030A', model: 'M40A6' }],
      publicationTables: {
        majorItems: [{ values: { description: 'RIFLE, 7.62MM, M40A6' } }],
        specialTools: [{ values: { description: 'WRENCH, TORQUE' } }],
      },
    });

    useDocumentStore.getState().clearFieldsExceptLetterhead();

    expect(useDocumentStore.getState().endItems).toEqual([]);
    expect(useDocumentStore.getState().publicationTables).toEqual({});
    // The letterhead survives, as it does for every other doc type.
    expect(useDocumentStore.getState().paragraphs).toHaveLength(1);
  });
});

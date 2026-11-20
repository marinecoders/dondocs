import { useAlertStore } from '@/stores/alertStore';
import { describe, expect, it } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { DOC_TYPE_CONFIG } from '@/types/document';

const ordinaryTypesWithoutReferences = Object.entries(DOC_TYPE_CONFIG)
  .filter(([type, config]) => !config.compliance.allowReferences && !['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'].includes(type))
  .map(([type]) => type);

describe('reference identities across temporarily hidden formal lists', () => {
  it.each(ordinaryTypesWithoutReferences)('retains citation targets through %s and back to an endorsement', type => {
    useDocumentStore.setState({ documentMode: 'compliant', documentCategory: 'correspondence', docType: 'same_page_endorsement',
      formData: { startingReferenceLetter: 'g', via: 'Office w/ref (h)' },
      references: [{ letter: 'g', title: 'Alpha', url: 'https://example.com/alpha' }, { letter: 'h', title: 'Bravo', url: 'https://example.com/bravo' }],
      paragraphs: [{ header: 'Reference (g)', text: 'Use reference (h).', level: 0 }],
      copyTos: [{ text: 'Office w/ref (g)' }], distributions: [{ text: 'Office w/ref (h)' }],
    });
    useDocumentStore.getState().setDocType(type);
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Use reference (b).');
    useDocumentStore.getState().setDocType('same_page_endorsement');
    const restored = useDocumentStore.getState();
    expect(restored.references.map(reference => [reference.letter, reference.url])).toEqual([
      ['g', 'https://example.com/alpha'], ['h', 'https://example.com/bravo'],
    ]);
    expect(restored.paragraphs[0]).toMatchObject({ header: 'Reference (g)', text: 'Use reference (h).' });
    expect(restored.formData.via).toBe('Office w/ref (h)');
    expect(restored.copyTos[0].text).toBe('Office w/ref (g)');
    expect(restored.distributions[0].text).toBe('Office w/ref (h)');
  });

  it.each(['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'])('blocks an unsafe relabel when leaving %s without interpreting publication prose', type => {
    useDocumentStore.setState({ documentMode: 'compliant', documentCategory: 'correspondence', docType: 'same_page_endorsement',
      formData: { startingReferenceLetter: 'g', via: 'Office w/ref (h)' },
      references: [{ letter: 'g', title: 'Alpha', url: 'https://example.com/alpha' }, { letter: 'h', title: 'Bravo', url: 'https://example.com/bravo' }],
      paragraphs: [{ header: 'Reference (g)', text: 'Use reference (h), then reference (g).', level: 0 }],
      copyTos: [{ text: 'Office w/ref (g)' }], distributions: [{ text: 'Office w/ref (h)' }],
    });
    useDocumentStore.getState().setDocType(type);
    const publication = useDocumentStore.getState().getSnapshot();
    expect(publication.docType).toBe(type);
    expect(publication.paragraphs[0].text).toBe('Use reference (b), then reference (a).');
    useDocumentStore.getState().setDocType('same_page_endorsement');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(publication);
    // A same-label transition is safe without parsing the publication's prose.
    // Once the draft is ordinary correspondence, its citations can be reviewed.
    useDocumentStore.getState().setDocType('naval_letter');
    expect(useDocumentStore.getState().docType).toBe('naval_letter');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Use reference (b), then reference (a).');
    useDocumentStore.getState().setDocType('same_page_endorsement');
    const restored = useDocumentStore.getState();
    expect(restored.paragraphs[0]).toMatchObject({ header: 'Reference (g)', text: 'Use reference (h), then reference (g).' });
    expect(restored.formData.via).toBe('Office w/ref (h)');
    expect(restored.copyTos[0].text).toBe('Office w/ref (g)');
    expect(restored.distributions[0].text).toBe('Office w/ref (h)');
    expect(restored.references.map(reference => [reference.letter, reference.url])).toEqual([
      ['g', 'https://example.com/alpha'], ['h', 'https://example.com/bravo'],
    ]);
  });
});

it.each([
  { tableKey: 'materielRequired' },
  { publicationSection: 'purpose' as const },
  { appendix: true },
  { text: 'See {{PUBREF_P_0123456789ABCDEF0123456789ABCDEF}}.' },
])('refuses unsupported publication-to-volume conversion without altering saved content: %j', block => {
  useDocumentStore.getState().resetForm();
  useAlertStore.setState({ open: false, current: null, queue: [] });
  useDocumentStore.setState({ docType: 'i_type', formData: { subject: 'Retain original publication' },
    paragraphs: [{ id: 'source', text: 'Original publication content.', level: 0, ...block }],
    publicationTables: { materielRequired: [{ values: { name: 'Retain table data' } }] }, references: [], enclosures: [], copyTos: [], distributions: [] });
  const before = structuredClone(useDocumentStore.getState().getSnapshot());
  useDocumentStore.getState().setDocType('technical_volume');
  expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
  expect(useAlertStore.getState().current).toMatchObject({ title: 'Technical volume conversion needs review', message: expect.stringContaining('cannot be converted automatically') });
});

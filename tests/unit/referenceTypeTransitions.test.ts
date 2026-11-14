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
});

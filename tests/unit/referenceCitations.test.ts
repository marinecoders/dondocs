import { describe, expect, it } from 'vitest';
import { planFirstCitationOrder, planReferenceChange, scanReferenceCitations, type ReferenceSource } from '@/lib/referenceCitations';
import { useDocumentStore } from '@/stores/documentStore';

function source(text = 'Follow reference (b), then reference (a).'): ReferenceSource {
  return { documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'Unchanged', via: 'Office w/ref (b)' },
    references: [{ letter: 'a', title: 'Alpha', url: 'https://example.com/alpha' }, { letter: 'b', title: 'Bravo', url: 'https://example.com/bravo' }],
    paragraphs: [{ text, level: 0 }], copyTos: [{ text: 'Office (w/ref (a))' }], distributions: [{ text: 'Office w/ref (b)' }] };
}

describe('citation discovery and reference plans', () => {
  it('recognizes explicit clauses, plural lists, case, and saved labels beyond z', () => {
    expect(scanReferenceCitations('Refs. (B), (a), and (a0); paragraph (c); ref (a1).').citations.map(c => c.letter)).toEqual(['b', 'a', 'a0', 'a1']);
    expect(scanReferenceCitations('Paragraph (b) and portion (U) remain unchanged.').citations).toEqual([]);
  });
  it('orders by body first appearances and preserves source identity everywhere supported', () => {
    const state = source();
    const plan = planFirstCitationOrder(state);
    expect(plan.blockers).toEqual([]);
    expect(plan.references).toEqual([{ ...state.references[1], letter: 'a' }, { ...state.references[0], letter: 'b' }]);
    expect(plan.patch.paragraphs?.[0].text).toBe('Follow reference (a), then reference (b).');
    expect(plan.patch.formData?.via).toBe('Office w/ref (a)');
    expect(plan.patch.copyTos?.[0].text).toBe('Office (w/ref (b))');
    expect(plan.patch.distributions?.[0].text).toBe('Office w/ref (a)');
    expect(state.paragraphs[0].text).toContain('reference (b)');
  });
  it('reads headings before text, ignores ancillary order, and retains uncited references', () => {
    const state = source('Follow reference (b).');
    state.paragraphs[0].header = 'Reference (a)';
    expect(planFirstCitationOrder(state).order).toEqual([0, 1]);
    delete state.paragraphs[0].header;
    const plan = planFirstCitationOrder(state);
    expect(plan.order).toEqual([1, 0]);
    expect(plan.notes[0]).toContain('Not cited in the body: (a)');
  });
  it('continues endorsement letters and leaves inherited citations untouched', () => {
    const state = source('Use reference (a), then references (h) and (g).');
    state.docType = 'same_page_endorsement'; state.formData = { startingReferenceLetter: 'g' };
    state.references = state.references.map((ref, index) => ({ ...ref, letter: index ? 'h' : 'g' }));
    state.copyTos = []; state.distributions = [];
    const plan = planFirstCitationOrder(state);
    expect(plan.blockers).toEqual([]);
    expect(plan.references.map(ref => ref.letter)).toEqual(['g', 'h']);
    expect(plan.references[0].title).toBe('Bravo');
    expect(plan.patch.paragraphs?.[0].text).toBe('Use reference (a), then references (g) and (h).');
  });
  it.each([
    'Use references (a) through (b).', 'Use references (a)-(b).',
    'Use references (a); (b).', 'Use references (a) and b.', 'Use references (a) through c.',
    'He wrote "reference (b)".', "He wrote 'reference (b)'.", 'He wrote “reference (b)”.',
    'Use `ref (b)`.', 'Use reference (x).', 'Use reference b.', 'Use references (a and b).',
    'https://example.com/ref(b)',
  ])('blocks ambiguous clauses instead of applying a partial rewrite: %s', text => {
    expect(planReferenceChange(source(text), [1, 0]).blockers.length).toBeGreaterThan(0);
  });
  it('does not change unrelated designators, URLs or titles containing citation-like text', () => {
    const state = source('Paragraph (b) follows reference (b). https://example.com/(b)');
    state.references[0].title = 'Reference (b) in another letter';
    const plan = planReferenceChange(state, [1, 0]);
    expect(plan.blockers).toEqual([]);
    expect(plan.patch.paragraphs?.[0].text).toBe('Paragraph (b) follows reference (a). https://example.com/(b)');
    expect(plan.references[1].title).toBe('Reference (b) in another letter');
  });
  it('blocks cited removal, but safely reletters citations after an uncited removal', () => {
    const state = source('Use reference (b).'); state.copyTos = [];
    expect(planReferenceChange(state, [0]).blockers.join(' ')).toContain('still cited');
    const plan = planReferenceChange(state, [1]);
    expect(plan.blockers).toEqual([]);
    expect(plan.patch.paragraphs?.[0].text).toBe('Use reference (a).');
  });
  it('blocks affected citations in appended endorsements rather than guessing their scope', () => {
    const state = source(); state.formData.endorsementBody = 'Use reference (b).';
    expect(planReferenceChange(state, [1, 0]).blockers.join(' ')).toContain('outside the supported');
    state.formData.endorsementBody = '';
    state.formData.additionalEndorsements = [{ id: 'extra', endorsementBody: 'Use reference (a).' }];
    expect(planReferenceChange(state, [1, 0]).blockers.join(' ')).toContain('outside the supported');
  });
  it('handles existing a0/a1 labels without inventing alphabetic labels', () => {
    const state = source('Use references (a0) and (z).');
    state.docType = 'same_page_endorsement'; state.formData = { startingReferenceLetter: 'z' };
    state.references = state.references.map((ref, index) => ({ ...ref, letter: index ? 'a0' : 'z' }));
    state.copyTos = []; state.distributions = [];
    const plan = planFirstCitationOrder(state);
    expect(plan.blockers).toEqual([]);
    expect(plan.patch.paragraphs?.[0].text).toBe('Use references (z) and (a0).');
  });
  it('rejects duplicate labels, invalid orders and inherited/local collisions', () => {
    const state = source(); state.references[1].letter = 'a';
    expect(planReferenceChange(state, [1, 0]).blockers.join(' ')).toContain('duplicated');
    expect(planReferenceChange(source(), [9]).blockers.join(' ')).toContain('invalid');
    const endorsement = source('Use reference (a), then reference (g).');
    endorsement.docType = 'same_page_endorsement'; endorsement.formData = { startingReferenceLetter: 'g' };
    endorsement.references = [{ letter: 'g', title: 'Local' }]; endorsement.copyTos = []; endorsement.distributions = [];
    expect(planReferenceChange(endorsement, [0], 0).blockers.join(' ')).toContain('inherited');
  });
});

describe('store paths that reletter references', () => {
  it('preserves basic and endorsement citation targets through manual reorder', () => {
    for (const [type, start, citation] of [['naval_letter', 'a', 'b'], ['same_page_endorsement', 'g', 'h']]) {
      useDocumentStore.setState({ ...source(`Follow reference (${citation}).`), docType: type,
        formData: { startingReferenceLetter: start }, copyTos: [], distributions: [],
        references: [{ letter: start, title: 'Alpha' }, { letter: citation, title: 'Bravo' }] });
      useDocumentStore.getState().reorderReferences(1, 0);
      expect(useDocumentStore.getState().references[0].title).toBe('Bravo');
      expect(useDocumentStore.getState().paragraphs[0].text).toBe(`Follow reference (${start}).`);
    }
  });
  it('preserves citations when the start changes or the type leaves an endorsement', () => {
    useDocumentStore.setState({ ...source('Use reference (b).'), docType: 'same_page_endorsement', formData: {}, copyTos: [], distributions: [] });
    useDocumentStore.getState().setField('startingReferenceLetter', 'g');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Use reference (h).');
    useDocumentStore.getState().setFormData({ startingReferenceLetter: 'i' });
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Use reference (j).');
    useDocumentStore.getState().setDocType('naval_letter');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Use reference (b).');
  });
  it('does not remove a cited source or clear cited references', () => {
    useDocumentStore.setState(source());
    const before = useDocumentStore.getState().getSnapshot();
    useDocumentStore.getState().removeReference(1);
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    useDocumentStore.getState().clearReferences();
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
  });
});

it('keeps combined bulk incoming fields while remapping them in the old reference context', () => {
  useDocumentStore.setState({ ...source('Use reference (b).'), docType: 'same_page_endorsement', formData: {}, copyTos: [], distributions: [] });
  useDocumentStore.getState().setFormData({ startingReferenceLetter: 'g', via: 'New Office w/ref (a)', subject: 'New subject' });
  expect(useDocumentStore.getState().formData).toMatchObject({ startingReferenceLetter: 'g', via: 'New Office w/ref (g)', subject: 'New subject' });
  expect(useDocumentStore.getState().paragraphs[0].text).toBe('Use reference (h).');
});


it('blocks a type switch that would collide with a bare inherited citation', () => {
  useDocumentStore.setState({ ...source('Follow (a), then reference (g).'), docType: 'same_page_endorsement',
    formData: { startingReferenceLetter: 'g' }, references: [{ letter: 'g', title: 'Local' }], copyTos: [], distributions: [] });
  const before = useDocumentStore.getState().getSnapshot();
  useDocumentStore.getState().setDocType('naval_letter');
  expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
});

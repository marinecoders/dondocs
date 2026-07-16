/**
 * Reference lettering in the document store, including the endorsement
 * continuation offset (SECNAV M-5216.5 Ch 9 ¶3).
 *
 * `ref.letter` is stored on the data, not derived at render — so every path
 * that can change the sequence has to re-letter in the same commit, or the rows
 * keep a stale sequence on screen while the PDF prints a different one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';

const letters = () => useDocumentStore.getState().references.map((r) => r.letter);

function seedThreeRefs() {
  const s = useDocumentStore.getState();
  s.addReference('One');
  s.addReference('Two');
  s.addReference('Three');
}

describe('reference lettering', () => {
  beforeEach(() => {
    useDocumentStore.getState().resetForm();
    useDocumentStore.setState({ references: [] });
  });

  it('letters a basic letter from (a)', () => {
    seedThreeRefs();
    expect(letters()).toEqual(['a', 'b', 'c']);
  });

  it('continues from the start letter on an endorsement', () => {
    useDocumentStore.getState().setDocType('same_page_endorsement');
    useDocumentStore.getState().setField('startingReferenceLetter', 'g');
    seedThreeRefs();
    expect(letters()).toEqual(['g', 'h', 'i']);
  });

  it('re-letters existing rows the moment the start letter changes', () => {
    useDocumentStore.getState().setDocType('same_page_endorsement');
    seedThreeRefs();
    expect(letters()).toEqual(['a', 'b', 'c']);
    // The regression this guards: rows keeping the old sequence on screen.
    useDocumentStore.getState().setField('startingReferenceLetter', 'g');
    expect(letters()).toEqual(['g', 'h', 'i']);
  });

  it('keeps the sequence contiguous after a removal', () => {
    useDocumentStore.getState().setDocType('same_page_endorsement');
    useDocumentStore.getState().setField('startingReferenceLetter', 'g');
    seedThreeRefs();
    useDocumentStore.getState().removeReference(1);
    expect(letters()).toEqual(['g', 'h']);
  });

  it('resets to (a) when the doc type leaves an endorsement', () => {
    useDocumentStore.getState().setDocType('same_page_endorsement');
    useDocumentStore.getState().setField('startingReferenceLetter', 'g');
    seedThreeRefs();
    expect(letters()).toEqual(['g', 'h', 'i']);
    // A stale start must not silently offset a basic letter.
    useDocumentStore.getState().setDocType('naval_letter');
    expect(letters()).toEqual(['a', 'b', 'c']);
  });
});

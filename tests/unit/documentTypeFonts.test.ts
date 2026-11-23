import { afterEach, describe, expect, it } from 'vitest';
import { DIRECTIVE_TYPES } from '@/lib/directiveFormats';
import { createBlankSession, prepareSessionState, useDocumentStore } from '@/stores/documentStore';
import { DOC_TYPE_CATEGORIES, DOC_TYPE_CONFIG } from '@/types/document';

const store = useDocumentStore.getState;
const selectableTypes = DOC_TYPE_CATEGORIES.flatMap(({ types }) => types);
const directiveTransitions = DIRECTIVE_TYPES.flatMap(directive => selectableTypes
  .filter(type => type !== directive)
  .map(type => [directive, type, DOC_TYPE_CONFIG[type].regulations.fontFamily] as const));

afterEach(() => useDocumentStore.setState(useDocumentStore.getInitialState()));

describe('document type font transitions', () => {
  it.each(directiveTransitions)(
    'switches from %s to %s with the destination font %s',
    (directive, destination, fontFamily) => {
      const letter = createBlankSession(undefined, 'naval_letter');
      useDocumentStore.setState({
        ...letter,
        references: [],
        formData: { ...letter.formData, subject: 'KEEP THIS SUBJECT' },
      });

      store().setDocType(directive);
      expect(store().docType).toBe(directive);
      expect(store().formData.fontFamily).toBe('courier');
      store().setDocType(destination);
      expect(store().docType).toBe(destination);
      expect(store().formData).toMatchObject({ fontFamily, subject: 'KEEP THIS SUBJECT' });
    },
  );

  it('uses the destination font when starting from a saved directive', () => {
    const directive = createBlankSession(undefined, 'marine_corps_order');
    useDocumentStore.setState(prepareSessionState(directive));

    store().setDocType('information_paper');
    expect(store().formData.fontFamily).toBe('times');
  });

  it('keeps a saved font when neither compliant type requires a particular family', () => {
    const letter = createBlankSession(undefined, 'naval_letter');
    useDocumentStore.setState(prepareSessionState({ ...letter, formData: { ...letter.formData, fontFamily: 'courier' } }));

    store().setDocType('information_paper');
    expect(store().formData.fontFamily).toBe('courier');
  });

  it('keeps an explicitly selected font in Custom mode', () => {
    useDocumentStore.setState(createBlankSession(undefined, 'naval_letter'));
    store().setDocumentMode('custom');
    store().setField('fontFamily', 'courier');

    store().setDocType('marine_corps_order');
    store().setDocType('naval_letter');
    expect(store().formData.fontFamily).toBe('courier');
  });
});

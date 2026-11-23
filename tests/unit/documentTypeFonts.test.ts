import { afterEach, describe, expect, it } from 'vitest';
import { createBlankSession, prepareSessionState, useDocumentStore } from '@/stores/documentStore';

const store = useDocumentStore.getState;

afterEach(() => useDocumentStore.setState(useDocumentStore.getInitialState()));

describe('document type font transitions', () => {
  it.each(['marine_corps_order', 'marine_corps_bulletin', 'secnav_instruction', 'secnav_notice', 'change_transmittal'])(
    'restores Times New Roman after switching from %s to a naval letter',
    type => {
      const letter = createBlankSession(undefined, 'naval_letter');
      useDocumentStore.setState({ ...letter, formData: { ...letter.formData, subject: 'KEEP THIS SUBJECT' } });

      store().setDocType(type);
      expect(store().formData.fontFamily).toBe('courier');
      store().setDocType('naval_letter');
      expect(store().formData).toMatchObject({ fontFamily: 'times', subject: 'KEEP THIS SUBJECT' });
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

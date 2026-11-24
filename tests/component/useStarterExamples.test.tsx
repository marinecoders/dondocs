import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStarterExamples } from '@/hooks/useStarterExamples';
import { getPreviewHints, STARTER_EXAMPLE_SECTIONS } from '@/lib/previewHints';
import { createBlankSession, getSerializedSession, mutateSessionAssets, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, changeDocumentHistory, flushDocumentWrites, openSessionAsNew, recordDocumentHistory, useDocumentsStore } from '@/stores/documentsStore';
import { useProfileStore } from '@/stores/profileStore';
import { starterExampleEditsKey, useUIStore } from '@/stores/uiStore';
import type { DocumentData } from '@/types/document';

function mount() {
  return renderHook(() => {
    const docType = useDocumentStore(state => state.docType);
    const formData = useDocumentStore(state => state.formData);
    const copyTos = useDocumentStore(state => state.copyTos);
    return useStarterExamples(true, docType, formData, copyTos);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useUIStore.setState({ starterExampleEdits: {} });
  useDocumentsStore.getState().newDocument();
});

afterEach(async () => {
  await flushDocumentWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('starter example lifecycle', () => {
  it('keeps the full fresh sample outside the blank document', () => {
    const before = getSerializedSession();
    const { result } = mount();
    expect(result.current.checked).toBe(true);
    expect(result.current.hiddenSections).toEqual([]);
    const hints = getPreviewHints(useDocumentStore.getState(), undefined, result.current.hiddenSections);
    for (const field of ['unitLine1', 'unitLine2', 'unitAddress', 'officeCode', 'serial', 'sigFirst', 'sigMiddle', 'copyToFirst']) {
      expect(hints).toHaveProperty(field);
    }
    act(() => result.current.onChange(false));
    expect(result.current.hiddenSections).toEqual(STARTER_EXAMPLE_SECTIONS);
    act(() => result.current.onChange(true));
    expect(result.current.hiddenSections).toEqual([]);
    expect(getSerializedSession()).toEqual(before);
    expect(useUIStore.getState().starterExampleEdits).toEqual({});
  });

  it.each([
    ['unitLine1', 'TRAINING COMMAND', 'letterhead'],
    ['unitLine2', 'TRAINING STAFF', 'letterhead'],
    ['unitAddress', '52 MAIN STREET, QUANTICO, VA 22134', 'letterhead'],
    ['ssic', '1000', 'senderSymbols'],
    ['serial', '044', 'senderSymbols'],
    ['officeCode', 'ADMIN', 'senderSymbols'],
    ['date', '23 Nov 26', 'senderSymbols'],
    ['from', 'Training Command', 'addressing'],
    ['to', 'Training Office', 'addressing'],
    ['via', 'Training Staff', 'addressing'],
    ['subject', 'TRAINING', 'addressing'],
    ['sigFirst', 'Alex', 'signature'],
    ['sigMiddle', 'B', 'signature'],
    ['sigLast', 'SMITH', 'signature'],
    ['sigRank', 'Captain', 'signature'],
    ['sigTitle', 'Training Officer', 'signature'],
  ] as const)('editing and clearing %s affects only its own category', (field, value, section) => {
    const { result } = mount();
    act(() => useDocumentStore.getState().setField(field, value));
    expect(result.current.hiddenSections).toEqual([section]);
    act(() => useDocumentStore.getState().setField(field, ''));
    expect(result.current.hiddenSections).toEqual([section]);
    const hints = getPreviewHints(useDocumentStore.getState(), undefined, result.current.hiddenSections);
    for (const required of ['unitLine1', 'ssic', 'date', 'from', 'to', 'subject', 'sigLast', 'body']) {
      expect(hints).toHaveProperty(required);
    }
  });

  it.each([
    ['department', 'navy', 'letterhead'],
    ['letterheadMode', 'title-only', 'letterhead'],
    ['letterheadColor', 'black', 'letterhead'],
    ['letterheadStandard', 'dla', 'letterhead'],
    ['inReplyTo', true, 'senderSymbols'],
    ['underlineSubject', true, 'addressing'],
    ['byDirection', true, 'signature'],
    ['signatureType', 'digital', 'signature'],
  ] as const)('editing the %s control also counts as editing its category', (field, value, section) => {
    const previous = useDocumentStore.getState().formData[field];
    const { result } = mount();
    act(() => useDocumentStore.getState().setField(field, value));
    expect(result.current.hiddenSections).toEqual([section]);
    act(() => useDocumentStore.getState().setField(field, previous as DocumentData[typeof field]));
    expect(result.current.hiddenSections).toEqual([section]);
  });

  it('leaves unrelated examples alone when editing body, references, classification, or formatting', () => {
    const { result } = mount();
    act(() => {
      useDocumentStore.getState().updateParagraph(0, { text: 'Actual body text.' });
      useDocumentStore.getState().addReference('Training reference');
      useDocumentStore.getState().setField('pocEmail', 'staff@example.test');
      useDocumentStore.getState().setField('fontSize', '10pt');
    });
    expect(result.current.hiddenSections).toEqual([]);
  });

  it('does not mistake defaults applied by format or mode changes for category edits', () => {
    const { result } = mount();
    act(() => useDocumentStore.getState().setDocType('business_letter'));
    act(() => useDocumentStore.getState().setDocumentMode('custom'));
    act(() => useDocumentStore.getState().setDocType('naval_letter'));
    act(() => useDocumentStore.getState().setDocumentMode('compliant'));
    expect(result.current.hiddenSections).toEqual([]);
    expect(useUIStore.getState().starterExampleEdits).toEqual({});
  });

  it('treats the business letter date as Addressing and preserves only its required hints', () => {
    useDocumentStore.getState().setDocType('business_letter');
    const { result } = mount();
    act(() => useDocumentStore.getState().setField('date', '23 November 2026'));
    expect(result.current.hiddenSections).toEqual(['addressing']);
    const hints = getPreviewHints(useDocumentStore.getState(), undefined, result.current.hiddenSections);
    expect(hints.subject).toBeUndefined();
    expect(hints.date).toBeUndefined();
    expect(hints.to).toBeDefined();
    expect(hints.salutation).toBeDefined();
    expect(hints.complimentaryClose).toBeDefined();
    expect(hints.unitLine2).toBeDefined();
    expect(hints.copyToFirst).toBeDefined();
  });

  it('does not treat a carried sender code as a signature edit when switching formats', () => {
    const { result } = mount();
    act(() => useDocumentStore.getState().setField('officeCode', 'S-3'));
    expect(result.current.hiddenSections).toEqual(['senderSymbols']);
    act(() => useDocumentStore.getState().setDocType('business_letter'));
    const hints = () => getPreviewHints(useDocumentStore.getState(), undefined, result.current.hiddenSections);
    expect(hints().sigFirst).toBeDefined();
    act(() => useDocumentStore.getState().setField('officeCode', 'ADMIN'));
    expect(hints().sigFirst).toBeUndefined();
    expect(hints().sigLast).toBeDefined();
  });

  it('hides optional examples on the first entered character even when it is whitespace', () => {
    const { result } = mount();
    act(() => useDocumentStore.getState().setField('serial', ' '));
    act(() => useDocumentStore.getState().addCopyTo(''));
    expect(result.current.hiddenSections).toEqual(['senderSymbols']);
    act(() => useDocumentStore.getState().updateCopyTo(0, ' '));
    expect(result.current.hiddenSections).toEqual(['senderSymbols', 'copyTo']);
  });

  it('replaces the entire sample Copy to list and keeps it gone after deleting the last real recipient', () => {
    const { result } = mount();
    const hints = () => getPreviewHints(useDocumentStore.getState(), undefined, result.current.hiddenSections);
    act(() => useDocumentStore.getState().addCopyTo(''));
    expect(hints().copyToFirst).toBeDefined();
    act(() => useDocumentStore.getState().updateCopyTo(0, 'Records Team'));
    expect(result.current.hiddenSections).toEqual(['copyTo']);
    expect(hints().copyToFirst).toBeUndefined();
    expect(hints().copyToSecond).toBeUndefined();
    act(() => useDocumentStore.getState().addCopyTo('Training Team'));
    act(() => useDocumentStore.getState().removeCopyTo(0));
    expect(useDocumentStore.getState().copyTos).toEqual([{ text: 'Training Team' }]);
    act(() => useDocumentStore.getState().removeCopyTo(0));
    expect(hints().copyToFirst).toBeUndefined();
    expect(result.current.hiddenSections).toEqual(['copyTo']);
  });

  it('keeps category history through undo and redo without reviving optional samples', () => {
    const { result } = mount();
    const scope = captureDocumentScope();
    act(() => {
      useDocumentStore.getState().setField('serial', '044');
      recordDocumentHistory(scope);
    });
    act(() => { expect(changeDocumentHistory('undo', scope)).toBe('applied'); });
    expect(useDocumentStore.getState().formData.serial).toBe('');
    expect(result.current.hiddenSections).toEqual(['senderSymbols']);
    act(() => { expect(changeDocumentHistory('redo', scope)).toBe('applied'); });
    expect(useDocumentStore.getState().formData.serial).toBe('044');
    expect(result.current.hiddenSections).toEqual(['senderSymbols']);
  });

  it('scopes cleared category history to its own draft and drops temporary restoration on reopening', () => {
    const { result } = mount();
    const first = useDocumentsStore.getState().currentId!;
    act(() => {
      useDocumentStore.getState().setField('unitLine2', 'TRAINING STAFF');
      useDocumentStore.getState().setField('unitLine2', '');
      useDocumentsStore.getState().saveCurrent();
    });
    act(() => result.current.onChange(true));
    expect(result.current.hiddenSections).toEqual([]);
    act(() => useDocumentsStore.getState().newDocument());
    expect(result.current.hiddenSections).toEqual([]);
    act(() => useDocumentStore.getState().setField('serial', '044'));
    expect(result.current.hiddenSections).toEqual(['senderSymbols']);
    act(() => useDocumentsStore.getState().switchTo(first));
    expect(result.current.hiddenSections).toEqual(['letterhead']);
    expect(useDocumentStore.getState().formData.unitLine2).toBe('');
    act(() => result.current.onChange(true));
    act(() => useDocumentsStore.getState().newDocument());
    act(() => useDocumentsStore.getState().switchTo(first));
    expect(result.current.hiddenSections).toEqual(['letterhead']);
  });

  it('restores examples until their own category is edited again', () => {
    const { result } = mount();
    act(() => {
      useDocumentStore.getState().setField('unitLine2', 'TRAINING STAFF');
      useDocumentStore.getState().setField('unitLine2', '');
      useDocumentStore.getState().setField('serial', '044');
      useDocumentStore.getState().setField('serial', '');
    });
    act(() => result.current.onChange(true));
    expect(result.current.checked).toBe(true);
    act(() => useDocumentStore.getState().setField('to', 'Training Office'));
    expect(result.current.hiddenSections).toEqual(['addressing']);
    act(() => useDocumentStore.getState().setField('serial', '045'));
    expect(result.current.hiddenSections).toEqual(['senderSymbols', 'addressing']);
    const hints = getPreviewHints(useDocumentStore.getState(), undefined, result.current.hiddenSections);
    expect(hints.unitLine2).toBeDefined();
    expect(hints.officeCode).toBeUndefined();
  });

  it('keeps explicit hiding active until examples are enabled again', () => {
    const { result } = mount();
    act(() => result.current.onChange(false));
    act(() => useDocumentStore.getState().setField('to', 'Training Office'));
    expect(result.current.hiddenSections).toEqual(STARTER_EXAMPLE_SECTIONS);
    act(() => result.current.onChange(true));
    expect(result.current.hiddenSections).toEqual([]);
    expect(getPreviewHints(useDocumentStore.getState(), undefined, result.current.hiddenSections).to).toBeUndefined();
  });

  it('infers populated imported categories without marking the outgoing draft as edited', () => {
    const { result } = mount();
    const first = useDocumentsStore.getState().currentId!;
    const source = createBlankSession();
    source.formData = { ...source.formData, unitLine1: 'ACTUAL COMMAND', serial: '044' };
    source.copyTos = [{ text: 'Records Team' }];
    act(() => { expect(openSessionAsNew(source)).toBe('applied'); });
    expect(result.current.hiddenSections).toEqual(['letterhead', 'senderSymbols', 'copyTo']);
    expect(useUIStore.getState().starterExampleEdits[first]).toBeUndefined();
    act(() => {
      useDocumentStore.getState().setField('unitLine1', '');
      useDocumentStore.getState().setField('serial', '');
      useDocumentStore.getState().removeCopyTo(0);
    });
    expect(result.current.hiddenSections).toEqual(['letterhead', 'senderSymbols', 'copyTo']);
  });

  it('does not treat passive asset hydration as an author edit', () => {
    const { result } = mount();
    act(() => mutateSessionAssets(() => useDocumentStore.getState().setFormData({
      signatureType: 'image',
      signatureImage: { name: 'signature.png', size: 12, data: '' },
    })));
    expect(result.current.hiddenSections).toEqual([]);
    expect(useUIStore.getState().starterExampleEdits).toEqual({});
  });

  it('rehydrates cleared categories without putting them in exported drafts', () => {
    const { result, unmount } = mount();
    act(() => {
      useDocumentStore.getState().addCopyTo('Records Team');
      useDocumentStore.getState().removeCopyTo(0);
    });
    expect(result.current.hiddenSections).toEqual(['copyTo']);
    unmount();
    useUIStore.setState({ starterExampleEdits: {} });
    const reopened = mount();
    expect(reopened.result.current.hiddenSections).toEqual(['copyTo']);
    expect(JSON.stringify(getSerializedSession())).not.toMatch(/starterExample|hiddenSections|Records Team|G-3\/5/);
  });

  it('merges edits from another tab and survives an unrelated settings write', () => {
    const { result, unmount } = mount();
    const id = useDocumentsStore.getState().currentId!;
    const key = starterExampleEditsKey(id);
    act(() => {
      localStorage.setItem(key, '["copyTo"]');
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: '["copyTo"]' }));
    });
    expect(result.current.hiddenSections).toEqual(['copyTo']);
    act(() => {
      useDocumentStore.getState().setField('serial', '044');
      useDocumentStore.getState().setField('serial', '');
    });
    unmount();
    useUIStore.setState({ starterExampleEdits: {}, previewWidth: 56 });
    expect(mount().result.current.hiddenSections).toEqual(['senderSymbols', 'copyTo']);
  });

  it('migrates saved category history from the previous settings format', async () => {
    const id = useDocumentsStore.getState().currentId!;
    localStorage.setItem('dondocs_ui', JSON.stringify({
      state: { starterExampleEdits: { [id]: ['copyTo', 'unknown'] } }, version: 1,
    }));
    await act(async () => { await useUIStore.persist.rehydrate(); });
    expect(mount().result.current.hiddenSections).toEqual(['copyTo']);
    expect(JSON.parse(localStorage.getItem(starterExampleEditsKey(id))!)).toEqual(['copyTo']);
  });

  it('duplicates the edit history without inheriting the temporary example toggle', () => {
    const { result } = mount();
    const id = useDocumentsStore.getState().currentId!;
    act(() => {
      useDocumentStore.getState().setField('serial', '044');
      useDocumentStore.getState().setField('serial', '');
      useDocumentsStore.getState().saveCurrent();
    });
    act(() => result.current.onChange(true));
    expect(result.current.hiddenSections).toEqual([]);
    act(() => useDocumentsStore.getState().duplicateDocument(id));
    const copy = Object.keys(useDocumentsStore.getState().docs).find(item => item !== id)!;
    act(() => useDocumentsStore.getState().switchTo(copy));
    expect(result.current.hiddenSections).toEqual(['senderSymbols']);
    expect(useDocumentStore.getState().formData.serial).toBe('');
  });
});

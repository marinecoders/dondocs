import { useUIStore } from '@/stores/uiStore';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreviewSources } from '@/hooks/usePreviewSources';
import { useDocumentStore } from '@/stores/documentStore';
const guards = vi.hoisted(() => ({ current: true, jump: vi.fn() }));
vi.mock('@/components/layout/editorSections', () => ({ useEditorSections: () => ({ sections: [{ id: 'body' }] }) }));
vi.mock('@/stores/documentsStore', () => ({ captureDocumentTarget: () => ({}), isCurrentDocumentTarget: () => guards.current }));
vi.mock('@/stores/editorOutlineStore', () => ({ useEditorOutlineStore: { getState: () => ({ jump: guards.jump }) } }));
beforeEach(() => { useUIStore.setState({ previewVisible: true, isMobile: false }); useDocumentStore.setState({ enclosures: [], docType: 'naval_letter', formData: { ...useDocumentStore.getState().formData, appendEndorsement: false, basicLetterFile: undefined, basicLetterFileRef: undefined } }); });
afterEach(() => { vi.unstubAllGlobals(); guards.current = true; guards.jump.mockClear(); });
describe('preview navigation', () => {
  it('follows explicit editor selection, pauses on manual PDF navigation and ignores typing', () => {
    useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: [{ id: 'selected', text: 'A uniquely worded source paragraph', level: 0 }] });
    const editor = document.createElement('div'); editor.className = 'workspace-editor';
    const row = document.createElement('div'); row.dataset.paragraphId = 'selected';
    const field = document.createElement('textarea'); row.append(field); editor.append(row); document.body.append(editor);
    const { result, rerender } = renderHook(({ disabled }) => usePreviewSources(disabled), { initialProps: { disabled: false } });
    act(() => field.focus());
    expect(result.current.sourceToReveal).toBeUndefined();
    act(() => result.current.changeFollowMode('editor'));
    act(() => field.dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(result.current.sourceToReveal?.id).toBe('selected');
    expect(field).toHaveFocus();
    act(() => result.current.pauseEditorFollow());
    act(() => field.dispatchEvent(new Event('input', { bubbles: true })));
    expect(result.current.sourceToReveal).toBeUndefined();
    act(() => field.dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(result.current.sourceToReveal?.id).toBe('selected');
    guards.current = false;
    rerender({ disabled: false });
    expect(result.current.sourceToReveal).toBeUndefined();
    guards.current = true;
    rerender({ disabled: true });
    expect(result.current.sourceToReveal).toBeUndefined();
    editor.remove();
  });

  it('withholds source links from assembled documents containing uploaded PDFs', () => {
    useDocumentStore.setState({ docType: 'naval_letter', documentCategory: 'correspondence', paragraphs: [{ id: 'p1', text: 'A uniquely worded native paragraph', level: 0 }], enclosures: [{ title: 'Quoted material', fileRef: { id: 'file', name: 'enclosure.pdf', size: 100, type: 'application/pdf' } }] });
    const { result } = renderHook(() => usePreviewSources(false));
    expect(result.current.hasImportedPages).toBe(true);
    expect(result.current.sources).toEqual([]);
    act(() => useDocumentStore.setState({ enclosures: [], docType: 'new_page_endorsement', formData: { ...useDocumentStore.getState().formData, basicLetterFileRef: { id: 'basic', name: 'basic.pdf', size: 100, type: 'application/pdf' } } }));
    expect(result.current.hasImportedPages).toBe(true);
    expect(result.current.sources).toEqual([]);
  });

  it('hands off mobile source focus after the preview dialog unmounts', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    useUIStore.setState({ isMobile: true, mobilePreviewOpen: true });
    useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: [{ id: 'mobile-source', text: 'Unique mobile source paragraph', level: 0 }] });
    const section = document.createElement('section'); section.id = 'sec-body';
    const row = document.createElement('div'); row.dataset.paragraphId = 'mobile-source';
    const field = document.createElement('textarea'); row.append(field); section.append(row); document.body.append(section);
    const { result, unmount } = renderHook(() => usePreviewSources(false, true));
    const close = result.current.onMobileCloseAutoFocus;
    act(() => result.current.navigate?.(result.current.sources[0]));
    expect(useUIStore.getState().mobilePreviewOpen).toBe(false);
    expect(document.activeElement).not.toBe(field);
    unmount();
    const event = new Event('closeAutoFocus', { cancelable: true });
    close(event);
    while (frames.length) frames.shift()!(0);
    expect(event.defaultPrevented).toBe(true);
    expect(field).toHaveFocus();
    section.remove();
  });

  it('does not focus a mobile source after the draft changes', () => {
    useUIStore.setState({ isMobile: true, mobilePreviewOpen: true });
    useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: [{ id: 'mobile-source', text: 'Unique mobile source paragraph', level: 0 }] });
    const { result } = renderHook(() => usePreviewSources(false, true));
    act(() => result.current.navigate?.(result.current.sources[0]));
    guards.current = false;
    result.current.onMobileCloseAutoFocus(new Event('closeAutoFocus', { cancelable: true }));
    expect(guards.jump).not.toHaveBeenCalled();
  });

  it('only navigates current sources in an enabled draft', () => {
    const { result, rerender } = renderHook(({ disabled }) => usePreviewSources(disabled), { initialProps: { disabled: false } });
    act(() => useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: [{ id: 'p1', text: 'A paragraph with unique wording', level: 0 }] }));
    const source = result.current.sources[0];
    expect(source).toBeDefined();
    result.current.navigate?.({ ...source, id: 'foreign' });
    expect(guards.jump).not.toHaveBeenCalled();
    guards.current = false;
    result.current.navigate?.(source);
    expect(guards.jump).not.toHaveBeenCalled();
    guards.current = true;
    result.current.navigate?.(source);
    expect(guards.jump).toHaveBeenCalledWith('body');
    rerender({ disabled: true });
    expect(result.current.navigate).toBeUndefined();
  });
  it('follows only visible sources without focusing an editor field', () => {
    act(() => useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: [{ id: 'p1', text: 'A paragraph with unique wording', level: 0 }] }));
    const row = document.createElement('div'); row.dataset.paragraphId = 'p1';
    const section = document.createElement('section'); section.id = 'sec-body'; section.append(row); document.body.append(section);
    row.scrollIntoView = vi.fn();
    const { result } = renderHook(() => usePreviewSources(false));
    result.current.followSources(result.current.sources);
    expect(row.scrollIntoView).not.toHaveBeenCalled();
    act(() => result.current.setFollow(true));
    result.current.followSources(result.current.sources);
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement).not.toBe(row);
    section.remove();
  });
  it('withholds navigation while the desktop preview is closed', () => {
    const { result } = renderHook(() => usePreviewSources(false));
    act(() => useUIStore.setState({ previewVisible: false }));
    expect(result.current.navigate).toBeUndefined();
  });
  it('cancels a queued jump when the retained preview closes', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    act(() => useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: [{ id: 'p1', text: 'A unique paragraph for focus', level: 0 }] }));
    const section = document.createElement('section'); section.id = 'sec-body';
    const row = document.createElement('div'); row.dataset.paragraphId = 'p1';
    const field = document.createElement('textarea'); row.append(field); section.append(row); document.body.append(section);
    const focus = vi.spyOn(field, 'focus');
    const { result } = renderHook(() => usePreviewSources(false));
    result.current.navigate?.(result.current.sources[0]);
    act(() => useUIStore.setState({ previewVisible: false }));
    while (frames.length) frames.shift()!(0);
    expect(focus).not.toHaveBeenCalled();
    section.remove();
  });
  it('cancels deferred focus after unmount', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    act(() => useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: [{ id: 'p1', text: 'A unique paragraph for focus', level: 0 }] }));
    const section = document.createElement('section'); section.id = 'sec-body';
    const row = document.createElement('div'); row.dataset.paragraphId = 'p1';
    const field = document.createElement('textarea'); row.append(field); section.append(row); document.body.append(section);
    const focus = vi.spyOn(field, 'focus');
    const { result, unmount } = renderHook(() => usePreviewSources(false));
    result.current.navigate?.(result.current.sources[0]);
    unmount();
    while (frames.length) frames.shift()!(0);
    expect(focus).not.toHaveBeenCalled();
    section.remove();
  });
  it('offers no paragraph sources on forms'  , () => {
    act(() => useDocumentStore.setState({ documentCategory: 'forms' }));
    const { result } = renderHook(() => usePreviewSources(false));
    expect(result.current.sources).toEqual([]);
  });
});

it('withholds source links when original PDFs can repeat native text', () => {
  useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: [{ id: 'native', text: 'A distinct original native paragraph.', level: 0 }],
    enclosures: [{ title: 'Original', fileRef: { id: 'attachment', name: 'original.pdf', type: 'application/pdf', size: 100 } }] });
  const { result } = renderHook(() => usePreviewSources(false));
  expect(result.current.hasImportedPages).toBe(true);
  expect(result.current.sources).toEqual([]);
  act(() => useDocumentStore.setState({ enclosures: [], docType: 'new_page_endorsement', formData: {
    ...useDocumentStore.getState().formData, basicLetterFileRef: { id: 'basic', name: 'basic.pdf', type: 'application/pdf', size: 100 },
  } }));
  expect(result.current.hasImportedPages).toBe(true);
  expect(result.current.sources).toEqual([]);
});

it('withholds only body sources repeated in active native endorsements', () => {
  const repeated = 'The participating commands approve these shared training arrangements.';
  useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: [
    { id: 'repeated', text: repeated, level: 0 }, { id: 'unique', text: 'This distinct main-letter paragraph stays navigable.', level: 0 },
  ], formData: { ...useDocumentStore.getState().formData, from: 'Training Sender', to: 'Training Recipient',
    appendEndorsement: true, endorsementBody: repeated.toUpperCase(), additionalEndorsements: [] } });
  const { result } = renderHook(() => usePreviewSources(false));
  expect(result.current.sources.map(source => source.id)).toEqual(['unique']);
  act(() => useDocumentStore.getState().setField('appendEndorsement', false));
  expect(result.current.sources.map(source => source.id)).toEqual(['repeated', 'unique']);
  act(() => useDocumentStore.setState({ formData: { ...useDocumentStore.getState().formData, appendEndorsement: true,
    endorsementBody: 'Independent first endorsement.', additionalEndorsements: [{ id: 'second', endorsementBody: repeated }] } }));
  expect(result.current.sources.map(source => source.id)).toEqual(['unique']);
});

it('withholds navigation and following above the document budget and restores them for ordinary drafts', () => {
  useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: Array.from({ length: 513 }, (_, index) => ({ id: `large-${index}`, level: 0, text: `Unique paragraph ${index} belongs to a large draft.` })) });
  const { result } = renderHook(() => usePreviewSources(false));
  expect(result.current.navigationLimited).toBe(true);
  expect(result.current.sources).toEqual([]);
  expect(result.current.navigate).toBeUndefined();
  act(() => result.current.changeFollowMode('preview'));
  expect(result.current.follow).toBe(false);
  act(() => useDocumentStore.setState({ paragraphs: [{ id: 'small', level: 0, text: 'A unique paragraph in a small ordinary document.' }] }));
  expect(result.current.navigationLimited).toBe(false);
  expect(result.current.sources).toHaveLength(1);
  expect(result.current.navigate).toBeTypeOf('function');
});

it('does not revive an editor selection after crossing and returning below the source limit', () => {
  const paragraph = { id: 'selected-limit', level: 0, text: 'A uniquely selected paragraph before the document becomes large.' };
  useDocumentStore.setState({ documentCategory: 'correspondence', paragraphs: [paragraph] });
  const editor = document.createElement('div'); editor.className = 'workspace-editor';
  const row = document.createElement('div'); row.dataset.paragraphId = paragraph.id;
  const field = document.createElement('textarea'); row.append(field); editor.append(row); document.body.append(editor);
  const { result } = renderHook(() => usePreviewSources(false));
  act(() => result.current.changeFollowMode('editor'));
  act(() => field.focus());
  expect(result.current.sourceToReveal?.id).toBe(paragraph.id);
  act(() => useDocumentStore.setState({ paragraphs: [paragraph, ...Array.from({ length: 512 }, (_, index) => ({ ...paragraph, id: `extra-${index}` }))] }));
  expect(result.current.followMode).toBe('off');
  expect(result.current.sourceToReveal).toBeUndefined();
  act(() => useDocumentStore.setState({ paragraphs: [paragraph] }));
  expect(result.current.navigationLimited).toBe(false);
  expect(result.current.followMode).toBe('off');
  expect(result.current.sourceToReveal).toBeUndefined();
  editor.remove();
});

it('budgets competing endorsement prose before source normalization and restores inactive navigation', () => {
  useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'naval_letter', paragraphs: [
    { id: 'native-budget', text: 'A short and distinct main-letter paragraph.', level: 0 },
  ], formData: { ...useDocumentStore.getState().formData, appendEndorsement: true,
    endorsementBody: 'x'.repeat(250_001), additionalEndorsements: [] } });
  const { result } = renderHook(() => usePreviewSources(false));
  expect(result.current.navigationLimited).toBe(true);
  expect(result.current.sources).toEqual([]);
  act(() => useDocumentStore.getState().setField('appendEndorsement', false));
  expect(result.current.navigationLimited).toBe(false);
  expect(result.current.sources.map(source => source.id)).toEqual(['native-budget']);
});

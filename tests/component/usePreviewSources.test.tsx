import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePreviewSources } from '@/hooks/usePreviewSources';
import { useDocumentStore } from '@/stores/documentStore';
const guards = vi.hoisted(() => ({ current: true, jump: vi.fn() }));
vi.mock('@/components/layout/editorSections', () => ({ useEditorSections: () => ({ sections: [{ id: 'body' }] }) }));
vi.mock('@/stores/documentsStore', () => ({ captureDocumentTarget: () => ({}), isCurrentDocumentTarget: () => guards.current }));
vi.mock('@/stores/editorOutlineStore', () => ({ useEditorOutlineStore: { getState: () => ({ jump: guards.jump }) } }));
afterEach(() => { guards.current = true; guards.jump.mockClear(); });
describe('preview navigation', () => {
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
  it('offers no paragraph sources on forms', () => {
    act(() => useDocumentStore.setState({ documentCategory: 'forms' }));
    const { result } = renderHook(() => usePreviewSources(false));
    expect(result.current.sources).toEqual([]);
  });
});

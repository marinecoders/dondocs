// @vitest-environment happy-dom
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';
import { isVariableSuggestionOpen } from '@/components/ui/variable-suggestion-state';
import { useDocumentStore } from '@/stores/documentStore';

/** Mount the editor and pick the first match for `query` from the `@` menu with Enter. */
async function pickFromMenu(query: string) {
  const { container } = render(<VariableChipEditor value="" onChange={vi.fn()} ariaLabel="Body" />);
  const dom = container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor };
  act(() => { dom.editor.commands.insertContent(`@${query}`); });
  await waitFor(() => expect(isVariableSuggestionOpen()).toBe(true));
  await act(async () => { fireEvent.keyDown(dom, { key: 'Enter', keyCode: 13 }); });
  expect(dom.editor.getText().endsWith(' ')).toBe(true);
  return dom;
}

const pressSpace = (dom: HTMLElement) => !fireEvent.keyDown(dom, { key: ' ', keyCode: 32 });

describe('the space after an @ menu insert', () => {
  beforeEach(() => {
    useDocumentStore.setState((state) => ({
      docType: 'naval_letter',
      paragraphs: [],
      formData: { ...state.formData, unitLine1: 'TEST UNIT' },
    }));
  });

  it('stands in for the next Space, so the second press is the second space', async () => {
    const dom = await pickFromMenu('unit');
    expect(dom.editor.getText()).toBe('TEST UNIT ');
    expect(pressSpace(dom)).toBe(true);
    expect(pressSpace(dom)).toBe(false);
  });

  it('expires once the writer has typed something else', async () => {
    const dom = await pickFromMenu('unit');
    act(() => { dom.editor.commands.insertContent('x'); });
    expect(pressSpace(dom)).toBe(false);
  });

  it('applies to an I-Type cross-reference too', async () => {
    useDocumentStore.setState({ docType: 'i_type', paragraphs: [{ level: 0, header: 'Purpose', text: 'Body.' }] });
    const dom = await pickFromMenu('paragraph');
    expect(dom.querySelector('[data-type="variable"]')).not.toBeNull();
    expect(pressSpace(dom)).toBe(true);
    expect(pressSpace(dom)).toBe(false);
  });
});

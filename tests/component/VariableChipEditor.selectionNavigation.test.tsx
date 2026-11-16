// @vitest-environment happy-dom
import { act, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { expect, it, vi } from 'vitest';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';

it('restores the visible range when focus collapsed an unchanged editor selection', async () => {
  const context = 'Before selected words after.';
  const onChange = vi.fn();
  const { container } = render(<VariableChipEditor value={context} onChange={onChange} ariaLabel="Body" blockMode />);
  const dom = container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor };
  await waitFor(() => expect(dom.editor).toBeDefined());
  act(() => {
    dom.editor.view.focus();
    dom.editor.commands.setTextSelection({ from: 8, to: 22 });
  });
  expect(window.getSelection()?.toString()).toBe('selected words');

  // Reproduce native focus collapsing the range before its observer catches up.
  const observer = (dom.editor.view as unknown as { domObserver: { stop(): void; start(): void } }).domObserver;
  observer.stop();
  const caret = document.createRange();
  caret.setStart(dom.querySelector('p')!.firstChild!, 0);
  caret.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();selection.addRange(caret);
  observer.start();
  expect(selection.toString()).toBe('');
  expect(dom.editor.state.selection).toMatchObject({ from: 8, to: 22 });

  act(() => {
    dom.dispatchEvent(new CustomEvent('dondocs-select-text-range', { detail: { context, start: 7, end: 21 } }));
  });
  expect(dom).toHaveFocus();
  expect(selection.toString()).toBe('selected words');
  expect(dom.editor.state.selection).toMatchObject({ from: 8, to: 22 });
  expect(onChange).not.toHaveBeenCalled();
});

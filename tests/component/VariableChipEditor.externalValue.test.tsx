// @vitest-environment happy-dom
import { act, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';

describe('external paragraph values', () => {
  it('hydrates Undo/Redo values without publishing a normalized user edit', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<VariableChipEditor value="Équipe 😀 left  Second paragraph." onChange={onChange} ariaLabel="Body" />);
    const dom = container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor };
    await waitFor(() => expect(dom.editor).toBeDefined());
    onChange.mockClear();

    // Undoing an accepted join restores the exact original left paragraph.
    rerender(<VariableChipEditor value="Équipe 😀 left " onChange={onChange} ariaLabel="Body" />);
    await waitFor(() => expect(dom.editor.getText()).toBe('Équipe 😀 left '));
    expect(onChange).not.toHaveBeenCalled();

    // Redo is another external hydration, not a new authoring transaction.
    rerender(<VariableChipEditor value="Équipe 😀 left  Second paragraph." onChange={onChange} ariaLabel="Body" />);
    await waitFor(() => expect(dom.editor.getText()).toBe('Équipe 😀 left  Second paragraph.'));
    expect(onChange).not.toHaveBeenCalled();

    act(() => { dom.editor.commands.insertContentAt(dom.editor.state.doc.content.size - 1, ' Updated.'); });
    expect(onChange).toHaveBeenLastCalledWith('Équipe 😀 left  Second paragraph. Updated.');
  });

  it('keeps restored formatting, variables and whitespace without an echo write', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<VariableChipEditor value="Original" onChange={onChange} ariaLabel="Body" />);
    const dom = container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor };
    await waitFor(() => expect(dom.editor).toBeDefined());
    onChange.mockClear();
    rerender(<VariableChipEditor value="  **Restored** {{UNLISTED_VALUE}}  " onChange={onChange} ariaLabel="Body" />);
    await waitFor(() => expect(dom.querySelector('strong')?.textContent).toBe('Restored'));
    expect(dom.querySelector('[data-type="variable"]')?.getAttribute('data-name')).toBe('UNLISTED_VALUE');
    expect(dom.editor.state.doc.firstChild?.firstChild?.text).toBe('  ');
    expect(dom.editor.state.doc.firstChild?.lastChild?.text).toBe('  ');
    expect(onChange).not.toHaveBeenCalled();
  });
});

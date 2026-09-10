// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BlockParagraphsEditor } from '@/components/editor/BlockParagraphsEditor';
import { useDocumentStore } from '@/stores/documentStore';
import { I_TYPE_TABLES } from '@/data/techpub/tables';

// The eight tables MIL-STD-38784C fixes for an I-Type are carried by the
// paragraph that introduces them. Until this control existed, `tableKey` was
// written in exactly one place -- the template loader -- so an author who
// started from a blank publication, or who deleted a table's paragraph, had
// no way to get a table back.
/** Radix opens a dropdown on pointerdown or Enter, never on a bare click. */
const openMenu = (trigger: HTMLElement) => {
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
};

const renderEditor = () => render(
  <TooltipProvider>
    <BlockParagraphsEditor />
  </TooltipProvider>
);

describe('attaching a publication table to a paragraph', () => {
  beforeEach(() => {
    useDocumentStore.getState().resetForm();
  });

  it('offers every I-Type table on a publication paragraph', () => {
    useDocumentStore.getState().setDocType('i_type');
    renderEditor();
    expect(screen.getByRole('button', { name: 'Attach a table' })).toBeTruthy();
  });

  it('offers nothing of the sort on a letter', () => {
    useDocumentStore.getState().setDocType('naval_letter');
    renderEditor();
    expect(screen.queryByRole('button', { name: 'Attach a table' })).toBeNull();
  });

  it('names the paragraph after the table it is given, and shows the table it carries', () => {
    useDocumentStore.getState().setDocType('i_type');
    renderEditor();
    openMenu(screen.getByRole('button', { name: 'Attach a table' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Major Items Affected' }));

    const para = useDocumentStore.getState().paragraphs[0];
    expect(para.tableKey).toBe('majorItems');
    // The template pairs each table with its own paragraph title; an untitled
    // one would print a bare number.
    expect(para.header).toBe('Major Items Affected');
    expect(screen.getByRole('button', { name: /^Table: Major Items Affected/ })).toBeTruthy();
  });

  it('keeps a heading the author already wrote', () => {
    useDocumentStore.getState().setDocType('i_type');
    useDocumentStore.getState().updateParagraph(0, { header: 'Items This Instruction Changes' });
    renderEditor();
    openMenu(screen.getByRole('button', { name: 'Attach a table' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Components Affected' }));

    expect(useDocumentStore.getState().paragraphs[0].header).toBe('Items This Instruction Changes');
  });

  it('detaches the table again', () => {
    useDocumentStore.getState().setDocType('i_type');
    useDocumentStore.getState().updateParagraph(0, { tableKey: 'specialTools' });
    renderEditor();
    openMenu(screen.getByRole('button', { name: /^Table: Special Tools/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'No table' }));

    expect(useDocumentStore.getState().paragraphs[0].tableKey).toBeUndefined();
  });

  it('every table the standard fixes is offered, by its template name', () => {
    useDocumentStore.getState().setDocType('i_type');
    renderEditor();
    openMenu(screen.getByRole('button', { name: 'Attach a table' }));
    for (const spec of I_TYPE_TABLES) {
      expect(screen.getByRole('menuitemradio', { name: spec.name }), `${spec.key} is not offered`).toBeTruthy();
    }
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BlockParagraphsEditor } from '@/components/editor/BlockParagraphsEditor';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';

// Tab indents a paragraph, so on its own it can never leave the editor — a
// keyboard trap (WCAG 2.1.2). Escape hands the next Tab back to the browser.
// fireEvent returns false when the editor prevented the default focus move.

async function secondParagraph() {
  useDocumentStore.getState().setDocType('naval_letter');
  useDocumentStore.setState({
    paragraphs: [{ text: 'First.', level: 0 }, { text: 'Second.', level: 0 }],
  });
  render(<TooltipProvider><BlockParagraphsEditor /></TooltipProvider>);
  return waitFor(() => {
    const el = screen.getByLabelText('Paragraph 2');
    expect(el.getAttribute('contenteditable')).toBe('true');
    return el;
  });
}

const level = () => useDocumentStore.getState().paragraphs[1].level;

describe('Tab in the paragraph editor', () => {
  beforeEach(() => {
    useDocumentStore.getState().resetForm();
  });

  it('indents, and keeps focus in the paragraph', async () => {
    const el = await secondParagraph();
    expect(fireEvent.keyDown(el, { key: 'Tab' })).toBe(false);
    expect(level()).toBe(1);
  });

  it('moves on after Escape instead of indenting', async () => {
    const el = await secondParagraph();
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(fireEvent.keyDown(el, { key: 'Tab' })).toBe(true);
    expect(level()).toBe(0);
  });

  it('keeps the release through Shift, so Escape then Shift+Tab moves back', async () => {
    const el = await secondParagraph();
    fireEvent.keyDown(el, { key: 'Escape' });
    fireEvent.keyDown(el, { key: 'Shift', shiftKey: true });
    expect(fireEvent.keyDown(el, { key: 'Tab', shiftKey: true })).toBe(true);
  });

  it('indents again once any other key is pressed', async () => {
    const el = await secondParagraph();
    fireEvent.keyDown(el, { key: 'Escape' });
    fireEvent.keyDown(el, { key: 'a' });
    expect(fireEvent.keyDown(el, { key: 'Tab' })).toBe(false);
    expect(level()).toBe(1);
  });
});

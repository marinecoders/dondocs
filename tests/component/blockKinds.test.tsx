// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockParagraphsEditor } from '@/components/editor/BlockParagraphsEditor';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';

// A technical publication's paragraphs can be a step, a callout, an appendix
// or a figure; the gutter control names which. Correspondence has none of
// these, so it gets no control. The gutter's tooltips need the app's provider.

describe('block kinds in the paragraph editor', () => {
  beforeEach(() => {
    useDocumentStore.getState().resetForm();
  });

  it('shows each paragraph\'s kind on a publication, and an image control for a figure', () => {
    useDocumentStore.getState().setDocType('i_type');
    useDocumentStore.setState({
      paragraphs: [
        { text: 'To provide instructions.', level: 0, header: 'Purpose' },
        { text: 'Ensure the weapon is clear.', level: 0, callout: 'warning' },
        { text: 'Remove the stock.', level: 0, procedure: true },
        { text: 'Rail alignment', level: 0, figure: {} },
      ],
    });
    render(<TooltipProvider><BlockParagraphsEditor /></TooltipProvider>);
    const kinds = screen.getAllByRole('button', { name: /^Block kind: / }).map((b) => b.textContent?.trim());
    expect(kinds).toEqual(['¶', 'WARN', 'Step', 'FIG']);
    expect(screen.getByLabelText(/^Image for figure/)).toBeTruthy();
    expect(screen.getByText('No image yet')).toBeTruthy();
  });

  it('offers no block kind on a letter', () => {
    useDocumentStore.getState().setDocType('naval_letter');
    useDocumentStore.setState({ paragraphs: [{ text: 'Request leave.', level: 0 }] });
    render(<TooltipProvider><BlockParagraphsEditor /></TooltipProvider>);
    expect(screen.queryByRole('button', { name: /^Block kind: / })).toBeNull();
  });
});

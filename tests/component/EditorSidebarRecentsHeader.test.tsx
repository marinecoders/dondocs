// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EditorSidebar } from '@/components/layout/EditorSidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

// The Recents header sheds the word "New" by container query when the sidebar
// is narrow relative to the font size; the widths themselves are measured in
// the browser, since container queries don't evaluate here. What this pins is
// the part that would otherwise break silently: once the word is hidden the
// button's only accessible name is its aria-label, so it must carry one — and
// asserting on the classes instead would pass whatever was written.

describe('Recents header', () => {
  it('names the New button independently of the word it may hide', () => {
    render(
      <TooltipProvider>
        <EditorSidebar />
      </TooltipProvider>
    );

    const button = screen.getByRole('button', { name: 'New document' });

    // The visible word is decoration on top of that name, not the name itself,
    // so hiding it cannot leave the button unnamed.
    expect(button.querySelector('span')?.textContent).toBe('New');
  });
});

// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EditorSidebar } from '@/components/layout/EditorSidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

describe('Recents header', () => {
  it('keeps document creation labeled and available without opening a document', () => {
    render(
      <TooltipProvider>
        <EditorSidebar />
      </TooltipProvider>
    );

    const button = screen.getByRole('button', { name: 'New document' });

    expect(button).toHaveTextContent('New document');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { PdfViewerToolbar } from '@/components/pdf/PdfViewerToolbar';
import { TooltipProvider } from '@/components/ui/tooltip';

// Container queries don't evaluate here, so both variants of the trailing group
// are in the DOM at once and a "hidden at 400px" assertion would pass whatever
// classes were written. What this file pins is the part jsdom can prove: the
// menu carries the same three actions the buttons do, and both routes call the
// same handlers. The widths themselves are measured in the browser.

function setup(overrides: Partial<React.ComponentProps<typeof PdfViewerToolbar>> = {}) {
  const props = {
    page: 1,
    pageCount: 2,
    zoomPercent: 100,
    fitMode: 'width' as const,
    thumbnails: null,
    onGoToPage: vi.fn(),
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomFitWidth: vi.fn(),
    onZoomFitPage: vi.fn(),
    onOpenInTab: vi.fn(),
    onDownload: vi.fn(),
    fullscreen: { isFullscreen: false, toggle: vi.fn() },
    ...overrides,
  };
  render(
    <TooltipProvider>
      <PdfViewerToolbar {...props} />
    </TooltipProvider>
  );
  return props;
}

/** Radix opens its menu on pointerdown, which happy-dom doesn't synthesize
 *  from click; the keyboard path is both real and available here. */
async function openOverflowMenu() {
  const trigger = screen.getByRole('button', { name: 'More preview actions' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
}

describe('PdfViewerToolbar trailing actions', () => {
  it('offers every trailing action as a button', () => {
    setup();
    for (const name of ['Fit width', 'Fit page', 'Fullscreen', 'Download PDF', 'Open in browser tab']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('offers the same five through the overflow menu', async () => {
    setup();
    await openOverflowMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Fit width' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Fit page' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Fullscreen' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open in browser tab' })).toBeInTheDocument();
  });

  it('buttons and menu items call the same handlers', async () => {
    const props = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser tab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit page' }));
    expect(props.fullscreen.toggle).toHaveBeenCalledTimes(1);
    expect(props.onDownload).toHaveBeenCalledTimes(1);
    expect(props.onOpenInTab).toHaveBeenCalledTimes(1);
    expect(props.onZoomFitPage).toHaveBeenCalledTimes(1);

    await openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    expect(props.onDownload).toHaveBeenCalledTimes(2);

    await openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in browser tab' }));
    expect(props.onOpenInTab).toHaveBeenCalledTimes(2);

    await openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fullscreen' }));
    expect(props.fullscreen.toggle).toHaveBeenCalledTimes(2);

    await openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Fit page' }));
    expect(props.onZoomFitPage).toHaveBeenCalledTimes(2);
  });

  it('carries the active fit mode into the menu, not just the buttons', async () => {
    setup({ fitMode: 'page' });
    expect(screen.getByRole('button', { name: 'Fit page' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Fit width' })).toHaveAttribute('aria-pressed', 'false');

    await openOverflowMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Fit page' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Fit width' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('names the exit action when already fullscreen, in both variants', async () => {
    setup({ fullscreen: { isFullscreen: true, toggle: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();
    await openOverflowMenu();
    expect(screen.getByRole('menuitem', { name: 'Exit fullscreen' })).toBeInTheDocument();
  });

  it('drops the fullscreen entry from both variants when no handler is given', async () => {
    setup({ fullscreen: null });
    expect(screen.queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
    await openOverflowMenu();
    expect(screen.queryByRole('menuitem', { name: /fullscreen/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download PDF' })).toBeInTheDocument();
  });
});

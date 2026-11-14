import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TourOverlay } from '@/components/tour/TourOverlay';
import { useTourStore } from '@/stores/tourStore';

beforeEach(() => useTourStore.getState().end());

function ExternalDialog() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Workspace settings</button>
    <button>Next action</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Preferences for this device.</DialogDescription>
        <input aria-label="Preference" />
      </DialogContent>
    </Dialog>
  </>;
}

function WalkthroughDialog() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => useTourStore.getState().startSteps([
      { title: 'Backup settings', body: 'Open the backup tools.', action: () => setOpen(true) },
      { title: 'Download a backup', body: 'Keep a copy of your work.' },
    ])}>Start walkthrough</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Backup preferences.</DialogDescription>
        <input aria-label="Backup preference" />
      </DialogContent>
    </Dialog>
    <TourOverlay />
  </>;
}

describe('externally controlled dialogs', () => {
  it('preserves the next action chosen before deferred close focus runs', () => {
    vi.useFakeTimers();
    try {
      render(<ExternalDialog />);
      const launcher = screen.getByRole('button', { name: 'Workspace settings' });
      launcher.focus();
      fireEvent.click(launcher);
      expect(screen.getByRole('textbox', { name: 'Preference' })).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      const next = screen.getByRole('button', { name: 'Next action' });
      next.focus();
      expect(next).toHaveFocus();
      act(() => vi.runOnlyPendingTimers());
      expect(next).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still restores the launcher when focus is on a Radix boundary guard', () => {
    vi.useFakeTimers();
    const guard = document.createElement('span');
    guard.tabIndex = 0;
    guard.setAttribute('data-radix-focus-guard', '');
    document.body.append(guard);
    try {
      render(<ExternalDialog />);
      const launcher = screen.getByRole('button', { name: 'Workspace settings' });
      launcher.focus();
      fireEvent.click(launcher);
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      guard.focus();
      expect(guard).toHaveFocus();
      act(() => vi.runOnlyPendingTimers());
      expect(launcher).toHaveFocus();
    } finally {
      guard.remove();
      vi.useRealTimers();
    }
  });

  it('contains keyboard focus and returns to the launching control after Escape', async () => {
    const user = userEvent.setup();
    render(<ExternalDialog />);
    await user.click(screen.getByRole('button', { name: 'Workspace settings' }));
    expect(screen.getByRole('textbox', { name: 'Preference' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Workspace settings' })).toHaveFocus());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus();
  });

  it('leaves focus with a walkthrough that opens a dialog, then restores normal dialog focus', async () => {
    const user = userEvent.setup();
    render(<WalkthroughDialog />);
    await user.click(screen.getByRole('button', { name: 'Start walkthrough' }));
    const tour = screen.getByRole('region', { name: 'Product tour' });
    await waitFor(() => expect(tour).toContainElement(document.activeElement as HTMLElement));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Exit tour' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Exit tour' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Download a backup' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Backup settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Backup preference' })).toHaveFocus());
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it.each(['button', 'Escape'])('keeps the underlying dialog open when exiting the tour with %s', async (exit) => {
    const user = userEvent.setup();
    render(<WalkthroughDialog />);
    await user.click(screen.getByRole('button', { name: 'Start walkthrough' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Product tour' })).toContainElement(document.activeElement as HTMLElement));
    if (exit === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: 'Exit tour' }));
    expect(screen.queryByRole('region', { name: 'Product tour' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Backup preference' })).toHaveFocus());
  });
});

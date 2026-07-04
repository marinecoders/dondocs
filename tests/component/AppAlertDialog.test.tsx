// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

import { AppAlertDialog } from '@/components/AppAlertDialog';
import { useAlertStore, showAppAlert, showAppConfirm } from '@/stores/alertStore';

// The dialog is a singleton fed by the store; reset between tests so a
// leftover open/queue never leaks across cases.
beforeEach(() => {
  useAlertStore.setState({ open: false, current: null, queue: [] });
});

describe('AppAlertDialog', () => {
  it('showAppAlert renders a themed dialog with title + message, OK closes it', async () => {
    render(<AppAlertDialog />);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    act(() => {
      showAppAlert({ title: 'Image too large', message: 'Max 2 MB. Please use a smaller file.' });
    });

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    expect(screen.getByText('Image too large')).toBeTruthy();
    expect(screen.getByText(/smaller file/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('multi-line messages keep their line breaks (pre-line)', async () => {
    render(<AppAlertDialog />);
    act(() => {
      showAppAlert({ title: 'Open in Safari', message: '1. Tap share\n2. Select "Open in Safari"' });
    });
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());

    const description = screen.getByText(/Tap share/);
    // The class carries the whitespace behavior; happy-dom doesn't compute
    // styles for Tailwind utilities, so assert the class contract directly.
    expect(description.className).toContain('whitespace-pre-line');
    expect(description.textContent).toContain('\n');
  });

  it('showAppConfirm resolves true on the confirm button', async () => {
    render(<AppAlertDialog />);
    let resolved: boolean | undefined;
    act(() => {
      void showAppConfirm({
        title: 'Delete profile?',
        message: '"Alpha" will be removed.',
        confirmLabel: 'Delete',
        destructive: true,
      }).then((ok) => {
        resolved = ok;
      });
    });

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    const confirmBtn = screen.getByRole('button', { name: 'Delete' });
    // Destructive confirms wear the destructive palette, not the default.
    expect(confirmBtn.className).toContain('bg-destructive');

    fireEvent.click(confirmBtn);
    await waitFor(() => expect(resolved).toBe(true));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('showAppConfirm resolves false on Cancel', async () => {
    render(<AppAlertDialog />);
    let resolved: boolean | undefined;
    act(() => {
      void showAppConfirm({ title: 'Delete profile?', message: 'Sure?' }).then((ok) => {
        resolved = ok;
      });
    });

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(resolved).toBe(false));
  });

  it('Escape dismisses and resolves false (never true)', async () => {
    render(<AppAlertDialog />);
    let resolved: boolean | undefined;
    act(() => {
      void showAppConfirm({ title: 'Delete?', message: 'Sure?' }).then((ok) => {
        resolved = ok;
      });
    });

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    await waitFor(() => expect(resolved).toBe(false));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('alerts fired back-to-back queue like native alert(): second shows after the first is dismissed', async () => {
    render(<AppAlertDialog />);
    act(() => {
      showAppAlert({ title: 'First', message: 'one' });
      showAppAlert({ title: 'Second', message: 'two' });
    });

    await waitFor(() => expect(screen.getByText('First')).toBeTruthy());
    expect(screen.queryByText('Second')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.getByText('Second')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});

/**
 * Component tests for the top-level <ErrorBoundary> (recovery path).
 *
 * The recovery UI is itself untested by the rest of the suite, yet it is
 * the last line of defense against a white-screen crash. These tests lock
 * in the behaviour that matters during a real crash:
 *   - children render normally when nothing throws;
 *   - a render-phase throw is caught and the fallback is shown;
 *   - "Copy saved draft" reflects copied / empty / failed states;
 *   - "Reset and reload" clears BOTH session keys (the regression that
 *     used to clear the wrong key and infinite-crash-loop — audit #6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { STORAGE_KEYS } from '@/lib/constants';

// Control what the boundary believes is in the auto-saved session.
const getSavedSession = vi.fn();
vi.mock('@/stores/documentStore', () => ({
  getSavedSession: () => getSavedSession(),
}));

function Bomb(): never {
  throw new Error('KaBoom');
}

// React prints the caught error to console.error; silence it so the test
// output stays readable (the boundary's own behaviour is what we assert).
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  getSavedSession.mockReset();
  localStorage.clear();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('all good')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('catches a render-phase throw and shows the recovery UI', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    // The original error name + message are surfaced to the user.
    expect(alert).toHaveTextContent('Error:');
    expect(alert).toHaveTextContent('KaBoom');
  });

  it('"Copy saved draft" copies the decompressed session and confirms', async () => {
    const user = userEvent.setup();
    getSavedSession.mockReturnValue({ docType: 'naval_letter', paragraphs: [] });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: /copy auto-saved session/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('naval_letter');
    expect(await screen.findByText('Copied ✓')).toBeInTheDocument();
  });

  it('"Copy saved draft" reports "No saved draft" when nothing is stored', async () => {
    const user = userEvent.setup();
    getSavedSession.mockReturnValue(null); // no compressed session
    // and no manual DOCUMENT draft either
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: /copy auto-saved session/i }));

    expect(writeText).not.toHaveBeenCalled();
    expect(await screen.findByText('No saved draft')).toBeInTheDocument();
  });

  it('"Copy saved draft" reports failure when the clipboard rejects', async () => {
    const user = userEvent.setup();
    getSavedSession.mockReturnValue({ docType: 'naval_letter' });
    const writeText = vi.fn().mockRejectedValue(new Error('insecure context'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: /copy auto-saved session/i }));

    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  });

  it('"Reset and reload" clears BOTH session keys after the inline confirmation (audit #6)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEYS.DOCUMENT_SESSION, 'compressed-session');
    localStorage.setItem(STORAGE_KEYS.DOCUMENT, 'manual-draft');
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
      configurable: true,
    });

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    // Two-step flow: the first click only ARMS the in-app confirmation strip
    // (no native window.confirm — it follows the OS theme, not the app's) and
    // must not erase anything by itself.
    await user.click(screen.getByRole('button', { name: /erase saved draft and reload/i }));
    expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT_SESSION)).toBe('compressed-session');
    expect(reload).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Erase and reload' }));

    expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT_SESSION)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('"Reset and reload" is a no-op when the user cancels the inline confirm', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEYS.DOCUMENT_SESSION, 'compressed-session');
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
      configurable: true,
    });

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: /erase saved draft and reload/i }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT_SESSION)).toBe('compressed-session');
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Erase and reload' })).not.toBeInTheDocument();
  });

  it('matches the active color scheme instead of always rendering light', () => {
    // Dark class on <html> is how the app applies dark mode (set pre-paint by
    // index.html); the crash screen must follow it, not blast a white page.
    document.documentElement.classList.add('dark');
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      );
      const page = screen.getByRole('alert');
      expect(page.style.backgroundColor).toBe('#0b1120'); // dark, not #f8fafc
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });

  it('toggles the stack-trace details on demand', async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.queryByText('Stack trace')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show details/i }));
    expect(screen.getByText('Stack trace')).toBeInTheDocument();
  });
});

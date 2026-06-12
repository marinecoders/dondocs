/**
 * Component tests for <RestoreSessionModal> (recovery path).
 *
 * Covers the prompt that decides the fate of a returning user's unsaved
 * work, including the suspend/resume guard that stops mount-time autosaves
 * from clobbering the saved session before the user chooses (audit #10
 * restore-race; the fix shipped in fix/restore-race).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RestoreSessionModal } from '@/components/modals/RestoreSessionModal';
import * as store from '@/stores/documentStore';
import { getDeviceInfo } from '@/utils/device';
import { SW_AUTO_RESTORE_KEY } from '@/hooks/useServiceWorker';

vi.mock('@/stores/documentStore', () => ({
  hasSavedSession: vi.fn(),
  suspendSessionSaves: vi.fn(),
  resumeSessionSaves: vi.fn(),
  getSavedSession: vi.fn(),
  restoreSession: vi.fn(),
  clearSavedSession: vi.fn(),
  getSessionAge: vi.fn(() => '2 hours ago'),
}));
vi.mock('@/utils/device', () => ({
  getDeviceInfo: vi.fn(() => ({ isInAppBrowser: false })),
}));
vi.mock('@/hooks/useServiceWorker', () => ({
  SW_AUTO_RESTORE_KEY: 'dondocs-sw-auto-restore',
}));

const SESSION = {
  docType: 'naval_letter',
  formData: { subject: 'PROMOTION RECOMMENDATION' },
  paragraphs: [{ text: 'a' }, { text: 'b' }],
  references: [{ letter: 'a', title: 'ref' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(getDeviceInfo).mockReturnValue({ isInAppBrowser: false } as ReturnType<typeof getDeviceInfo>);
  vi.mocked(store.getSessionAge).mockReturnValue('2 hours ago');
});

describe('RestoreSessionModal', () => {
  it('stays closed when there is no saved session', () => {
    vi.mocked(store.hasSavedSession).mockReturnValue(false);
    render(<RestoreSessionModal />);
    expect(screen.queryByText('Restore Previous Session?')).not.toBeInTheDocument();
    expect(store.suspendSessionSaves).not.toHaveBeenCalled();
  });

  it('opens, suspends autosave, and previews the saved session', async () => {
    vi.mocked(store.hasSavedSession).mockReturnValue(true);
    vi.mocked(store.getSavedSession).mockReturnValue(SESSION as ReturnType<typeof store.getSavedSession>);

    render(<RestoreSessionModal />);

    expect(await screen.findByText('Restore Previous Session?')).toBeInTheDocument();
    // Autosave is frozen while the prompt is up (the restore-race guard).
    expect(store.suspendSessionSaves).toHaveBeenCalledTimes(1);
    // Preview is seeded from the saved session.
    expect(screen.getByText('Naval Letter')).toBeInTheDocument();
    expect(screen.getByText(/PROMOTION RECOMMENDATION/)).toBeInTheDocument();
    expect(screen.getByText('2 paragraphs')).toBeInTheDocument();
    expect(screen.getByText('1 reference')).toBeInTheDocument();
  });

  it('"Restore Session" restores and resumes autosave', async () => {
    const user = userEvent.setup();
    vi.mocked(store.hasSavedSession).mockReturnValue(true);
    vi.mocked(store.getSavedSession).mockReturnValue(SESSION as ReturnType<typeof store.getSavedSession>);

    render(<RestoreSessionModal />);
    await screen.findByText('Restore Previous Session?');
    await user.click(screen.getByRole('button', { name: /restore session/i }));

    expect(store.restoreSession).toHaveBeenCalledTimes(1);
    expect(store.resumeSessionSaves).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText('Restore Previous Session?')).not.toBeInTheDocument()
    );
  });

  it('"Start Fresh" clears the session and resumes autosave', async () => {
    const user = userEvent.setup();
    vi.mocked(store.hasSavedSession).mockReturnValue(true);
    vi.mocked(store.getSavedSession).mockReturnValue(SESSION as ReturnType<typeof store.getSavedSession>);

    render(<RestoreSessionModal />);
    await screen.findByText('Restore Previous Session?');
    await user.click(screen.getByRole('button', { name: /start fresh/i }));

    expect(store.clearSavedSession).toHaveBeenCalledTimes(1);
    expect(store.resumeSessionSaves).toHaveBeenCalledTimes(1);
    expect(store.restoreSession).not.toHaveBeenCalled();
  });

  it('does not prompt inside an in-app browser', () => {
    vi.mocked(getDeviceInfo).mockReturnValue({ isInAppBrowser: true } as ReturnType<typeof getDeviceInfo>);
    vi.mocked(store.hasSavedSession).mockReturnValue(true);
    vi.mocked(store.getSavedSession).mockReturnValue(SESSION as ReturnType<typeof store.getSavedSession>);

    render(<RestoreSessionModal />);
    expect(screen.queryByText('Restore Previous Session?')).not.toBeInTheDocument();
    expect(store.suspendSessionSaves).not.toHaveBeenCalled();
  });

  it('auto-restores silently (no prompt) after a service-worker update', () => {
    localStorage.setItem(SW_AUTO_RESTORE_KEY, 'true');
    vi.mocked(store.hasSavedSession).mockReturnValue(true);
    vi.mocked(store.getSavedSession).mockReturnValue(SESSION as ReturnType<typeof store.getSavedSession>);

    render(<RestoreSessionModal />);

    expect(store.restoreSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Restore Previous Session?')).not.toBeInTheDocument();
    // The one-shot flag is consumed so it can't re-fire next mount.
    expect(localStorage.getItem(SW_AUTO_RESTORE_KEY)).toBeNull();
  });
});

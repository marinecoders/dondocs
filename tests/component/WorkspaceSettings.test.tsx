import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { HelpModal } from '@/components/modals/HelpModal';
import { useUIStore } from '@/stores/uiStore';
import { useBackupStore } from '@/stores/backupStore';
import { downloadWorkspaceBackup } from '@/lib/backupDownload';
vi.mock('@/lib/backupDownload', () => ({ downloadWorkspaceBackup: vi.fn() }));

beforeEach(() => {
  vi.mocked(downloadWorkspaceBackup).mockReset();
  useUIStore.setState({ settingsOpen: false, helpOpen: false, settingsSection: 'appearance' });
  useBackupStore.setState({ status: 'unsupported', fileName: null, fileMissing: false });
});

describe('workspace settings and help', () => {
  it('keeps failed backup feedback actionable without claiming success', async () => {
    vi.mocked(downloadWorkspaceBackup).mockRejectedValue(new Error('Saved documents could not be read'));
    useUIStore.getState().setSettingsOpen(true, 'backup');
    render(<SettingsModal />);
    expect(screen.getByRole('heading', { name: 'Backup & restore' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Choose auto-backup file' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back up everything' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved documents could not be read');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back up everything' })).toBeEnabled();
  });
  it('offers reconnect when backup permissions expire', async () => {
    const reconnect = vi.fn().mockResolvedValue(undefined);
    useBackupStore.setState({ status: 'needs-permission', reconnect });
    useUIStore.getState().setSettingsOpen(true, 'backup');
    render(<SettingsModal />);
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect auto-backup' }));
    expect(reconnect).toHaveBeenCalledOnce();
  });
  it('opens backup settings from Help and retains focus in the new dialog', async () => {
    useUIStore.getState().setHelpOpen(true);
    render(<><HelpModal /><SettingsModal /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Backup & restore' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Backup & restore' })).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Help' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });
});

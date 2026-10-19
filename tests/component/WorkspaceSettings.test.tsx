import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { HelpModal } from '@/components/modals/HelpModal';
import { useDocumentStore } from '@/stores/documentStore';
import { useLogStore } from '@/stores/logStore';
import { useUIStore } from '@/stores/uiStore';
import { useBackupStore } from '@/stores/backupStore';
import { downloadWorkspaceBackup } from '@/lib/backupDownload';
vi.mock('@/lib/backupDownload', () => ({ downloadWorkspaceBackup: vi.fn() }));

beforeEach(() => {
  vi.mocked(downloadWorkspaceBackup).mockReset();
  useUIStore.setState({ settingsOpen: false, helpOpen: false, settingsSection: 'appearance', theme: 'light', density: 'comfortable' });
  useBackupStore.setState({ status: 'unsupported', fileName: null, fileMissing: false });
});

describe('workspace settings and help', () => {
  it('offers exactly three appearances and persists the choice', async () => {
    useUIStore.getState().setTheme('classic');
    useUIStore.getState().setSettingsOpen(true);
    render(<SettingsModal />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Classic' })).toHaveFocus();
    for (const theme of ['Dark', 'Classic', 'Light']) {
      await userEvent.click(screen.getByRole('radio', { name: theme }));
      expect(screen.getByRole('radio', { name: theme })).toBeChecked();
      expect(useUIStore.getState().theme).toBe(theme.toLowerCase());
      expect(JSON.parse(localStorage.getItem('dondocs_ui')!).state.theme).toBe(theme.toLowerCase());
    }
    expect(screen.queryByRole('combobox', { name: 'Colors' })).not.toBeInTheDocument();
  });
  it('keeps failed backup feedback actionable without claiming success', async () => {
    vi.mocked(downloadWorkspaceBackup).mockRejectedValue(new Error('Saved documents could not be read'));
    useUIStore.getState().setSettingsOpen(true, 'backup');
    render(<SettingsModal />);
    expect(screen.getByRole('heading', { name: 'Backup & restore' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Choose auto-backup file' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download workspace backup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved documents could not be read');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download workspace backup' })).toBeEnabled();
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

it.each(['View logs', 'Endpoint check', 'NIST 800-171'])('keeps %s reachable from Help Support', async (label) => {
  useUIStore.setState({ helpOpen: true, connectivityModalOpen: false, nistModalOpen: false });
  useLogStore.getState().setOpen(false);
  render(<HelpModal />);
  await userEvent.click(screen.getByRole('tab', { name: 'Support' }));
  await userEvent.click(screen.getByRole('button', { name: label }));
  expect(useUIStore.getState().helpOpen).toBe(false);
  if (label === 'View logs') expect(useLogStore.getState().isOpen).toBe(true);
  if (label === 'Endpoint check') expect(useUIStore.getState().connectivityModalOpen).toBe(true);
  if (label === 'NIST 800-171') expect(useUIStore.getState().nistModalOpen).toBe(true);
});

it.each(['Report bug', 'Suggest feature'])('opens a reviewable %s draft without sending document content', async (label) => {
  useDocumentStore.getState().setField('subject', 'UNRELATED_PRIVATE_CONTENT');
  useUIStore.getState().setHelpOpen(true);
  render(<HelpModal />);
  await userEvent.click(screen.getByRole('tab', { name: 'Support' }));
  const link = screen.getByRole('link', { name: `${label} (opens in a new tab)` });
  const url = new URL(link.getAttribute('href')!);
  expect(url.pathname).toBe('/marinecoders/dondocs/issues/new');
  expect(url.searchParams.get('body')).toContain('public GitHub');
  expect(url.searchParams.get('body')).not.toContain('UNRELATED_PRIVATE_CONTENT');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

it('persists each density setting without changing document content', async () => {
  useUIStore.getState().setSettingsOpen(true);
  const before = structuredClone(useDocumentStore.getState().formData);
  const paragraphs = structuredClone(useDocumentStore.getState().paragraphs);
  render(<SettingsModal />);
  for (const density of ['compact', 'comfortable', 'spacious']) {
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Density' }), density);
    expect(useUIStore.getState().density).toBe(density);
    expect(JSON.parse(localStorage.getItem('dondocs_ui')!).state.density).toBe(density);
    expect(useDocumentStore.getState().formData).toEqual(before);
    expect(useDocumentStore.getState().paragraphs).toEqual(paragraphs);
  }
  // Rehydrate the stored choice, not the temporary in-memory value.
  const stored = localStorage.getItem('dondocs_ui')!;
  useUIStore.setState({ density: 'comfortable' });
  localStorage.setItem('dondocs_ui', stored);
  await useUIStore.persist.rehydrate();
  expect(useUIStore.getState().density).toBe('spacious');
});

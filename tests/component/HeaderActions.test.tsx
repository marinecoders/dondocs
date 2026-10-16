import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from '@/components/layout/Header';
import { AppAlertDialog } from '@/components/AppAlertDialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAlertStore } from '@/stores/alertStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { STORAGE_KEYS } from '@/lib/constants';
import { downloadWorkspaceBackup } from '@/lib/backupDownload';

vi.mock('@/lib/backupDownload', () => ({ downloadWorkspaceBackup: vi.fn() }));

beforeEach(() => {
  useAlertStore.setState({ open: false, current: null, queue: [] });
  useUIStore.setState({ saveMenuOpen: false });
  useDocumentStore.getState().resetForm();
  useDocumentStore.getState().setField('subject', 'Keep my draft');
  localStorage.removeItem(STORAGE_KEYS.DOCUMENT);
  vi.mocked(downloadWorkspaceBackup).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function renderHeader() {
  return render(<TooltipProvider><Header /><AppAlertDialog /></TooltipProvider>);
}

async function chooseAction(name: string | RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Document actions' }));
  await user.click(screen.getByRole('menuitem', { name }));
}

describe('document action error feedback', () => {
  it('shows a visible popup for a missing saved draft and returns focus to Document actions', async () => {
    renderHeader();
    await chooseAction('Open saved draft');
    expect(await screen.findByRole('alertdialog', { name: 'No saved draft' })).toBeVisible();
    expect(useDocumentStore.getState().formData.subject).toBe('Keep my draft');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Document actions' })).toHaveFocus());
  });

  it('keeps the draft intact when an import is malformed', async () => {
    renderHeader();
    fireEvent.change(screen.getByLabelText('Import draft file'), { target: { files: [new File(['{broken'], 'invalid.json', { type: 'application/json' })] } });
    expect(await screen.findByRole('alertdialog', { name: 'Could not import draft' })).toBeVisible();
    expect(useDocumentStore.getState().formData.subject).toBe('Keep my draft');
  });

  it('reports backup file read failures instead of failing silently', async () => {
    renderHeader();
    fireEvent.change(screen.getByLabelText('Restore workspace backup file'), { target: { files: [{ text: async () => { throw new Error('File unavailable'); } }] } });
    expect(await screen.findByRole('alertdialog', { name: 'Could not restore backup' })).toBeVisible();
    expect(useDocumentStore.getState().formData.subject).toBe('Keep my draft');
  });

  it('reports malformed saved data and blocked manual saving', async () => {
    localStorage.setItem(STORAGE_KEYS.DOCUMENT, '{broken');
    renderHeader();
    await chooseAction('Open saved draft');
    expect(await screen.findByRole('alertdialog', { name: 'Could not open saved draft' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    await chooseAction(/^Save draft/);
    expect(await screen.findByRole('alertdialog', { name: 'Could not save draft' })).toBeVisible();
    expect(useDocumentStore.getState().formData.subject).toBe('Keep my draft');
  });

  it('shows backup failures and visible success feedback on retry', async () => {
    vi.mocked(downloadWorkspaceBackup).mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValueOnce(undefined);
    renderHeader();
    await chooseAction('Back up everything');
    expect(await screen.findByRole('alertdialog', { name: 'Could not back up workspace' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await chooseAction('Back up everything');
    expect(await screen.findByRole('status')).toHaveTextContent('Backup download started');
    expect(screen.getByRole('status')).not.toHaveClass('sr-only');
  });
});

import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { Header } from '@/components/layout/Header';
import { AppAlertDialog } from '@/components/AppAlertDialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAlertStore } from '@/stores/alertStore';
import { useFormStore } from '@/stores/formStore';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { idbGetSnapshots } from '@/lib/documentsDb';
import { STORAGE_KEYS } from '@/lib/constants';
import { downloadWorkspaceBackup } from '@/lib/backupDownload';
import { MAX_BACKUP_BYTES } from '@/lib/backupSize';

vi.mock('@/lib/backupDownload', () => ({ downloadWorkspaceBackup: vi.fn() }));

beforeEach(() => {
  useAlertStore.setState({ open: false, current: null, queue: [] });
  useUIStore.setState({ saveMenuOpen: false, batchModalOpen: false, settingsOpen: false, reviewRoundsOpen: false });
  useDocumentStore.setState({ documentCategory: 'correspondence', formType: 'navmc_10274' });
  useFormStore.getState().clearNavmc10274();
  useFormStore.getState().clearNavmc11811();
  useDocumentStore.getState().resetForm();
  useDocumentStore.getState().setField('subject', 'Keep my draft');
  localStorage.removeItem(STORAGE_KEYS.DOCUMENT);
  vi.mocked(downloadWorkspaceBackup).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function renderHeader() {
  return render(<TooltipProvider><Header /><SettingsModal /><AppAlertDialog /></TooltipProvider>);
}

async function chooseAction(name: string | RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Document actions' }));
  await user.click(screen.getByRole('menuitem', { name }));
}

it('keeps Comments directly in the document header and hands off to review rounds with focus restored', async () => {
  useDocumentsStore.getState().newDocument();
  renderHeader();
  const user = userEvent.setup();
  const comments = screen.getByRole('button', { name: 'Comments' });
  expect(comments.closest('header')).not.toBeNull();
  await user.click(comments);
  await user.click(screen.getByRole('button', { name: 'Review rounds…' }));
  const review = await screen.findByRole('dialog', { name: 'Review rounds' });
  expect(screen.queryByRole('dialog', { name: 'Document comments' })).not.toBeInTheDocument();
  expect(review).toContainElement(document.activeElement as HTMLElement);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(comments).toHaveFocus());
  // The original document-actions route remains available as a shortcut.
  await chooseAction('Review rounds…');
  expect(await screen.findByRole('dialog', { name: 'Review rounds' })).toBeVisible();
});

describe('document action error feedback', () => {
  it('shows a visible popup for a missing saved draft and returns focus to Document actions', async () => {
    renderHeader();
    await chooseAction('Open saved checkpoint');
    expect(await screen.findByRole('alertdialog', { name: 'No saved checkpoint' })).toBeVisible();
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

  it('keeps the latest selected draft when an earlier asynchronous file finishes later', async () => {
    const contents = (subject: string) => JSON.stringify({ ...getSerializedSession(), formData: { ...getSerializedSession().formData, subject } });
    let release!: (value: string) => void;
    renderHeader();const input = screen.getByLabelText('Import draft file');
    fireEvent.change(input, { target: { files: [{ text: () => new Promise<string>(resolve => { release = resolve; }) }] } });
    fireEvent.change(input, { target: { files: [new File([contents('LATEST SELECTED COPY')], 'latest.json', { type: 'application/json' })] } });
    const review = await screen.findByRole('dialog', { name: 'Review draft' });
    await waitFor(() => expect(review).toHaveTextContent('LATEST SELECTED COPY'));
    await act(async () => { release(contents('SUPERSEDED COPY')); });
    expect(review).toHaveTextContent('LATEST SELECTED COPY');expect(review).not.toHaveTextContent('SUPERSEDED COPY');
    expect(useDocumentStore.getState().formData.subject).toBe('Keep my draft');
  });

  it('does not report an older read failure over a newer valid draft review', async () => {
    let reject!: (cause: Error) => void;
    renderHeader();const input = screen.getByLabelText('Import draft file');
    fireEvent.change(input, { target: { files: [{ text: () => new Promise<string>((_resolve, fail) => { reject = fail; }) }] } });
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(getSerializedSession())], 'latest.json', { type: 'application/json' })] } });
    await screen.findByRole('dialog', { name: 'Review draft' });
    await act(async () => { reject(new Error('Older file is unavailable')); });
    expect(screen.queryByRole('alertdialog', { name: 'Could not import draft' })).not.toBeInTheDocument();
  });

  it('reports backup file read failures instead of failing silently', async () => {
    renderHeader();
    act(() => useUIStore.getState().setSettingsOpen(true, 'backup'));
    const file = new File(['{}'], 'unavailable-backup.json', { type: 'application/json' });
    vi.spyOn(file, 'text').mockRejectedValue(new Error('File unavailable'));
    fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('File unavailable');
    expect(useDocumentStore.getState().formData.subject).toBe('Keep my draft');
  });

  it('reports malformed saved data and blocked manual saving', async () => {
    localStorage.setItem(STORAGE_KEYS.DOCUMENT, '{broken');
    renderHeader();
    await chooseAction('Open saved checkpoint');
    expect(await screen.findByRole('alertdialog', { name: 'Could not open saved checkpoint' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    // happy-dom binds Storage methods on access and hides their descriptors.
    // Preserve the actual function and restore it explicitly, even on failure.
    const originalWrite = localStorage.setItem;
    Object.defineProperty(localStorage, 'setItem', {
      configurable: true, writable: true,
      value: vi.fn(() => { throw new Error('Quota exceeded'); }),
    });
    try {
      await chooseAction(/^Save checkpoint/);
      expect(await screen.findByRole('alertdialog', { name: 'Could not save checkpoint' })).toBeVisible();
      expect(useDocumentStore.getState().formData.subject).toBe('Keep my draft');
    } finally {
      Object.defineProperty(localStorage, 'setItem', {
        configurable: true, writable: true, value: originalWrite,
      });
    }
  });

  it('shows backup failures and visible success feedback on retry', async () => {
    vi.mocked(downloadWorkspaceBackup).mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValueOnce(undefined);
    renderHeader();
    act(() => useUIStore.getState().setSettingsOpen(true, 'backup'));
    const backup = within(screen.getByRole('region', { name: 'Backup & restore' }));
    expect(backup.getByRole('heading', { name: 'Backup & restore' })).toHaveFocus();
    await userEvent.click(backup.getByRole('button', { name: 'Download workspace backup' }));
    expect(await backup.findByRole('alert')).toHaveTextContent('Storage unavailable');
    await userEvent.click(backup.getByRole('button', { name: 'Download workspace backup' }));
    const feedback = await backup.findByRole('status');
    expect(feedback).toHaveTextContent('Backup download started');
    expect(feedback).toBeVisible();
    expect(feedback).not.toHaveClass('sr-only');
  });
});

describe('active form actions', () => {
  it.each(['navmc_10274', 'navmc_118_11'] as const)('clears and resets only %s, preserving saved drafts', async (formType) => {
    useDocumentStore.setState({ documentCategory: 'forms', formType });
    useFormStore.getState().setNavmc10274Field('natureOfAction', 'AA text');
    useFormStore.getState().setNavmc11811Field('remarksText', 'Remarks text');
    localStorage.setItem(STORAGE_KEYS.DOCUMENT, 'saved draft sentinel');
    render(<TooltipProvider><Header isFormsMode /></TooltipProvider>);
    await chooseAction('Clear form fields…');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useFormStore.getState().navmc10274.natureOfAction).toBe('AA text');
    await chooseAction('Clear form fields…');
    await userEvent.click(screen.getByRole('button', { name: 'Clear form fields' }));
    const active = () => formType === 'navmc_10274' ? useFormStore.getState().navmc10274.natureOfAction : useFormStore.getState().navmc11811.remarksText;
    expect(active()).toBe('');
    await chooseAction('Reset form to sample values…');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to sample values' }));
    expect(active()).not.toBe('');
    expect(useDocumentStore.getState().formData.subject).toBe('Keep my draft');
    expect(formType === 'navmc_10274' ? useFormStore.getState().navmc11811.remarksText : useFormStore.getState().navmc10274.natureOfAction)
      .toBe(formType === 'navmc_10274' ? 'Remarks text' : 'AA text');
    expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT)).toBe('saved draft sentinel');
  });

  it('checks variables in the active form, including lowercase signature variables', async () => {
    useDocumentStore.setState({ documentCategory: 'forms' });
    useDocumentStore.getState().setField('subject', '{{HIDDEN_LETTER}}');
    const download = vi.fn();
    render(<TooltipProvider><Header isFormsMode onDownloadPdf={download} /></TooltipProvider>);
    const clickDownload = async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Download' }));
      await userEvent.click(screen.getByRole('menuitem', { name: /PDF/ }));
    };
    await clickDownload();
    expect(download).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().batchModalOpen).toBe(false);
    useFormStore.getState().setNavmc10274Field('signatureBlocks', [{ name: '{{name}}', statement: '' }]);
    await clickDownload();
    expect(download).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().batchModalOpen).toBe(true);
  });
});


it('viewing History preserves existing versions and flushes pending edits without forced checkpoints', async () => {
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Original subject');
  useDocumentsStore.getState().saveCurrent();
  const id = useDocumentsStore.getState().currentId!;
  await waitFor(async () => expect((await idbGetSnapshots(id)).length).toBeGreaterThan(0));
  const versions = await idbGetSnapshots(id);
  renderHeader();
  for (let i = 0; i < 12; i++) {
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
  }
  expect(useUIStore.getState().historyDocId).toBe(id);
  expect(await idbGetSnapshots(id)).toEqual(versions);
  useDocumentStore.getState().setField('subject', 'Pending edit');
  await userEvent.click(screen.getByRole('button', { name: 'History' }));
  expect(useDocumentsStore.getState().docs[id].session.formData.subject).toBe('Pending edit');
  expect(useDocumentStore.getState().formData.subject).toBe('Pending edit');
  expect(await idbGetSnapshots(id)).toEqual(versions); // autosave interval, not a forced checkpoint
});

it('rejects oversized backups before reading their contents in Settings', async () => {
  renderHeader();
  act(() => useUIStore.getState().setSettingsOpen(true, 'backup'));
  const file = new File(['{}'], 'large-backup.json', { type: 'application/json' });
  Object.defineProperty(file, 'size', { value: MAX_BACKUP_BYTES + 1 });
  const read = vi.spyOn(file, 'text');
  fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('100 MiB restore limit');
  expect(read).not.toHaveBeenCalled();
});

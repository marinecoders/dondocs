import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from '@/components/layout/Header';
import { AppAlertDialog } from '@/components/AppAlertDialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAlertStore } from '@/stores/alertStore';
import { useFormStore } from '@/stores/formStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { STORAGE_KEYS } from '@/lib/constants';
import { downloadWorkspaceBackup } from '@/lib/backupDownload';

vi.mock('@/lib/backupDownload', () => ({ downloadWorkspaceBackup: vi.fn() }));

beforeEach(() => {
  useAlertStore.setState({ open: false, current: null, queue: [] });
  useUIStore.setState({ saveMenuOpen: false, batchModalOpen: false });
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

  it('reports backup file read failures instead of failing silently', async () => {
    renderHeader();
    fireEvent.change(screen.getByLabelText('Restore workspace backup file'), { target: { files: [{ text: async () => { throw new Error('File unavailable'); } }] } });
    expect(await screen.findByRole('alertdialog', { name: 'Could not restore backup' })).toBeVisible();
    expect(useDocumentStore.getState().formData.subject).toBe('Keep my draft');
  });

  it('reports malformed saved data and blocked manual saving', async () => {
    localStorage.setItem(STORAGE_KEYS.DOCUMENT, '{broken');
    renderHeader();
    await chooseAction('Open saved checkpoint');
    expect(await screen.findByRole('alertdialog', { name: 'Could not open saved checkpoint' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    await chooseAction(/^Save checkpoint/);
    expect(await screen.findByRole('alertdialog', { name: 'Could not save checkpoint' })).toBeVisible();
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

describe('active form actions', () => {
  it.each(['navmc_10274', 'navmc_118_11'] as const)('clears and resets only %s, preserving saved drafts', async (formType) => {
    useDocumentStore.setState({ documentCategory: 'forms', formType });
    useFormStore.getState().setNavmc10274Field('natureOfAction', 'AA text');
    useFormStore.getState().setNavmc11811Field('remarksText', 'Remarks text');
    localStorage.setItem(STORAGE_KEYS.DOCUMENT, 'saved draft sentinel');
    render(<TooltipProvider><Header isFormsMode /></TooltipProvider>);
    await chooseAction('Clear form fields');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useFormStore.getState().navmc10274.natureOfAction).toBe('AA text');
    await chooseAction('Clear form fields');
    await userEvent.click(screen.getByRole('button', { name: 'Clear fields' }));
    const active = () => formType === 'navmc_10274' ? useFormStore.getState().navmc10274.natureOfAction : useFormStore.getState().navmc11811.remarksText;
    expect(active()).toBe('');
    await chooseAction('Reset all fields');
    await userEvent.click(screen.getByRole('button', { name: 'Reset everything' }));
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

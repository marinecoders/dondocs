import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorSidebar } from '@/components/layout/EditorSidebar';
import { MobileRecents } from '@/components/layout/MobileRecents';
import { Header } from '@/components/layout/Header';
import { HelpModal } from '@/components/modals/HelpModal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useTourStore } from '@/stores/tourStore';

beforeEach(() => {
  useUIStore.setState({ isMobile: false, sidebarCollapsed: false, sidebarOutlineVisible: false,
    mobileDocsOpen: true, profileManagerOpen: false, settingsOpen: false, settingsSection: 'appearance',
    trashOpen: false, helpOpen: false, checklistSheetOpen: false, saveMenuOpen: false });
  useDocumentsStore.setState({ currentId: null, docs: {}, hydrated: true });
  useOnboardingStore.setState({ checklistCelebrated: false });
  useTourStore.setState({ active: false });
});
const destinations = [
  ['Profiles', { profileManagerOpen: true }],
  ['Backup & restore', { settingsOpen: true, settingsSection: 'backup' }],
  ['Trash', { trashOpen: true }],
  ['Settings', { settingsOpen: true, settingsSection: 'appearance' }],
  ['Help', { helpOpen: true }],
] as const;

it.each(destinations.flatMap(([label, expected]) => [false, true].map((mobile) => ({ label, expected, mobile }))))('opens $label consistently on mobile=$mobile', async ({ label, expected, mobile }) => {
  useUIStore.setState({ isMobile: mobile });
  render(<TooltipProvider>{mobile ? <MobileRecents /> : <EditorSidebar />}</TooltipProvider>);
  const button = screen.getByRole('button', { name: label });
  expect(screen.getAllByRole('button', { name: label })).toHaveLength(1);
  expect(button.querySelector('svg')).not.toBeNull();
  await userEvent.click(button);
  expect(useUIStore.getState()).toMatchObject(expected);
  if (mobile) expect(useUIStore.getState().mobileDocsOpen).toBe(false);
});

it('keeps Tools focused on editing, with Batch and Preview still directly available', async () => {
  const refresh = vi.fn();
  render(<TooltipProvider><Header onRefreshPreview={refresh} /></TooltipProvider>);
  expect(screen.getByRole('button', { name: 'Batch' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Preview' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Document tools' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    expect.stringContaining('Undo'), expect.stringContaining('Redo'), expect.stringContaining('Find and replace'), 'Refresh preview', 'Document type guide',
  ]);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh preview' }));
  expect(refresh).toHaveBeenCalledOnce();
});

it.each(['Take optional tour', 'Getting started'])('keeps %s available in Help without stacking dialogs', async (label) => {
  useUIStore.setState({ helpOpen: true });
  render(<HelpModal />);
  await userEvent.click(screen.getByRole('button', { name: label }));
  expect(useUIStore.getState().helpOpen).toBe(false);
  if (label === 'Getting started') expect(useUIStore.getState().checklistSheetOpen).toBe(true);
  else expect(useTourStore.getState().active).toBe(true);
});

it('distinguishes individual draft files from the whole workspace backup', async () => {
  render(<TooltipProvider><Header /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Document actions' }));
  expect(screen.getByRole('menuitem', { name: 'Export draft (.json)' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Import draft (.json)' })).toBeVisible();
  expect(screen.getByText('Workspace backup')).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Back up everything' })).toBeVisible();
  expect(screen.getByText('Drafts autosave. A checkpoint keeps a manual copy until you save another.')).toBeVisible();
});


it('provides mobile document actions, renames without changing subject, and keeps Trash undo', async () => {
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Printed subject');
  useDocumentsStore.getState().saveCurrent();
  const id = useDocumentsStore.getState().currentId!;
  const title = useDocumentsStore.getState().docs[id].meta.title;
  useUIStore.setState({ isMobile: true, mobileDocsOpen: true });
  render(<MobileRecents />);
  await userEvent.click(screen.getByRole('button', { name: `Actions for ${title}` }));
  for (const name of ['Pin', 'Rename', 'Duplicate', 'Version history', 'Move to Trash']) {
    expect(screen.getByRole('menuitem', { name })).toBeVisible();
  }
  await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  const name = screen.getByRole('textbox', { name: 'Draft name' });
  expect(name).toHaveFocus();
  await userEvent.clear(name);
  await userEvent.type(name, 'Short draft name{Enter}');
  expect(useDocumentsStore.getState().docs[id].meta.title).toBe('Short draft name');
  expect(useDocumentStore.getState().formData.subject).toBe('Printed subject');
  await userEvent.click(screen.getByRole('button', { name: 'Actions for Short draft name' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Move to Trash' }));
  expect(useDocumentsStore.getState().docs[id]).toBeUndefined();
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(useDocumentsStore.getState().docs[id].meta.title).toBe('Short draft name');
});

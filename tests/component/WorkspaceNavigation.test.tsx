import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorSidebar } from '@/components/layout/EditorSidebar';
import { MobileRecents } from '@/components/layout/MobileRecents';
import { Header } from '@/components/layout/Header';
import { HelpModal } from '@/components/modals/HelpModal';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { ActivationChecklist } from '@/components/onboarding/ActivationChecklist';
import { TemplateLoaderModal } from '@/components/modals/TemplateLoaderModal';
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
    'Formatting…', expect.stringContaining('Undo'), expect.stringContaining('Redo'), expect.stringContaining('Find and replace'), 'Refresh preview', 'Document type guide',
  ]);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh preview' }));
  expect(refresh).toHaveBeenCalledOnce();
});

it.each(['Settings', 'Help'])('returns mobile %s focus to Open workspace after the launcher closes', async (label) => {
  const user = userEvent.setup();
  useUIStore.setState({ isMobile: true, mobileDocsOpen: false });
  render(<TooltipProvider><Header /><MobileRecents /><SettingsModal /><HelpModal /></TooltipProvider>);
  await user.click(screen.getByRole('button', { name: 'Open workspace' }));
  await user.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Documents' })).not.toBeInTheDocument());
  expect(await screen.findByRole('dialog', { name: label === 'Help' ? /Help/ : 'Settings' })).toBeVisible();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open workspace' })).toHaveFocus());
});

it.each(['Take optional tour', 'Getting started'])('keeps %s available in Help without stacking dialogs', async (label) => {
  useUIStore.setState({ helpOpen: true });
  render(<HelpModal />);
  await userEvent.click(screen.getByRole('button', { name: label }));
  expect(useUIStore.getState().helpOpen).toBe(false);
  if (label === 'Getting started') expect(useUIStore.getState().checklistSheetOpen).toBe(true);
  else expect(useTourStore.getState().active).toBe(true);
});

it.each([false, true])('returns checklist and template focus to the workspace launcher on mobile=%s', async (mobile) => {
  const user = userEvent.setup();
  useUIStore.setState({ isMobile: mobile, mobileDocsOpen: false, templateLoaderOpen: false });
  useOnboardingStore.setState({ completed: {}, checklistDismissed: true, checklistCelebrated: false });
  render(<TooltipProvider><Header />{mobile ? <MobileRecents /> : <EditorSidebar />}<HelpModal /><ActivationChecklist /><TemplateLoaderModal /></TooltipProvider>);
  const launcher = screen.getByRole('button', { name: mobile ? 'Open workspace' : 'Help' });
  const openChecklist = async () => {
    await user.click(launcher);
    if (mobile) await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('button', { name: 'Getting started' }));
    expect(await screen.findByRole('dialog', { name: /Getting started/ })).toBeVisible();
  };

  await openChecklist();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(launcher).toHaveFocus());

  await openChecklist();
  await user.click(screen.getByRole('button', { name: /Build your first document/ }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: /Load template/ })).toContainElement(document.activeElement as HTMLElement));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(launcher).toHaveFocus());
});

it('distinguishes individual draft files from the whole workspace backup', async () => {
  render(<TooltipProvider><Header /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Document actions' }));
  expect(screen.getByRole('menuitem', { name: 'Export draft (.json)' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Import draft (.json)' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: 'Download workspace backup' })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Backup & restore…' })).not.toBeInTheDocument();
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
  await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Draft name' }), ' canceled{Escape}');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for Short draft name' })).toHaveFocus());
  expect(useUIStore.getState().mobileDocsOpen).toBe(true);
  expect(useDocumentsStore.getState().docs[id].meta.title).toBe('Short draft name');
  await userEvent.click(screen.getByRole('button', { name: 'Actions for Short draft name' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Move to Trash' }));
  expect(useDocumentsStore.getState().docs[id]).toBeUndefined();
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(useDocumentsStore.getState().docs[id].meta.title).toBe('Short draft name');
});

it('opens document formatting from Tools without duplicating the type picker', async () => {
  render(<TooltipProvider><Header /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Document tools' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Formatting…' }));
  expect(screen.getByRole('dialog', { name: 'Document formatting' })).toBeVisible();
  await userEvent.click(screen.getByRole('tab', { name: 'Custom' }));
  expect(screen.getByRole('combobox', { name: 'Font family' })).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Document Type' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog', { name: 'Document formatting' })).not.toBeInTheDocument();
});

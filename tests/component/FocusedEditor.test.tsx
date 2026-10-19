import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from '@/components/layout/Header';
import { EditorSidebar } from '@/components/layout/EditorSidebar';
import { FormPanel } from '@/components/layout/FormPanel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useUIStore } from '@/stores/uiStore';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useDocumentsStore.setState({ currentId: 'draft-one', docs: {} });
  useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'naval_letter', paragraphs: [{ text: 'Keep this paragraph.', level: 0 }] });
  useUIStore.setState({ documentPositions: {}, editorLayout: 'focused', isMobile: false, sidebarOutlineVisible: false, sidebarCollapsed: false });
  useEditorOutlineStore.setState({ pendingJump: null, activeId: null });
});

const openEditor = () => render(<TooltipProvider><Header isFormsMode={useDocumentStore.getState().documentCategory === 'forms'} /><FormPanel /></TooltipProvider>);
const chooseLayout = async (name: RegExp) => {
  await userEvent.click(screen.getByRole('button', { name: 'Editor view' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name }));
};
const selectSection = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Document section' }), { target: { value } });

it('uses page scrolling on short compact screens and restores the editor scroller without losing edits', async () => {
  const media = window.matchMedia('(max-height: 500px)');
  Object.defineProperty(media, 'matches', { value: true });
  const match = vi.spyOn(window, 'matchMedia').mockReturnValue(media);
  useUIStore.setState({ isMobile: true });
  const view = render(<TooltipProvider><div className="workspace-shell"><FormPanel /></div></TooltipProvider>);
  try {
    const shell = view.container.querySelector<HTMLElement>('.workspace-shell')!;
    const viewport = view.container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    const subject = screen.getByRole('textbox', { name: 'Subject' });
    fireEvent.change(subject, { target: { value: 'Retain this through rotation' } });
    shell.scrollTop = 180;
    fireEvent.scroll(shell);
    expect(useUIStore.getState().documentPositions['draft-one'].top).toBe(180);
    selectSection('signature');
    await waitFor(() => expect(document.getElementById('sec-signature')).toHaveFocus());
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    shell.scrollTop = 200;
    act(() => useUIStore.setState({ isMobile: false }));
    expect(shell.scrollTop).toBe(0);
    viewport.scrollTop = 45;
    fireEvent.scroll(viewport);
    expect(useUIStore.getState().documentPositions['draft-one'].top).toBe(45);
    selectSection('body');
    expect(screen.getByRole('textbox', { name: 'Subject' })).toBe(subject);
    expect(subject).toHaveValue('Retain this through rotation');
  } finally {
    view.unmount();
    match.mockRestore();
  }
});

describe('focused workspace editor', () => {
  it('preserves edits and mounted fields while Contents changes the visible section', async () => {
    openEditor();
    const subject = screen.getByRole('textbox', { name: 'Subject' });
    fireEvent.change(subject, { target: { value: 'APPOINTMENT' } });
    selectSection('signature');
    expect(subject).not.toBeVisible();
    expect(subject).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById('sec-signature')).toHaveFocus());
    expect(screen.getByLabelText('First Name')).toBeVisible();
    selectSection('body');
    expect(screen.getByRole('textbox', { name: 'Subject' })).toBe(subject);
    expect(subject).toHaveValue('APPOINTMENT');
    expect(screen.getByRole('textbox', { name: 'Paragraph 1' })).toHaveTextContent('Keep this paragraph.');
  });

  it('remembers each document’s section and opens a hidden section from a search result', async () => {
    openEditor();
    selectSection('signature');
    act(() => useDocumentsStore.setState({ currentId: 'draft-two' }));
    expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('body');
    selectSection('references');
    act(() => useDocumentsStore.setState({ currentId: 'draft-one' }));
    expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('signature');
    act(() => useEditorOutlineStore.getState().requestJump('draft-one', 'addressing'));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('addressing'));
    expect(document.getElementById('sec-addressing')).toBeVisible();
    await waitFor(() => expect(document.getElementById('sec-addressing')).toHaveFocus());
  });

  it.each(['navmc_10274', 'navmc_118_11'] as const)('keeps all %s sections reachable without showing the entire form at once', (formType) => {
    useDocumentStore.setState({ documentCategory: 'forms', formType });
    openEditor();
    expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('content');
    expect(document.getElementById('sec-content')).toBeVisible();
    expect(document.getElementById('sec-signatures')).not.toBeVisible();
    selectSection('signatures');
    expect(document.getElementById('sec-signatures')).toBeVisible();
    expect(document.getElementById('sec-content')).not.toBeVisible();
    const setup = formType === 'navmc_10274' ? 'header' : 'marine';
    selectSection(setup);
    expect(document.getElementById(`sec-${setup}`)).toBeVisible();
    expect(document.getElementById('sec-signatures')).not.toBeVisible();
  });
});

it('switches between scroll and focused layouts without remounting or losing field edits', async () => {
  openEditor();
  const subject = screen.getByRole('textbox', { name: 'Subject' });
  fireEvent.change(subject, { target: { value: 'Keep this across layouts' } });
  await chooseLayout(/Full document/);
  expect(useUIStore.getState().editorLayout).toBe('scroll');
  expect(document.getElementById('sec-addressing')).toBeVisible();
  expect(document.getElementById('sec-body')).toBeVisible();
  expect(document.getElementById('sec-signature')).toBeVisible();
  expect(document.getElementById('body-subject')).toBe(subject);
  expect(subject).toHaveValue('Keep this across layouts');
  await userEvent.click(screen.getByRole('button', { name: 'Contents' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Signature' }));
  await waitFor(() => expect(document.getElementById('sec-signature')).toHaveFocus());
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  await chooseLayout(/One section/);
  expect(document.getElementById('sec-signature')).toBeVisible();
  expect(subject).not.toBeVisible();
  selectSection('body');
  expect(screen.getByRole('textbox', { name: 'Subject' })).toBe(subject);
  expect(subject).toHaveValue('Keep this across layouts');
});

it.each(['navmc_10274', 'navmc_118_11'] as const)('keeps %s reset available in both layouts through document actions', async (formType) => {
  useDocumentStore.setState({ documentCategory: 'forms', formType });
  openEditor();
  await chooseLayout(/Full document/);
  expect(document.getElementById('sec-content')).toBeVisible();
  expect(document.getElementById('sec-signatures')).toBeVisible();
  expect(document.getElementById('sec-type')).not.toBeInTheDocument();
  for (const layout of [/Full document/, /One section/]) {
    await chooseLayout(layout);
    await userEvent.click(screen.getByRole('button', { name: 'Document actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reset form to sample values…' }));
    expect(screen.getByRole('alertdialog', { name: 'Reset form to sample values?' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  }
});

it('persists the layout choice across rehydration without changing document data', async () => {
  openEditor();
  const before = useDocumentStore.getState().formData;
  await chooseLayout(/Full document/);
  expect(JSON.parse(localStorage.getItem('dondocs_ui')!).state.editorLayout).toBe('scroll');
  await act(() => useUIStore.persist.rehydrate());
  expect(useUIStore.getState().editorLayout).toBe('scroll');
  expect(useDocumentStore.getState().formData).toBe(before);
});


it.each(['navmc_10274', 'navmc_118_11'] as const)('resumes a deliberately selected setup section for %s', (formType) => {
  useDocumentStore.setState({ documentCategory: 'forms', formType });
  const view = openEditor();
  const setup = formType === 'navmc_10274' ? 'header' : 'marine';
  selectSection(setup);
  view.unmount();
  openEditor();
  expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue(setup);
  expect(document.getElementById(`sec-${setup}`)).toBeVisible();
  render(<TooltipProvider><EditorSidebar /></TooltipProvider>);
  expect(screen.getByRole('button', { name: 'Templates' })).toBeVisible();
});


it('uses sidebar contents when visible and restores focused navigation when collapsed or mobile', () => {
  useUIStore.setState({ sidebarOutlineVisible: true });
  openEditor();
  expect(screen.queryByRole('combobox', { name: 'Document section' })).not.toBeInTheDocument();
  act(() => useUIStore.setState({ sidebarCollapsed: true }));
  expect(screen.getByRole('combobox', { name: 'Document section' })).toBeVisible();
  selectSection('signature');
  expect(document.getElementById('sec-signature')).toBeVisible();
  act(() => useUIStore.setState({ sidebarCollapsed: false, isMobile: true }));
  expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('signature');
});

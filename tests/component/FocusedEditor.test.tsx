import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useUIStore.setState({ documentPositions: {}, editorLayout: 'focused', isMobile: false });
  useEditorOutlineStore.setState({ pendingJump: null, activeId: null });
});

const openEditor = () => render(<TooltipProvider><FormPanel /></TooltipProvider>);
const selectSection = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Document section' }), { target: { value } });

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
    selectSection('type');
    expect(document.getElementById('sec-type')).toBeVisible();
    expect(document.getElementById('sec-signatures')).not.toBeVisible();
  });
});

it('switches between scroll and focused layouts without remounting or losing field edits', async () => {
  openEditor();
  const subject = screen.getByRole('textbox', { name: 'Subject' });
  fireEvent.change(subject, { target: { value: 'Keep this across layouts' } });
  fireEvent.click(screen.getByRole('button', { name: 'Scroll mode' }));
  expect(screen.getByRole('button', { name: 'Scroll mode' })).toHaveAttribute('aria-pressed', 'true');
  expect(document.getElementById('sec-addressing')).toBeVisible();
  expect(document.getElementById('sec-body')).toBeVisible();
  expect(document.getElementById('sec-signature')).toBeVisible();
  expect(document.getElementById('body-subject')).toBe(subject);
  expect(subject).toHaveValue('Keep this across layouts');
  selectSection('signature');
  await waitFor(() => expect(document.getElementById('sec-signature')).toHaveFocus());
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Focused mode' }));
  expect(document.getElementById('sec-signature')).toBeVisible();
  expect(subject).not.toBeVisible();
  selectSection('body');
  expect(screen.getByRole('textbox', { name: 'Subject' })).toBe(subject);
  expect(subject).toHaveValue('Keep this across layouts');
});

it.each(['navmc_10274', 'navmc_118_11'] as const)('shows %s setup/reset controls with all fields in scroll mode', (formType) => {
  useDocumentStore.setState({ documentCategory: 'forms', formType });
  openEditor();
  fireEvent.click(screen.getByRole('button', { name: 'Scroll mode' }));
  expect(screen.getByRole('button', { name: 'Reset' })).toBeVisible();
  expect(document.getElementById('sec-type')).toBeVisible();
  expect(document.getElementById('sec-content')).toBeVisible();
  expect(document.getElementById('sec-signatures')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Focused mode' }));
  expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
});

it('persists the layout choice across rehydration without changing document data', async () => {
  openEditor();
  const before = useDocumentStore.getState().formData;
  fireEvent.click(screen.getByRole('button', { name: 'Scroll mode' }));
  expect(JSON.parse(localStorage.getItem('dondocs_ui')!).state.editorLayout).toBe('scroll');
  await act(() => useUIStore.persist.rehydrate());
  expect(useUIStore.getState().editorLayout).toBe('scroll');
  expect(useDocumentStore.getState().formData).toBe(before);
});


it.each(['navmc_10274', 'navmc_118_11'] as const)('resumes a deliberately selected setup section for %s', (formType) => {
  useDocumentStore.setState({ documentCategory: 'forms', formType });
  const view = openEditor();
  selectSection('type');
  view.unmount();
  openEditor();
  expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('type');
  expect(screen.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Templates', exact: true })).toBeVisible();
});

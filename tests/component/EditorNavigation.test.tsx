import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormPanel } from '@/components/layout/FormPanel';
import { DocumentNavigation } from '@/components/layout/DocumentNavigation';
import { DocumentTypeSelector } from '@/components/editor/DocumentTypeSelector';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useUIStore } from '@/stores/uiStore';
import { useFormStore } from '@/stores/formStore';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { getEditorSections } from '@/lib/editorSections';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useDocumentsStore.setState({ currentId: 'navigation-draft', docs: {}, hydrated: true });
  useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'naval_letter', documentMode: 'compliant', paragraphs: [{ text: 'Keep this paragraph.', level: 0 }] });
  useUIStore.setState({ documentPositions: {}, editorLayout: 'scroll', isMobile: false, sidebarOutlineVisible: false, sidebarCollapsed: false });
  useEditorOutlineStore.setState({ pendingJump: null, activeId: null });
});
const editor = () => render(<TooltipProvider><DocumentNavigation /><FormPanel /></TooltipProvider>);

it.each([
  ['naval_letter', 'subject', 'subject'],
  ['mfr', 'subject', 'subject'],
  ['moa', 'moaSubject', 'moaSubject'],
  ['mou', 'moaSubject', 'moaSubject'],
  ['joint_letter', 'jointSubject', 'jointSubject'],
  ['joint_memorandum', 'subject', 'subject'],
  ['standard_memorandum', 'exec-subject', 'subject'],
  ['action_memorandum', 'exec-subject', 'subject'],
  ['information_memorandum', 'exec-subject', 'subject'],
  ['i_type', 'nomenclature', 'nomenclature'],
] as const)('routes %s field edits through the shared setter and preserves unrelated content', (docType, inputId, field) => {
  const originalSetter = useDocumentStore.getState().setField;
  const originalFields = useDocumentStore.getState().formData;
  const setField = vi.fn(originalSetter);
  useDocumentStore.setState({ docType, setField });
  try {
    render(<TooltipProvider><FormPanel /></TooltipProvider>);
    const input = document.getElementById(inputId)!;
    expect(input).toBeVisible();
    fireEvent.change(input, { target: { value: 'SHARED FIELD CHECK' } });
    expect(setField).toHaveBeenCalledWith(field, 'SHARED FIELD CHECK');
    expect(useDocumentStore.getState().formData[field]).toBe('SHARED FIELD CHECK');
    expect(useDocumentStore.getState().paragraphs).toEqual([{ text: 'Keep this paragraph.', level: 0 }]);
  } finally {
    // Zustand copies action references into each new state; restore the current
    // state explicitly rather than restoring a spy on an obsolete state object.
    useDocumentStore.setState({ setField: originalSetter, formData: originalFields });
  }
});

it.each(Object.entries(DOC_TYPE_CONFIG))('renders every %s section in the shared correspondence surface', (docType, config) => {
  useDocumentStore.setState({ docType });
  const { container } = render(<TooltipProvider><FormPanel /></TooltipProvider>);
  for (const section of getEditorSections(config, docType)) {
    const mounted = container.querySelector(`#sec-${section.id}`);
    expect(mounted).toBeVisible();
    expect(mounted?.childElementCount).toBeGreaterThan(0);
    if (section.id === 'body') expect(mounted).not.toHaveAttribute('data-field-surface');
    else expect(mounted).toHaveAttribute('data-field-surface', 'true');
  }
  if (docType === 'sl3') expect(screen.getByRole('textbox', { name: 'Short title' })).toBeVisible();
  else expect(screen.getByRole('textbox', { name: 'Paragraph 1' })).toHaveTextContent('Keep this paragraph.');
});

it('shows one type selector and optional section jumping in Full document', async () => {
  editor();
  expect(screen.getAllByRole('button', { name: 'Correspondence type' })).toHaveLength(1);
  expect(screen.queryByRole('combobox', { name: 'Document section' })).not.toBeInTheDocument();
  expect(document.getElementById('sec-type')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Contents' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Signature' }));
  await waitFor(() => expect(document.getElementById('sec-signature')).toHaveFocus());
  expect(document.getElementById('sec-body')).toBeVisible();
  expect(document.getElementById('sec-signature')).toBeVisible();
});

it('switches views without remounting content or losing edits and keeps the selected section', async () => {
  editor();
  const subject = document.getElementById('body-subject')!;
  expect(subject).not.toBeVisible();
  fireEvent.change(document.getElementById('subject')!, { target: { value: 'PRESERVE EDITS' } });
  await userEvent.click(screen.getByRole('button', { name: 'Contents' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Paragraphs' }));
  await waitFor(() => expect(document.getElementById('sec-body')).toHaveFocus());
  await userEvent.click(screen.getByRole('button', { name: 'Editor view' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: /One section/ }));
  expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('body');
  expect(screen.queryByRole('button', { name: 'Contents' })).not.toBeInTheDocument();
  expect(document.getElementById('sec-signature')).not.toBeVisible();
  expect(document.getElementById('body-subject')).toBe(subject);
  expect(subject).toHaveValue('PRESERVE EDITS');
  expect(subject).toBeVisible();
  act(() => useUIStore.getState().setEditorLayout('scroll'));
  expect(document.getElementById('body-subject')).toBe(subject);
  expect(document.getElementById('sec-signature')).toBeVisible();
  expect(subject).not.toBeVisible();
  expect(document.getElementById('subject')).toHaveValue('PRESERVE EDITS');
});

it.each(['navmc_10274', 'navmc_118_11'] as const)('keeps %s fields and category switching without a duplicate setup section', (formType) => {
  useDocumentStore.setState({ documentCategory: 'forms', formType });
  editor();
  expect(screen.getAllByRole('button', { name: 'Form type' })).toHaveLength(1);
  expect(screen.queryByRole('combobox', { name: 'Form Type' })).not.toBeInTheDocument();
  expect(document.getElementById('sec-type')).not.toBeInTheDocument();
  expect(document.getElementById('sec-content')).toBeVisible();
  expect(document.getElementById('sec-signatures')).toBeVisible();
  if (formType === 'navmc_10274') {
    const cover = screen.getByRole('checkbox', { name: 'Include Privacy Act cover page' });
    const prior = useFormStore.getState().includeCoverPage;
    fireEvent.click(cover);
    expect(useFormStore.getState().includeCoverPage).toBe(!prior);
  }
});

it('retains formatting choices without a type selector in the formatting panel', async () => {
  render(<DocumentTypeSelector />);
  expect(screen.queryByRole('combobox', { name: 'Document Type' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Custom' }));
  expect(useDocumentStore.getState().documentMode).toBe('custom');
  expect(screen.getByText('Font Family')).toBeVisible();
  await userEvent.click(screen.getByRole('tab', { name: 'Compliant' }));
  expect(useDocumentStore.getState().documentMode).toBe('compliant');
});


it.each(['naval_letter', 'same_page_endorsement', 'new_page_endorsement', 'mfr', 'joint_memorandum', 'executive_memorandum', 'standard_memorandum', 'action_memorandum', 'information_memorandum'])('keeps the authoritative Subject and its validation in Full document for %s', (docType) => {
  useDocumentStore.setState({ docType, formData: { ...useDocumentStore.getState().formData, subject: '' } });
  useUIStore.setState({ validationVisible: true });
  editor();
  expect(document.getElementById('body-subject')).not.toBeVisible();
  const visibleSubject = screen.getAllByRole('textbox', { name: /Subject/i });
  expect(visibleSubject).toHaveLength(1);
  expect(visibleSubject[0]).toHaveAttribute('aria-invalid', 'true');
  if (docType === 'same_page_endorsement') expect(screen.getByRole('checkbox', { name: 'Include the subject line' })).toBeVisible();
});

it.each(['moa', 'joint_letter'])('preserves distinct heading subjects for %s', (docType) => {
  useDocumentStore.setState({ docType, formData: { ...useDocumentStore.getState().formData, subject: 'BODY', moaSubject: 'AGREEMENT', jointSubject: 'JOINT' } });
  editor();
  expect(document.getElementById('body-subject')).toBeVisible();
  expect(document.getElementById(docType === 'moa' ? 'moaSubject' : 'jointSubject')).toHaveValue(docType === 'moa' ? 'AGREEMENT' : 'JOINT');
});

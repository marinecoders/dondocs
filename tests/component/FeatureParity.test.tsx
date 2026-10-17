import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentNavigation } from '@/components/layout/DocumentNavigation';
import { EditorSidebar } from '@/components/layout/EditorSidebar';
import { FormPanel } from '@/components/layout/FormPanel';
import { DocumentGuideModal } from '@/components/modals/DocumentGuideModal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useTourStore } from '@/stores/tourStore';
import { TOUR_STEPS } from '@/components/tour/tourSteps';
import { useUIStore } from '@/stores/uiStore';
import { EXAMPLE_DOCUMENTS } from '@/data/exampleDocuments';
import { DOC_TYPE_LABELS } from '@/types/document';

// Inventory checked against the pre-redesign editor at 7993269f. Deliberately
// independent of getEditorSections: removing a production route must fail here.
const standard = 'addressing classification body references enclosures copyto distribution signature';
const routes: Record<string, string> = {
  naval_letter: `letterhead ${standard}`,
  standard_letter: standard,
  business_letter: `letterhead ${standard}`,
  multiple_address_letter: `letterhead ${standard}`,
  joint_letter: 'joint classification body references enclosures copyto distribution',
  same_page_endorsement: `basic ${standard}`,
  new_page_endorsement: `letterhead basic ${standard}`,
  mfr: 'addressing classification body references enclosures signature',
  mf: `letterhead ${standard}`,
  plain_paper_memorandum: standard,
  letterhead_memorandum: `letterhead ${standard}`,
  decision_memorandum: standard,
  executive_memorandum: standard,
  moa: 'moa classification body references enclosures copyto',
  mou: 'moa classification body references enclosures copyto',
  joint_memorandum: 'joint_memo classification body references enclosures copyto distribution',
  executive_correspondence: `letterhead ${standard}`,
  standard_memorandum: 'executive classification body copyto distribution signature',
  action_memorandum: 'executive classification body copyto distribution signature',
  information_memorandum: 'executive classification body copyto distribution',
  i_type: 'cover classification body tables enclosures signature',
  navmc_10274: 'header addressing content signatures references',
  navmc_118_11: 'marine content signatures',
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useDocumentsStore.setState({ currentId: 'parity-draft', docs: {}, baseline: null, hydrated: true });
  useDocumentStore.getState().resetForm();
  useUIStore.setState({ documentPositions: {}, editorLayout: 'focused', isMobile: false, documentGuideOpen: false, sidebarOutlineVisible: false, sidebarCollapsed: true });
  useEditorOutlineStore.setState({ pendingJump: null, activeId: null });
});

it('accounts for the complete correspondence registry and both forms', () => {
  expect(Object.keys(routes).sort()).toEqual([...Object.keys(DOC_TYPE_LABELS), 'navmc_10274', 'navmc_118_11'].sort());
});

it.each(Object.entries(routes).flatMap(([type, sections]) => (['focused', 'scroll'] as const).map((layout) => ({ type, sections, layout }))))('makes every original $type section usable in $layout mode', async ({ type, sections: sectionIds, layout }) => {
  useUIStore.getState().setEditorLayout(layout);
  if (type === 'navmc_10274' || type === 'navmc_118_11') {
    useDocumentStore.setState({ documentCategory: 'forms', formType: type });
  } else useDocumentStore.setState({ documentCategory: 'correspondence', docType: type });
  if (type === 'i_type') useDocumentStore.setState({ paragraphs: [{ text: '', level: 0, header: 'Materiel Required', tableKey: 'materielRequired' }] });
  const { container } = render(<TooltipProvider><FormPanel /></TooltipProvider>);
  const expected = sectionIds.split(' ');
  const picker = screen.queryByRole('combobox', { name: 'Document section' });
  if (layout === 'focused') expect(within(picker!).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(expected);
  else expect(picker).not.toBeInTheDocument();
  for (const id of expected) {
    if (layout === 'focused') fireEvent.change(picker!, { target: { value: id } });
    else {
      await userEvent.click(screen.getByRole('button', { name: 'Contents' }));
      const entries = screen.getAllByRole('menuitem');
      expect(entries).toHaveLength(expected.length);
      await userEvent.click(entries[expected.indexOf(id)]);
    }
    const section = container.querySelector<HTMLElement>(`#sec-${id}`)!;
    expect(section, `${type}/${id}`).toBeVisible();
    expect(section.textContent?.trim().length).toBeGreaterThan(0);
    expect(section.querySelector('input,select,textarea,button,[contenteditable="true"]'), `${type}/${id} has controls`).not.toBeNull();
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(section).toHaveFocus();
    for (const other of expected.filter((candidate) => candidate !== id)) {
      if (layout === 'focused') expect(container.querySelector(`#sec-${other}`)).not.toBeVisible();
      else expect(container.querySelector(`#sec-${other}`)).toBeVisible();
    }
  }
});

it.each(['correspondence', 'navmc_10274', 'navmc_118_11'] as const)('opens guide examples separately from %s without carrying old content', (kind) => {
  const registry = useDocumentsStore.getState();
  registry.newDocument(kind === 'correspondence' ? undefined : kind);
  const originalId = useDocumentsStore.getState().currentId!;
  useDocumentStore.getState().setField('subject', 'Keep original letter');
  useDocumentStore.getState().addDistribution('Private distribution');
  useFormStore.getState().setNavmc10274Field('natureOfAction', 'Keep AA form');
  useFormStore.getState().setNavmc11811Field('remarksText', 'Keep remarks');
  registry.saveCurrent();
  const before = structuredClone(useDocumentsStore.getState().docs[originalId].session);
  useUIStore.setState({ documentGuideOpen: true, documentGuideTab: 'examples' });
  render(<TooltipProvider><DocumentGuideModal /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /Naval Letter Request for additional personnel billets/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Load This Example' }));
  expect(useDocumentsStore.getState().currentId).not.toBe(originalId);
  expect(useDocumentsStore.getState().docs[originalId].session).toMatchObject({ ...before, timestamp: expect.any(Number) });
  const example = EXAMPLE_DOCUMENTS[0];
  expect(useDocumentStore.getState().documentCategory).toBe('correspondence');
  expect(useDocumentStore.getState().formData.subject).toBe(example.formData.subject);
  expect(useDocumentStore.getState().paragraphs).toEqual(example.paragraphs);
  expect(useDocumentStore.getState().references).toEqual(example.references);
  expect(useDocumentStore.getState().distributions).toEqual([]);
  expect(useUIStore.getState().documentGuideOpen).toBe(false);
});

it.each(['enclosures', 'signature', 'classification'])('reveals the hidden %s section for an optional walkthrough', async (section) => {
  useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'naval_letter' });
  useUIStore.setState({ documentGuideOpen: true, documentGuideTab: 'features' });
  render(<TooltipProvider><FormPanel /><DocumentGuideModal /></TooltipProvider>);
  const feature = section === 'enclosures' ? /^Enclosures/ : section === 'signature' ? /^Signature Signature/ : /^Classification & portion marks/;
  fireEvent.click(screen.getByRole('button', { name: feature }));
  fireEvent.click(screen.getByRole('button', { name: 'Walk me through it' }));
  await waitFor(() => expect(useTourStore.getState().completionKey).toBe(section));
  act(() => useTourStore.getState().steps[0].action?.());
  expect(document.getElementById(`sec-${section}`)).toBeVisible();
  expect(document.getElementById('sec-body')).not.toBeVisible();
  act(() => useTourStore.getState().end());
});

it('does not offer a letter-only enclosure walkthrough while a form is open', () => {
  useDocumentStore.setState({ documentCategory: 'forms', formType: 'navmc_10274' });
  useUIStore.setState({ documentGuideOpen: true, documentGuideTab: 'features' });
  render(<TooltipProvider><DocumentGuideModal /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  expect(screen.getByRole('button', { name: /This walkthrough needs/ })).toBeDisabled();
  expect(useDocumentStore.getState().documentCategory).toBe('forms');
});

it.each(['correspondence', 'forms'] as const)('reveals type and template targets in %s during the intro tour', (documentCategory) => {
  useDocumentStore.setState({ documentCategory, docType: 'naval_letter', formType: 'navmc_10274' });
  render(<TooltipProvider><DocumentNavigation /><EditorSidebar /><FormPanel /></TooltipProvider>);
  for (const target of ['doctype', 'templates']) {
    act(() => TOUR_STEPS.find((step) => step.target === `[data-tour="${target}"]`)!.action?.());
    expect(document.querySelector(`[data-tour="${target}"]`)).toBeVisible();
  }
});

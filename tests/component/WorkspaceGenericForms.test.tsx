import 'fake-indexeddb/auto';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { FormPanel } from '@/components/layout/FormPanel';
import { Header } from '@/components/layout/Header';
import { DocumentGuideModal } from '@/components/modals/DocumentGuideModal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore, getSerializedSession, getSerializedSessionForShare } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { useDocumentsStore, flushDocumentWrites } from '@/stores/documentsStore';
import { importForm } from '@/services/forms/documents';
import { buildDraftFile, parseDraftFile } from '@/lib/draftFile';
import { parseSharedSession } from '@/lib/sharedSession';
import { sessionSearchFields } from '@/lib/workspaceSearch';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ templates: [] }) }));
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
  useUIStore.setState({ editorLayout: 'focused', documentPositions: {}, saveMenuOpen: false });
  importForm(fixtureInstance());
});
afterEach(() => vi.unstubAllGlobals());

it('explains why the batch walkthrough is unavailable for a packaged form', async () => {
  useUIStore.setState({ documentGuideOpen: true, documentGuideTab: 'features' });
  render(<TooltipProvider><DocumentGuideModal /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: /Batch generation.*Toolbar/ }));
  expect(screen.getByRole('button', { name: 'Batch generation supports correspondence and the two built-in NAVMC forms' })).toBeDisabled();
});

it('edits a pinned form in both workspace views without exposing a second type picker', async () => {
  render(<TooltipProvider><FormPanel /></TooltipProvider>);
  expect(screen.getByLabelText('Name')).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Decision' })).not.toBeInTheDocument();
  // Hidden sections remain mounted but are absent from the accessibility tree.
  fireEvent.change(screen.getByRole('combobox', { name: 'Document section' }), { target: { value: 'decision' } });
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Decision' })).toBeVisible());
  fireEvent.change(screen.getByRole('combobox', { name: 'Decision' }), { target: { value: 'no' } });
  expect(useDocumentStore.getState().genericForm?.answers.decision).toBe('no');
  act(() => useUIStore.getState().setEditorLayout('scroll'));
  expect(screen.getByRole('textbox', { name: 'Name' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Decision' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Form type' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add row (0/3)' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Grade, row 1' }), { target: { value: 'e2' } });
  await flushDocumentWrites();
  const id = useDocumentsStore.getState().currentId!;
  act(() => useDocumentsStore.getState().newDocument('navmc_10274'));
  act(() => useDocumentsStore.getState().switchTo(id));
  expect(useDocumentStore.getState().genericForm?.rows.roster[0].answers.grade).toBe('e2');
});

it('round-trips generic shares and drafts, including compact main-branch exports', async () => {
  const original = getSerializedSession().genericForm!;
  const page = await fixturePage();original.definition.pages[0].sha256 = page.sha256;
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(page.bytes))));
  useDocumentStore.setState({ genericForm: original });
  expect(parseSharedSession(getSerializedSessionForShare()).genericForm).toEqual(original);
  expect(parseDraftFile(await buildDraftFile()).session.genericForm).toEqual(original);
  expect(parseDraftFile({ version: '2.0', genericForm: original }).session.genericForm).toEqual(original);
  const bad = structuredClone(getSerializedSessionForShare());
  bad.formType = 'other-form';
  expect(() => parseSharedSession(bad)).toThrow(/does not match/);
  expect(sessionSearchFields(getSerializedSession())).toContainEqual({ text: 'Name: 000123', sectionId: 'identity', label: 'Identity' });
  expect(sessionSearchFields(getSerializedSession())).toContainEqual({ text: 'Decision: Yes', sectionId: 'decision', label: 'Checks' });
});

it('clears the generic form through document actions without touching a built-in draft', async () => {
  useFormStore.getState().setNavmc10274Field('natureOfAction', 'Preserve this action');
  render(<TooltipProvider><Header isFormsMode /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Document actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Reset form to sample values…' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Clear form fields…' }));
  await userEvent.click(screen.getByRole('button', { name: 'Clear form fields' }));
  expect(useDocumentStore.getState().genericForm?.answers).toEqual({});
  expect(useFormStore.getState().navmc10274.natureOfAction).toBe('Preserve this action');
  await userEvent.click(screen.getByRole('button', { name: 'Document tools' }));
  await userEvent.click(screen.getByRole('menuitem', { name: /^Undo/ }));
  expect(useDocumentStore.getState().genericForm?.answers.name).toBe('000123');
});

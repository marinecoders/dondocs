import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import { GenericFormSection } from '@/components/editor/GenericFormSection';
import { useDocumentStore, loadSharedSession, getSerializedSessionForShare } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useUIStore } from '@/stores/uiStore';
import { showAppConfirm } from '@/stores/alertStore';
import { editForm, importForm, startForm } from '@/services/forms/documents';
import { fixtureDefinition, fixtureInstance } from '../_helpers/formFixture';

vi.mock('@/services/forms/packages', () => ({ loadDefinition: vi.fn(), loadPackagePage: vi.fn(), packageAvailableOffline: async () => false, removeUnusedPackages: vi.fn() }));
vi.mock('@/stores/alertStore', () => ({ showAppConfirm: vi.fn(async () => true), showAppAlert: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ validationVisible: false });
  useDocumentsStore.setState({ docs: {}, currentId: null, baseline: null, hydrated: true });
  useDocumentStore.setState({ documentCategory: 'forms', formType: 'fixture', genericForm: fixtureInstance() });
  useHistoryStore.getState().clearHistory();
});

it('links required field errors to controls after an export attempt', () => {
  useDocumentStore.setState({ genericForm: { ...fixtureInstance(), answers: {} } });
  render(<GenericFormSection formType="fixture" />);
  expect(screen.queryByText('Name is required')).toBeNull();
  act(() => useUIStore.setState({ validationVisible: true }));
  const name = screen.getByRole('textbox', { name: 'Name' });
  expect(name).toHaveAttribute('aria-required', 'true');
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(name).toHaveAccessibleDescription('Name is required');
  fireEvent.change(name, { target: { value: '000123' } });
  expect(name).not.toHaveAttribute('aria-invalid', 'true');
});

it('shows invalid imported keys that match inherited object properties', () => {
  const instance = fixtureInstance();
  instance.answers = { ...instance.answers, constructor: 'saved input' };
  instance.rows = { constructor: [], roster: [{ id: 'row', answers: { grade: 'e1', toString: 'saved input' } }] };
  useDocumentStore.setState({ genericForm: instance });
  render(<GenericFormSection formType="fixture" />);
  expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([
    'Saved answer: Unknown field', 'Saved answer: Unknown row group', 'Roster, row 1: Unknown field',
  ]);
});

it('allows correcting one row of a draft with duplicate row IDs without losing another row', () => {
  const instance = fixtureInstance();
  instance.rows.roster = [{ id: 'duplicate', answers: { grade: 'e1' } }, { id: 'duplicate', answers: { grade: 'e2' } }];
  useDocumentStore.setState({ genericForm: instance });
  render(<GenericFormSection formType="fixture" />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Grade, row 2' }), { target: { value: 'e1' } });
  expect(useDocumentStore.getState().genericForm!.rows.roster.map(row => row.answers.grade)).toEqual(['e1', 'e1']);
  fireEvent.click(screen.getByRole('button', { name: 'Remove row 2' }));
  expect(useDocumentStore.getState().genericForm!.rows.roster).toEqual([{ id: 'duplicate', answers: { grade: 'e1' } }]);
});

it('does not clear another document when a confirmation finishes late', async () => {
  let confirm!: (value: boolean) => void;
  vi.mocked(showAppConfirm).mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
  render(<GenericFormSection formType="fixture" />);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  act(() => importForm({ ...fixtureInstance(), answers: { name: 'OTHER' } }));
  await act(async () => confirm(true));
  expect(useDocumentStore.getState().genericForm!.answers.name).toBe('OTHER');
});

it('rejects a revision update if the form was edited while its file was loading', async () => {
  let finish!: (value: string) => void;
  const next = fixtureDefinition(); next.definitionRevision = 'v2';
  const update = { definition: next, migration: { from: 'v1', to: 'v2', fields: { name: 'name', decision: 'decision' } } };
  render(<GenericFormSection formType="fixture" />);
  fireEvent.change(screen.getByLabelText('Apply revision update'), { target: { files: [{ text: () => new Promise<string>(resolve => { finish = resolve; }) }] } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'LATEST' } });
  await act(async () => finish(JSON.stringify(update)));
  expect(useDocumentStore.getState().genericForm!.answers.name).toBe('LATEST');
  expect(useDocumentStore.getState().genericForm!.definition.definitionRevision).toBe('v1');
  expect(showAppConfirm).not.toHaveBeenCalled();
});
it('keeps one radio answer in a mixed checklist and offers row choice options in both layouts', () => {
  render(<GenericFormSection formType="fixture" />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Decision' }), { target: { value: 'no' } });
  expect(useDocumentStore.getState().genericForm!.answers.decision).toBe('no');
  fireEvent.click(screen.getByRole('button', { name: /Add row/ }));
  const select = screen.getByRole('combobox', { name: 'Grade, row 1' });
  expect(within(select).getByRole('option', { name: 'E-2' })).toBeTruthy();
  fireEvent.change(select, { target: { value: 'e2' } });
  expect(useDocumentStore.getState().genericForm!.rows.roster[0].answers.grade).toBe('e2');
  act(() => {
    const genericForm = structuredClone(useDocumentStore.getState().genericForm!);
    genericForm.definition.rowGroups.roster.editor = 'cards';
    useDocumentStore.setState({ genericForm });
  });
  const cardChoice = screen.getByRole('combobox', { name: 'Grade, row 1' });
  expect((cardChoice as HTMLSelectElement).value).toBe('e2');
  fireEvent.change(cardChoice, { target: { value: 'e1' } });
  expect(useDocumentStore.getState().genericForm!.rows.roster[0].answers.grade).toBe('e1');
});
it('saves two instances independently, restores a draft, and supports undo', () => {
  const d = fixtureDefinition();
  startForm(d, false);
  const first = useDocumentsStore.getState().currentId!;
  editForm(f => { f.answers.name = 'FIRST'; });
  useDocumentsStore.getState().saveCurrent();
  startForm(d, false);
  const second = useDocumentsStore.getState().currentId!;
  editForm(f => { f.answers.name = 'SECOND'; });
  useDocumentsStore.getState().saveCurrent();
  expect(second).not.toBe(first);
  useDocumentsStore.getState().switchTo(first);
  expect(useDocumentStore.getState().genericForm!.answers.name).toBe('FIRST');
  editForm(f => { f.answers.name = 'CHANGED'; });
  const undo = useHistoryStore.getState().undo();
  expect(undo).not.toBeNull();
  useDocumentStore.getState().applySnapshot(undo!);
  expect(useDocumentStore.getState().genericForm!.answers.name).toBe('FIRST');
  const session = getSerializedSessionForShare();
  useDocumentStore.setState({ genericForm: undefined });
  loadSharedSession(JSON.parse(JSON.stringify(session)));
  expect(useDocumentStore.getState().genericForm!.answers.name).toBe('FIRST');
  importForm({ ...fixtureInstance(), answers: { name: 'IMPORTED' } });
  expect(useDocumentsStore.getState().docs[second].session.genericForm!.answers.name).toBe('SECOND');
});

it('resumes the most recently saved copy from the form picker', () => {
  startForm(fixtureDefinition(), false);
  const first = useDocumentsStore.getState().currentId!;
  startForm(fixtureDefinition(), false);
  const second = useDocumentsStore.getState().currentId!;
  const docs = useDocumentsStore.getState().docs;
  useDocumentsStore.setState({ docs: {
    [first]: { ...docs[first], meta: { ...docs[first].meta, updatedAt: 1 } },
    [second]: { ...docs[second], meta: { ...docs[second].meta, updatedAt: 2 } },
  } });
  useDocumentStore.getState().setFormType('navmc_10274');
  startForm(fixtureDefinition());
  expect(useDocumentsStore.getState().currentId).toBe(second);
});

it('leaves generic answers out of built-in drafts and restores them from the library', () => {
  startForm(fixtureDefinition(), false);
  const id = useDocumentsStore.getState().currentId!;
  editForm(f => { f.answers.name = 'KEEP'; });
  useDocumentStore.getState().setFormType('navmc_10274');
  expect(getSerializedSessionForShare().genericForm).toBeUndefined();
  useDocumentsStore.getState().saveCurrent();
  expect(useDocumentsStore.getState().docs[id].session.genericForm!.answers.name).toBe('KEEP');
  expect(useHistoryStore.getState().canUndo()).toBe(false);
  useDocumentsStore.getState().switchTo(id);
  expect(useDocumentStore.getState().formType).toBe('fixture');
  expect(useDocumentStore.getState().genericForm!.answers.name).toBe('KEEP');
});

it('opens a blank letter without copying the form, and does not recreate a deleted form', () => {
  startForm(fixtureDefinition(), false);
  const id = useDocumentsStore.getState().currentId!;
  editForm(f => { f.answers.name = 'KEEP'; });
  useDocumentsStore.getState().newDocument();
  expect(Object.keys(useDocumentsStore.getState().docs)).toEqual([id]);
  expect(useDocumentsStore.getState().docs[id].session.genericForm!.answers.name).toBe('KEEP');
  expect(useDocumentStore.getState().documentCategory).toBe('correspondence');
  expect(useDocumentStore.getState().genericForm).toBeUndefined();
  expect(useHistoryStore.getState().canUndo()).toBe(false);
  useDocumentsStore.getState().switchTo(id);
  useDocumentsStore.getState().remove(id);
  expect(Object.keys(useDocumentsStore.getState().docs)).toEqual([]);
  expect(useDocumentStore.getState().genericForm).toBeUndefined();
});

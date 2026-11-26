import '../_helpers/packageCatalogFixture';
import 'fake-indexeddb/auto';
import { Profiler, useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PackageIntakePanel } from '@/components/PackageIntakePanel';
import { AppAlertDialog } from '@/components/AppAlertDialog';
import { createActionPackage, getPackageRevision, listActionPackages, type ActionPackage } from '@/lib/actionPackages';
import { idbGetAllAttachments } from '@/lib/documentsDb';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import * as conditional from '@/lib/packageConditional';
import { maintainedPackageAction } from '@/lib/maintainedPackageActions';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof classification>(), getExportDeploymentPolicy: vi.fn(), getExportDeploymentPolicySync: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(policy);
  vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(policy);
  await createActionPackage('Initialize intake tests');
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction([...db.objectStoreNames], 'readwrite'); for (const name of db.objectStoreNames) tx.objectStore(name).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
});
function Harness({ initial, workspace = false }: { initial?: ActionPackage; workspace?: boolean }) {
  const [record, setRecord] = useState(initial), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  const operation = useRef<AbortController | undefined>(undefined);
  return <><AppAlertDialog /><output aria-label="Intake dirty state">{String(dirty)}</output>{error && <p role="alert">{error}</p>}
    <PackageIntakePanel workspace={workspace} record={record} revision={record ? getPackageRevision(record) : undefined} editable disabled={false} busy={busy}
      signal={() => operation.current?.signal} isCurrent={() => true} onDirtyChange={setDirty} onApply={setRecord}
      run={async action => { operation.current = new AbortController(); setBusy(true); try { await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }} />
  </>;
}
async function startTraining(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Start training participation' }));
  const field = await screen.findByLabelText('Course or activity', { exact: true });
  await waitFor(() => expect(field).toBeEnabled()); return field;
}
it('filters published recipes and restores the choices after clearing the search', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const search = screen.getByRole('searchbox', { name: 'Search actions' });
  await user.type(search, 'participation');
  expect(screen.getByRole('button', { name: 'Start training participation' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Start administrative request' })).toBeNull();
  await user.clear(search);
  await user.type(search, 'unknown recipe');
  await user.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('button', { name: 'Start administrative request' })).toBeVisible();
});

it('protects an entered intake answer before the edited frame is painted', async () => {
  let guarded = false;
  const commits: { answer: string; guarded: boolean }[] = [];
  render(<Profiler id="intake-exit-guard" onRender={() => {
    const field = screen.queryByRole('textbox', { name: 'Course or activity' }) as HTMLTextAreaElement | null;
    if (field) commits.push({ answer: field.value, guarded });
  }}><PackageIntakePanel editable disabled={false} busy={false}
    run={async action => action()} onApply={vi.fn()} signal={() => undefined} isCurrent={() => true}
    onDirtyChange={value => { guarded = value; }} /></Profiler>);
  const course = await startTraining(userEvent.setup());
  commits.length = 0;
  fireEvent.change(course, { target: { value: 'Keep this unsaved course' } });
  const edited = commits.filter(commit => commit.answer === 'Keep this unsaved course');
  expect(edited.length).toBeGreaterThan(0);
  expect(edited.every(commit => commit.guarded)).toBe(true);
});
it('returns from the desktop preview without losing answers or creating a package', async () => {
  const user = userEvent.setup(); render(<Harness workspace />);
  const course = await startTraining(user); await user.type(course, 'Keep this unfinished course');
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  const preview = await screen.findByRole('region', { name: 'Action changes preview' });
  expect(within(preview).getByRole('button', { name: 'Create package' })).toBeDisabled();
  const back = within(preview).getByRole('button', { name: 'Back to details' }); await waitFor(() => expect(back).toBeEnabled()); await user.click(back);
  expect(screen.queryByRole('region', { name: 'Action changes preview' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Course or activity' })).toHaveValue('Keep this unfinished course');
  expect(await listActionPackages()).toEqual([]);
});
it('finishes loading exact intake when edit availability changes during a historical transition', async () => {
  const template = await maintainedPackageAction('training-participation');
  const record = await conditional.saveConditionalPackageDraft({ template, answers: { version: 1, values: { course: 'Preserved course' }, groups: {} } }, policy);
  let finish!: (value: typeof template) => void;
  const read = vi.spyOn(conditional, 'readConditionalPackageTemplate').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const input = { workspace: true, record, revision: getPackageRevision(record), editable: true, busy: false,
    run: async (action: () => Promise<void>) => action(), onApply: vi.fn(), signal: () => undefined, isCurrent: () => true };
  const view = render(<PackageIntakePanel {...input} disabled={false} />);
  await waitFor(() => expect(read).toHaveBeenCalled());
  view.rerender(<PackageIntakePanel {...input} editable={false} disabled />);
  await act(async () => { finish(template); });
  await waitFor(() => expect(screen.queryByText('Loading the exact saved intake…')).toBeNull());
  view.rerender(<PackageIntakePanel {...input} disabled={false} />);
  await waitFor(() => expect(screen.getByLabelText('Course or activity', { exact: true })).toBeEnabled());
  expect(screen.getByLabelText('Course or activity', { exact: true })).toHaveValue('Preserved course');
  expect(input.onApply).not.toHaveBeenCalled();
});
it('keeps inactive answers out of the desktop summary and displays choice labels', async () => {
  const template = await maintainedPackageAction('training-participation');
  const record = await conditional.saveConditionalPackageDraft({ template, answers: { version: 1, values: { course: 'Remote course' }, groups: {
    participants: [{ id: 'person', label: 'Example', answers: { attendance: 'remote', location: 'Inactive room', includeEstimate: false, estimate: '125.00' } }],
  } } }, policy);
  render(<PackageIntakePanel workspace record={record} revision={getPackageRevision(record)} editable disabled={false} busy={false}
    run={async action => action()} onApply={vi.fn()} signal={() => undefined} isCurrent={() => true} />);
  const done = await screen.findByRole('button', { name: 'Collapse details' }); await waitFor(() => expect(done).toBeEnabled()); await userEvent.click(done);
  const summary = screen.getByRole('group', { name: 'Details summary' });
  expect(summary).toHaveTextContent('Remote'); expect(summary).not.toHaveTextContent('Inactive room'); expect(summary).not.toHaveTextContent('125.00');
  expect(getPackageRevision(record).templateState!.answers.groups.participants[0].answers.estimate).toBe('125.00');
});

it('returns from an untouched action without saving and focuses the action catalog', async () => {
  const user = userEvent.setup(); render(<Harness />);
  await startTraining(user);
  expect(screen.getByLabelText('Intake dirty state')).toHaveTextContent('false');
  expect(screen.getByRole('button', { name: 'Save intake draft' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Back to actions' }));
  expect(screen.getByRole('heading', { name: 'Start from an action' })).toHaveFocus();
  expect(screen.queryByLabelText('Course or activity', { exact: true })).toBeNull();
  expect(screen.getByRole('button', { name: 'Start training participation' })).toBeEnabled();
  expect(await listActionPackages()).toEqual([]);
});

it('keeps entered answers when returning is cancelled and discards only after confirmation', async () => {
  const user = userEvent.setup(); render(<Harness />);
  const course = await startTraining(user); await user.type(course, 'Keep this course until discarded');
  await user.click(screen.getByRole('button', { name: 'Back to actions' }));
  let confirmation = screen.getByRole('alertdialog', { name: 'Discard intake changes?' });
  await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
  expect(course).toHaveValue('Keep this course until discarded');
  expect(screen.getByLabelText('Intake dirty state')).toHaveTextContent('true');
  await user.click(screen.getByRole('button', { name: 'Back to actions' }));
  confirmation = screen.getByRole('alertdialog', { name: 'Discard intake changes?' });
  await user.click(within(confirmation).getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Start from an action' })).toHaveFocus());
  expect(screen.getByLabelText('Intake dirty state')).toHaveTextContent('false');
  expect(await listActionPackages()).toEqual([]);
});

it('saves and resumes incomplete intake without applying documents, even when owner props are cloned on parent renders', async () => {
  const user = userEvent.setup(), view = render(<Harness />);
  const course = await startTraining(user); await user.type(course, 'Fictional course for the current case');
  expect(course).toHaveValue('Fictional course for the current case');
  await user.click(screen.getByRole('button', { name: 'Save intake draft' }));
  await screen.findByText('Intake saved; document changes not applied.');
  const [saved] = await listActionPackages();
  expect(saved.revisions).toHaveLength(1); expect(getPackageRevision(saved).members).toEqual([]);
  expect(getPackageRevision(saved).templateState?.answers.values.course).toBe('Fictional course for the current case');
  expect(getPackageRevision(saved).templateState?.pending).toBe(true);
  expect(screen.getByLabelText('Intake dirty state')).toHaveTextContent('false');
  view.unmount(); render(<Harness initial={saved} />);
  await screen.findByText('Intake saved; document changes not applied.');
  await user.click(await screen.findByRole('button', { name: 'Show answered questions' }));
  const resumed = screen.getByLabelText('Course or activity', { exact: true });
  expect(resumed).toHaveValue('Fictional course for the current case');
  await user.clear(resumed); await user.type(resumed, 'A complete changed answer');
  expect(resumed).toHaveValue('A complete changed answer');
  expect(screen.getByLabelText('Intake dirty state')).toHaveTextContent('true');
});

it('starts a fresh case without inherited people and restores the selected saved case on discard', async () => {
  const user = userEvent.setup(); render(<Harness />);
  const course = await startTraining(user); await user.type(course, 'Previous case course');
  await user.click(screen.getByRole('button', { name: 'Save intake draft' }));
  await screen.findByText('Intake saved; document changes not applied.');
  const [saved] = await listActionPackages(), previousPerson = getPackageRevision(saved).templateState!.answers.groups.participants[0].id;
  await user.click(screen.getByText('Start another action'));
  await startTraining(user);
  expect(screen.getByLabelText('Course or activity', { exact: true })).toHaveValue('');
  await user.click(screen.getByRole('button', { name: 'Save intake draft' }));
  await waitFor(async () => expect(await listActionPackages()).toHaveLength(2));
  const fresh = (await listActionPackages()).find(record => record.id !== saved.id)!;
  expect(getPackageRevision(fresh).templateState!.answers.groups.participants[0].id).not.toBe(previousPerson);
  await user.click(screen.getByText('Start another action')); await startTraining(user);
  await user.click(screen.getByRole('button', { name: 'Discard intake changes' }));
  await screen.findByText('Intake saved; document changes not applied.');
  expect(screen.getByRole('button', { name: 'Collapse intake questions' })).toBeVisible();
  expect(await listActionPackages()).toHaveLength(2);
});

it('retains an inactive selected PDF until it is explicitly removed and writes no files on selection', async () => {
  const user = userEvent.setup(); render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Start administrative request' }));
  const include = await screen.findByLabelText('Include a supporting PDF?', { exact: true });
  await waitFor(() => expect(include).toBeEnabled()); await user.selectOptions(include, 'true');
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  await user.upload(screen.getByLabelText('PDF for Supporting PDF', { exact: true }), new File([new Uint8Array(await pdf.save())], 'synthetic.pdf', { type: 'application/pdf' }));
  await screen.findByText('Staged · synthetic.pdf');
  expect(await idbGetAllAttachments()).toEqual([]);
  await user.selectOptions(include, 'false');
  const inactive = screen.getByRole('region', { name: 'Inactive selected PDFs' });
  expect(inactive).toHaveTextContent('synthetic.pdf');
  expect(screen.getByRole('button', { name: 'Save intake draft' })).toBeDisabled();
  await user.click(within(inactive).getByRole('button', { name: /Remove inactive PDF/ }));
  expect(screen.getByRole('button', { name: 'Save intake draft' })).toBeEnabled();
  expect(await idbGetAllAttachments()).toEqual([]); expect(await listActionPackages()).toEqual([]);
});

it('cannot publish a held draft save after the intake unmounts', async () => {
  const user = userEvent.setup(); let completed: Promise<void> | undefined;
  const view = render(<PackageIntakePanel editable disabled={false} busy={false} isCurrent={() => true} signal={() => undefined}
    onApply={vi.fn()} run={action => { completed = action().catch(() => {}); return completed; }} />);
  await startTraining(user);
  let release!: (value: typeof policy) => void;
  vi.mocked(classification.getExportDeploymentPolicy).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await user.click(screen.getByRole('button', { name: 'Save intake draft' }));
  view.unmount(); release(policy); await act(async () => { await completed; });
  expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]);
});

it('cancels a held intake draft save when the panel is disabled while keeping local answers', async () => {
  const user = userEvent.setup(); let completed: Promise<void> | undefined;
  const props = { editable: true, disabled: false, busy: false, isCurrent: () => true, signal: () => undefined, onApply: vi.fn(),
    run: (action: () => Promise<void>) => { completed = action().catch(() => {}); return completed; } };
  const view = render(<PackageIntakePanel {...props} />);
  const course = await startTraining(user); await user.type(course, 'Keep this unsaved fictional course');
  let release!: (value: typeof policy) => void;
  vi.mocked(classification.getExportDeploymentPolicy).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await user.click(screen.getByRole('button', { name: 'Save intake draft' }));
  view.rerender(<PackageIntakePanel {...props} disabled />); release(policy); await act(async () => { await completed; });
  expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]); expect(props.onApply).not.toHaveBeenCalled();
  view.rerender(<PackageIntakePanel {...props} />); expect(screen.getByLabelText('Course or activity', { exact: true })).toHaveValue('Keep this unsaved fictional course');
});

it('shows saved-intake loading instead of a new-action catalog from the first frame', async () => {
  const template = await maintainedPackageAction('training-participation');
  const record = await conditional.saveConditionalPackageDraft({ template, answers: { version: 1, values: { course: 'Preserved course' }, groups: {} } }, policy);
  let finish!: (value: typeof template) => void;
  vi.spyOn(conditional, 'readConditionalPackageTemplate').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const frames: { busy: string | null; catalog: boolean }[] = [];
  render(<Profiler id="saved-intake-loading" onRender={() => {
    const panel = screen.queryByRole('region', { name: 'Action intake' });
    if (panel) frames.push({ busy: panel.getAttribute('aria-busy'), catalog: !!screen.queryByRole('button', { name: 'Start training participation' }) });
  }}><Harness initial={record} workspace /></Profiler>);
  expect(frames[0]).toEqual({ busy: 'true', catalog: false });
  expect(screen.getByText('Loading the exact saved intake…')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Details' })).toBeVisible();
  await act(async () => finish(template));
  await waitFor(() => expect(screen.getByRole('region', { name: 'Action intake' })).toHaveAttribute('aria-busy', 'false'));
  expect(screen.getByRole('textbox', { name: 'Course or activity' })).toHaveValue('Preserved course');
  expect(screen.queryByRole('button', { name: 'Start training participation' })).toBeNull();
});

it('finishes the loading state after a saved-intake read error without changing the package', async () => {
  const template = await maintainedPackageAction('training-participation');
  const record = await conditional.saveConditionalPackageDraft({ template, answers: { version: 1, values: { course: 'Keep the saved intake' }, groups: {} } }, policy);
  vi.spyOn(conditional, 'readConditionalPackageTemplate').mockRejectedValueOnce(new Error('Saved intake unavailable.'));
  render(<Harness initial={record} workspace />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Saved intake unavailable.');
  await waitFor(() => expect(screen.getByRole('region', { name: 'Action intake' })).toHaveAttribute('aria-busy', 'false'));
  expect(screen.getByRole('button', { name: 'Start training participation' })).toBeEnabled();
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});

it('hides the previous intake from the first frame of a package selection change', async () => {
  const template = await maintainedPackageAction('training-participation');
  const first = await conditional.saveConditionalPackageDraft({ template, answers: { version: 1, values: { course: 'First saved course' }, groups: {} } }, policy);
  const second = await conditional.saveConditionalPackageDraft({ template, answers: { version: 1, values: { course: 'Second saved course' }, groups: {} } }, policy);
  let finish!: (value: typeof template) => void;
  const held = new Promise<typeof template>(resolve => { finish = resolve; });
  vi.spyOn(conditional, 'readConditionalPackageTemplate').mockImplementation(record => record.id === second.id ? held : Promise.resolve(template));
  const frames: { busy: string | null; course: string | null }[] = [];
  const panel = (record: ActionPackage) => <Profiler id="intake-owner-transition" onRender={() => {
    const region = screen.queryByRole('region', { name: 'Action intake' });
    const course = screen.queryByRole('textbox', { name: 'Course or activity' }) as HTMLTextAreaElement | null;
    if (region) frames.push({ busy: region.getAttribute('aria-busy'), course: course?.value ?? null });
  }}><PackageIntakePanel workspace record={record} revision={getPackageRevision(record)} editable disabled={false} busy={false}
    run={async action => action()} onApply={vi.fn()} signal={() => undefined} isCurrent={() => true} /></Profiler>;
  const view = render(panel(first));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Course or activity' })).toBeEnabled());
  expect(screen.getByRole('textbox', { name: 'Course or activity' })).toHaveValue('First saved course');
  frames.length = 0;
  view.rerender(panel(second));
  expect(frames[0]).toEqual({ busy: 'true', course: null });
  await act(async () => finish(template));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Course or activity' })).toHaveValue('Second saved course'));
});

it('offers a single action beside saved, unapplied intake and opens a read-only preview', async () => {
  const user = userEvent.setup(), first = render(<Harness />);
  await startTraining(user);
  await user.click(screen.getByRole('button', { name: 'Save intake draft' }));
  await screen.findByText('Intake saved; document changes not applied.');
  const [saved] = await listActionPackages();
  first.unmount();
  render(<Harness workspace initial={saved} />);
  const action = await screen.findByRole('button', { name: 'Review document updates' });
  await waitFor(() => expect(action).toBeEnabled());
  await user.click(action);
  await screen.findByRole('region', { name: 'Action changes preview' });
  expect((await listActionPackages())[0].currentRevisionId).toBe(saved.currentRevisionId);
  expect(screen.queryByRole('button', { name: 'Review document updates' })).toBeNull();
});

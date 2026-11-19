import 'fake-indexeddb/auto';
import { useRef, useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PackageIntakePanel } from '@/components/PackageIntakePanel';
import { AppAlertDialog } from '@/components/AppAlertDialog';
import { createActionPackage, getPackageRevision, listActionPackages, type ActionPackage } from '@/lib/actionPackages';
import { idbGetAllAttachments } from '@/lib/documentsDb';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';

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
function Harness({ initial }: { initial?: ActionPackage }) {
  const [record, setRecord] = useState(initial), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  const operation = useRef<AbortController | undefined>(undefined);
  return <><AppAlertDialog /><output aria-label="Intake dirty state">{String(dirty)}</output>{error && <p role="alert">{error}</p>}
    <PackageIntakePanel record={record} revision={record ? getPackageRevision(record) : undefined} editable disabled={false} busy={busy}
      signal={() => operation.current?.signal} isCurrent={() => true} onDirtyChange={setDirty} onApply={setRecord}
      run={async action => { operation.current = new AbortController(); setBusy(true); try { await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }} />
  </>;
}
async function startTraining(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Start training participation' }));
  const field = await screen.findByLabelText('Course or activity', { exact: true });
  await waitFor(() => expect(field).toBeEnabled()); return field;
}

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
  await screen.findByText('Selected: synthetic.pdf');
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

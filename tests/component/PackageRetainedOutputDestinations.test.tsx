import { openSavedPackage, workspaceSection, expandDetails, choosePackageVersion } from "../helpers/packageWorkspace";
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PDFDocument } from 'pdf-lib';
import { ActionPackageWorkspace } from '@/components/ActionPackageWorkspace';
import { createExportGate } from '@/lib/exportController';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, renameActionPackage, reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import * as assembly from '@/lib/actionPackageAssembly';
import * as encoding from '@/lib/encoding';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { PACKAGE_WORKSPACE_CONTEXT_KEY } from '@/lib/packageWorkspaceContext';
import { useUIStore } from '@/stores/uiStore';

const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(),
  getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
// This suite checks the exact reviewed Blob handed to the viewer; PDF.js rendering has separate browser coverage.
vi.mock('@/components/pdf/PdfViewer', () => ({ default: ({ documentId }: { documentId: string }) => <p data-testid="retained-viewer">{documentId}</p> }));
beforeEach(() => {
  localStorage.removeItem(PACKAGE_WORKSPACE_CONTEXT_KEY);
  useUIStore.setState({ actionPackagesOpen: false, isMobile: false, sidebarCollapsed: false });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true };
async function fixture() {
  const timestamp = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(timestamp);
    const original = await PDFDocument.create(); original.addPage([612, 792]);
    let record = await reviseActionPackage(await createActionPackage(`First synthetic rendering ${crypto.randomUUID()}`), [
      await captureOriginalPackageMember({ name: 'Synthetic original.pdf', data: new Uint8Array(await original.save()).buffer }, 'basic-letter', false),
    ]);
    record = await assembly.assemblePackage(await assembly.preparePackageAssembly(record, record.currentRevisionId, policy), ports);
    vi.setSystemTime(timestamp + 5_000);
    record = await renameActionPackage(record, `Second synthetic rendering ${crypto.randomUUID()}`);
    record = await assembly.assemblePackage(await assembly.preparePackageAssembly(record, record.currentRevisionId, policy), ports);
    const revision = getPackageRevision(record), [first, last] = revision.outputs;
    const firstBytes = new Uint8Array(await readPackageAsset(first.asset)), lastBytes = new Uint8Array(await readPackageAsset(last.asset));
    expect(first.asset.name).not.toBe(last.asset.name);
    expect(firstBytes).not.toEqual(lastBytes);
    return { record, revision, first, last, firstBytes, lastBytes };
  } finally { vi.useRealTimers(); }
}
async function open(record: ActionPackage) {
  useUIStore.getState().openActionPackage(record.id);
  render(<ActionPackageWorkspace ports={ports} exportGate={createExportGate()} />);
  const dialog = await screen.findByRole('dialog', { name: 'Action packages' }), user = userEvent.setup();
  await within(dialog).findByRole('heading', { name: record.name, level: 1 });
  await workspaceSection(dialog, 'Delivery', user); await expandDetails(dialog, user);
  return { dialog, user };
}
async function acknowledge(dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>, mode: 'Preview' | 'Download') {

  await user.click(await within(dialog).findByRole('button', { name: `${mode} reviewed retained PDF` }));
}

it('previews and downloads the exact inspected PDF bytes and still opens the last saved output deliberately', async () => {
  const { record, revision, first, last, firstBytes, lastBytes } = await fixture();
  const download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {}), previews: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { if (value instanceof Blob) previews.push(value); return `blob:synthetic-retained-${previews.length}`; });
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const { dialog, user } = await open(record), selector = within(dialog).getByLabelText('Retained PDF to open');
  expect(selector).toHaveValue(last.id);
  await workspaceSection(dialog, 'Overview', user); await expandDetails(dialog, user);
  const impact = await within(dialog).findByRole('region', { name: 'Package change impact' });
  await user.click(within(impact).getByRole('button', { name: 'Compare saved revisions' }));
  await user.click(await within(impact).findByRole('button', { name: 'Show unchanged items' }));
  await user.click(within(impact).getByText('Retained PDFs (2)', { exact: true }));
  await user.click(within(impact).getByRole('button', { name: 'Inspect retained PDF · Retained PDF 1 · location 1' }));
  await waitFor(() => expect(dialog.querySelector(`[data-package-output-id="${first.id}"]`)).toHaveFocus());
  expect(selector).toHaveValue(first.id);
  await user.click(within(dialog).getByRole('button', { name: 'Preview retained PDF' }));
  await acknowledge(dialog, user, 'Preview');
  await waitFor(() => expect(previews).toHaveLength(1));
  expect(new Uint8Array(await previews[0].arrayBuffer())).toEqual(firstBytes);
  expect(await within(dialog).findByTestId('retained-viewer')).toHaveTextContent(`package:${record.id}:${revision.id}:${first.id}`);
  await user.click(within(dialog).getByRole('button', { name: 'Download retained PDF' }));
  await acknowledge(dialog, user, 'Download');
  expect(download).toHaveBeenLastCalledWith(firstBytes, first.asset.name, first.asset.type);
  await user.click(within(dialog).getByRole('button', { name: 'Preview retained PDF' }));

  expect(await within(dialog).findByRole('button', { name: 'Preview reviewed retained PDF' })).toBeEnabled();
  await user.selectOptions(selector, last.id);
  expect(within(dialog).queryByRole('button', { name: 'Preview reviewed retained PDF' })).toBeNull();
  expect(within(dialog).queryByRole('region', { name: 'Retained package PDF' })).toBeNull();
  expect(revoke).toHaveBeenCalledWith('blob:synthetic-retained-1');
  await user.click(within(dialog).getByRole('button', { name: 'Download retained PDF' }));
  await acknowledge(dialog, user, 'Download');
  expect(download).toHaveBeenLastCalledWith(lastBytes, last.asset.name, last.asset.type);
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});

it('locks output choice while checking and resets manual package and revision selections to the latest saved PDF', async () => {
  const { record: captured, revision, first, last } = await fixture();
  const other = await createActionPackage(`Other retained output ${crypto.randomUUID()}`);
  const record = await reviseActionPackage(captured, revision.members), { dialog, user } = await open(record);
  await choosePackageVersion(dialog, revision.id, user);
  await expandDetails(dialog, user);
  const selector = within(dialog).getByLabelText('Retained PDF to open'); expect(selector).toHaveValue(last.id);
  await user.selectOptions(selector, first.id);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), prepare = assembly.preparePackageAssembly;
  vi.spyOn(assembly, 'preparePackageAssembly').mockImplementationOnce(async (...args) => { await gate; return prepare(...args); });
  await user.click(within(dialog).getByRole('button', { name: 'Preview retained PDF' }));
  expect(selector).toBeDisabled();
  await user.selectOptions(selector, last.id); expect(selector).toHaveValue(first.id);
  await act(async () => { release(); });
  await within(dialog).findByRole('button', { name: 'Preview reviewed retained PDF' });
  await choosePackageVersion(dialog, record.currentRevisionId, user);
  expect(within(dialog).queryByLabelText('Retained PDF to open')).toBeNull();
  await choosePackageVersion(dialog, revision.id, user); await expandDetails(dialog, user);
  expect(within(dialog).getByLabelText('Retained PDF to open')).toHaveValue(last.id);
  expect(within(dialog).queryByRole('button', { name: 'Preview reviewed retained PDF' })).toBeNull();
  await user.selectOptions(within(dialog).getByLabelText('Retained PDF to open'), first.id);
  await openSavedPackage(dialog, other, user); await workspaceSection(dialog, 'Delivery', user); await expandDetails(dialog, user);
  expect(within(dialog).queryByLabelText('Retained PDF to open')).toBeNull();
  await openSavedPackage(dialog, record, user); await workspaceSection(dialog, 'Delivery', user); await expandDetails(dialog, user);
  await choosePackageVersion(dialog, revision.id, user); await expandDetails(dialog, user);
  expect(within(dialog).getByLabelText('Retained PDF to open')).toHaveValue(last.id);
});

it('reports a missing explicit selection and never substitutes the latest PDF', async () => {
  const { record, last } = await fixture(), download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  const { dialog, user } = await open(record), selector = within(dialog).getByLabelText('Retained PDF to open');
  // A stale browser option must remain an unavailable exact choice, even if another output exists.
  const missing = document.createElement('option'); missing.value = 'missing-retained-output'; missing.text = 'Stale browser selection'; selector.append(missing);
  fireEvent.change(selector, { target: { value: missing.value } });
  expect(within(dialog).getByRole('alert')).toHaveTextContent('The selected retained PDF is no longer included');
  expect(within(dialog).getByRole('button', { name: 'Preview retained PDF' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Download retained PDF' })).toBeDisabled();
  expect(download).not.toHaveBeenCalled();
  await user.selectOptions(selector, last.id);
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Download retained PDF' })).toBeEnabled();
});

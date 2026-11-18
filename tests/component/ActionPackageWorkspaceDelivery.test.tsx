import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PDFDocument } from 'pdf-lib';
import { ActionPackageWorkspace } from '@/components/ActionPackageWorkspace';
import { createExportGate } from '@/lib/exportController';
import { createActionPackage, reviseActionPackage, listActionPackages, getPackageRevision, type ActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { preparePackageAttachment, applyPreparedPackageAttachment } from '@/lib/packageAttachments';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { resolveExportDeploymentPolicy, type PolicyResolution } from '@/lib/exportDeploymentPolicy';
import { useUIStore } from '@/stores/uiStore';
import { PACKAGE_WORKSPACE_CONTEXT_KEY } from '@/lib/packageWorkspaceContext';
import * as encoding from '@/lib/encoding';
import * as transfers from '@/lib/actionPackageTransfer';
import { preparePackageDelivery } from '@/lib/packageDelivery';
import { buildPackageDeliveryBundle } from '@/lib/packageDeliveryBundle';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
vi.mock('@/components/pdf/PdfViewer', () => ({ default: () => null }));
const publicPolicy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
const secretPolicy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'secret', allowedLevels: ['unclassified', 'secret'] }, runtime: { status: 'absent' } });
let policy: PolicyResolution = publicPolicy;
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
beforeEach(() => { vi.restoreAllMocks(); policy = publicPolicy; localStorage.removeItem(PACKAGE_WORKSPACE_CONTEXT_KEY); useUIStore.setState({ actionPackagesOpen: false, storageHealth: 'ok' }); });
afterEach(cleanup);
async function fixture() {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  const member = await captureOriginalPackageMember({ name: 'Synthetic main.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false);
  return reviseActionPackage(await createActionPackage(`Delivery controller ${crypto.randomUUID()}`), [member]);
}
async function open(record: ActionPackage) {
  useUIStore.getState().openActionPackage(record.id);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = await screen.findByRole('dialog', { name: 'Action packages' });
  await waitFor(() => expect(within(dialog).getByLabelText('Saved packages', { exact: true })).toHaveValue(record.id));
  return dialog;
}
async function restrictedFixture() {
  policy = secretPolicy;
  return applyPreparedPackageAttachment(await preparePackageAttachment(await fixture(),
    { name: 'Synthetic retained.txt', data: new TextEncoder().encode('(S) Restricted synthetic retained content.').buffer }, policy), policy, true);
}
it.each(['original', 'editable'])('rechecks deployment before downloading a previously reviewed %s file', async mode => {
  const record = await restrictedFixture();
  const download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {}), dialog = await open(record), user = userEvent.setup();
  if (mode === 'original') {
    const card = (await within(dialog).findByRole('heading', { name: '2. Synthetic retained.txt' })).closest('li')!;
    await user.click(within(card).getByRole('button', { name: 'Download unchanged original' }));
  } else await user.click(within(dialog).getByRole('button', { name: 'Export editable package' }));
  await user.click(await within(dialog).findByRole('checkbox', { name: /^I reviewed every included member, privacy findings/ }));
  policy = publicPolicy;
  await user.click(within(dialog).getByRole('button', { name: mode === 'original' ? 'Download reviewed unchanged original' : 'Download reviewed editable package' }));
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/policy|deployment|settings|markings|levels/i));
  expect(download).not.toHaveBeenCalled();
});
it('rechecks deployment after the actual editable payload has been built', async () => {
  const record = await restrictedFixture(), dialog = await open(record), user = userEvent.setup();
  const download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  await user.click(within(dialog).getByRole('button', { name: 'Export editable package' }));
  await user.click(await within(dialog).findByRole('checkbox', { name: /^I reviewed every included member, privacy findings/ }));
  const build = transfers.buildPortableActionPackage;
  vi.spyOn(transfers, 'buildPortableActionPackage').mockImplementation(async (...args) => {
    const json = await build(...args); policy = publicPolicy; return json;
  });
  await user.click(within(dialog).getByRole('button', { name: 'Download reviewed editable package' }));
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/policy|deployment|settings/i));
  expect(download).not.toHaveBeenCalled();
});
it('prepares an exact selected delivery while viewing a saved review without mistaking its read projection for a changed owner', async () => {
  const record = await startPackageReview(await fixture(), undefined, 'Captured delivery review'), dialog = await open(record), user = userEvent.setup();
  await user.click(within(dialog).getByRole('button', { name: 'Open review Captured delivery review' }));
  await user.click(within(dialog).getByText('Recipient delivery', { selector: 'summary' }));
  await user.click(await within(dialog).findByRole('button', { name: 'Prepare selected delivery' }));
  await within(dialog).findByRole('region', { name: 'Captured delivery contents' });
  expect(within(dialog).queryByText(/saved package changed/i)).toBeNull();
});
it('accepts a real delivery ZIP through the file chooser and recovers its independent selected revision', async () => {
  const record = await fixture(), member = getPackageRevision(record).members[0];
  const prepared = await preparePackageDelivery(record, record.currentRevisionId, { label: 'Received selected delivery', purpose: 'recipient', memberIds: [member.id] }, publicPolicy);
  const bundle = await buildPackageDeliveryBundle(prepared, publicPolicy, true), dialog = await open(record), user = userEvent.setup();
  const input = within(dialog).getByLabelText('Import editable package', { exact: true });
  expect(input.getAttribute('accept')).toContain('.zip');
  await user.upload(input, new File([bundle.bytes.slice().buffer as ArrayBuffer], 'received-delivery.zip', { type: 'application/zip' }));
  await waitFor(() => expect(within(dialog).getByLabelText('Saved packages', { exact: true })).toHaveValue(bundle.manifest.packageId));
  expect(within(dialog).getByLabelText('Package name', { exact: true })).toHaveValue('Received selected delivery');
  const records = await listActionPackages(), received = records.find(item => item.id === bundle.manifest.packageId)!;
  expect(received.currentRevisionId).toBe(bundle.manifest.revisionId); expect(getPackageRevision(received).members).toHaveLength(1);
  expect(records.find(item => item.id === record.id)).toEqual(record);
});
it('keeps an unfinished whole-member comment editable while blocking close and member switching until cancelled', async () => {
  const record = await startPackageReview(await fixture(), undefined, 'Unfinished feedback review'), dialog = await open(record), user = userEvent.setup();
  await user.click(within(dialog).getByRole('button', { name: 'Open review Unfinished feedback review' }));
  const members = await within(dialog).findByRole('navigation', { name: 'Captured review members' });
  await user.click(within(members).getByRole('button', { name: 'Synthetic main.pdf' }));
  const comment = await within(dialog).findByLabelText('Package member comment', { exact: true });
  await user.type(comment, 'Unfinished synthetic whole-member feedback.');
  expect(comment).toBeEnabled();
  expect(within(dialog).getByLabelText('Saved packages', { exact: true })).toBeDisabled();
  await user.keyboard('{Escape}'); expect(dialog).toBeVisible(); expect(comment).toHaveValue('Unfinished synthetic whole-member feedback.');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel member comment' }));
  await waitFor(() => expect(within(dialog).getByLabelText('Saved packages', { exact: true })).toBeEnabled());
  expect(comment).toHaveValue('');
  await waitFor(() => expect(within(dialog).queryByText('Save or cancel the unfinished feedback before closing this package review.')).toBeNull());
});

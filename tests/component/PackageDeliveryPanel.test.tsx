import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PDFDocument } from 'pdf-lib';
import { PackageDeliveryFindings } from '@/components/PackageDeliveryFindings';
import { PackageDeliveryPanel } from '@/components/PackageDeliveryPanel';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember, capturePackageMember } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { parsePackageDeliveryBundle } from '@/lib/packageDeliveryBundle';
import { createBlankSession } from '@/stores/documentStore';
import * as deliveryBundle from '@/lib/packageDeliveryBundle';
import * as encoding from '@/lib/encoding';
import * as delivery from '@/lib/packageDelivery';
import * as classification from '@/config/classification';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const pdf = await PDFDocument.create(); pdf.addPage(); const data = new Uint8Array(await pdf.save()).buffer;
  const first = await captureOriginalPackageMember({ name: 'First selected.pdf', data }, 'basic-letter', false);
  const second = await captureOriginalPackageMember({ name: 'Second excluded.pdf', data }, 'enclosure', false);
  return reviseActionPackage(await createActionPackage(`Delivery UI ${crypto.randomUUID()}`), [first, second]);
}
it('prepares exact scope, requires review, downloads captured bytes and clears its search scope when selection changes', async () => {
  const record = await fixture(), user = userEvent.setup(), onPreparedChange = vi.fn(), download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  render(<PackageDeliveryPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={false} run={async action => action()} signal={() => undefined} isCurrent={() => true} onPreparedChange={onPreparedChange} />);
  await user.click(screen.getByLabelText('Include Second excluded.pdf'));
  await user.click(screen.getByRole('button', { name: 'Prepare selected delivery' }));
  const contents = await screen.findByRole('region', { name: 'Captured delivery contents' });
  expect(contents).toHaveTextContent('1 included documents · 1 excluded');
  expect(screen.getByRole('button', { name: 'Download reviewed delivery package' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed every included document/ }));
  await user.click(screen.getByRole('button', { name: 'Download reviewed delivery package' }));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
  const payload = JSON.parse(new TextDecoder().decode(download.mock.calls[0][0] as Uint8Array));
  expect(payload.package.revisions[0].members).toHaveLength(1); expect(JSON.stringify(payload.package)).not.toContain('Second excluded.pdf');
  await user.click(screen.getByRole('button', { name: 'Download reviewed delivery bundle' }));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
  const bundle = await parsePackageDeliveryBundle(download.mock.calls[1][0] as Uint8Array); expect(bundle.manifest.members).toHaveLength(1);
  expect(onPreparedChange.mock.calls.some(([value]) => value?.members.length === 1)).toBe(true);
  await user.type(screen.getByLabelText('Delivery name'), ' revised');
  expect(screen.queryByRole('region', { name: 'Captured delivery contents' })).toBeNull(); expect(onPreparedChange).toHaveBeenLastCalledWith(null);
});

it('holds direct recipient downloads for the captured letter’s envelope mailing review', async () => {
  const session = createBlankSession();
  Object.assign(session.formData, {
    windowEnvelope: 'standard', to: 'TRAINING OFFICE\nQUANTICO VA 22134', subject: 'WINDOW DELIVERY',
    date: '23 Nov 26', unitLine1: 'TRAINING COMMAND', fontFamily: 'times', fontSize: '12pt', via: '',
  });
  const member = await capturePackageMember(captureDocumentRevision({ documentId: 'window-letter', epoch: 0, editSequence: 0, capturedAt: 0 },
    { ...session, endItems: [], publicationTables: {} }), 'Window letter', 'basic-letter');
  const record = await reviseActionPackage(await createActionPackage(`Window delivery ${crypto.randomUUID()}`), [member]);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = await pdf.save();
  const ports = { compile: vi.fn(async () => bytes), convertDocx: vi.fn(), waitForReady: async () => true };
  const user = userEvent.setup(), onPreparedChange = vi.fn(), download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  render(<PackageDeliveryPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={false} run={async action => action()} signal={() => undefined} isCurrent={() => true} directDownload ports={ports} onPreparedChange={onPreparedChange} />);
  await user.click(screen.getByRole('button', { name: 'Prepare selected delivery' }));
  const contents = await screen.findByRole('region', { name: 'Captured delivery contents' });
  expect(contents).toHaveTextContent(/Print at actual size and check that the complete address stays visible when folded and shifted/);
  expect(contents).toHaveTextContent(/⅛ inch clearance/);
  const prepared = onPreparedChange.mock.lastCall?.[0];
  expect(prepared.sourceRevisionId).toBe(record.currentRevisionId);
  expect(prepared.reviews).toContainEqual(expect.objectContaining({ member: 'Window letter', review: expect.objectContaining({ layoutReview: true }) }));
  expect(ports.compile).toHaveBeenCalledTimes(1);
  const packageButton = screen.getByRole('button', { name: 'Download reviewed delivery package' });
  const bundleButton = screen.getByRole('button', { name: 'Download reviewed delivery bundle' });
  expect(packageButton).toBeDisabled();
  expect(bundleButton).toBeDisabled();
  await expect(delivery.buildPackageDeliveryFile(prepared, policy, false)).rejects.toThrow(/Review every/);

  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the layout notices/ }));
  await user.click(packageButton);
  await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
  const payload = JSON.parse(new TextDecoder().decode(download.mock.calls[0][0] as Uint8Array));
  expect(payload.package.revisions[0].members).toEqual([expect.objectContaining({ label: 'Window letter', kind: 'original' })]);
  expect(JSON.stringify(payload.package)).not.toContain(record.id);
  await user.click(bundleButton);
  await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
  const bundle = await parsePackageDeliveryBundle(download.mock.calls[1][0] as Uint8Array);
  expect(bundle.manifest.members).toHaveLength(1);

  await user.type(screen.getByLabelText('Delivery name'), ' edited');
  await user.click(screen.getByRole('button', { name: 'Prepare selected delivery' }));
  await screen.findByRole('region', { name: 'Captured delivery contents' });
  expect(screen.getByRole('checkbox', { name: /^I reviewed the layout notices/ })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Download reviewed delivery bundle' })).toBeDisabled();
});
it('reports parent operation rejection without trapping the controls and invalidates old scope on package switch', async () => {
  const record = await fixture(), user = userEvent.setup(), onPreparedChange = vi.fn();
  const props = { record, revision: getPackageRevision(record), disabled: false, busy: false, signal: () => undefined, isCurrent: () => true, onPreparedChange };
  const view = render(<PackageDeliveryPanel {...props} run={async () => { throw new Error('Parent unavailable'); }} />);
  await user.click(screen.getByRole('button', { name: 'Prepare selected delivery' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Parent unavailable'); expect(screen.getByRole('button', { name: 'Prepare selected delivery' })).toBeEnabled();
  const other = await fixture(); view.rerender(<PackageDeliveryPanel {...props} record={other} revision={getPackageRevision(other)} run={async action => action()} />);
  expect(screen.queryByRole('alert')).toBeNull(); expect(onPreparedChange).toHaveBeenLastCalledWith(null);
});

for (const format of ['package', 'bundle'] as const) it(`rechecks policy synchronously after ${format} generation and before starting the browser download`, async () => {
  const record = await fixture(), user = userEvent.setup(), download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  render(<PackageDeliveryPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={false} run={async action => action()} signal={() => undefined} isCurrent={() => true} />);
  await user.click(screen.getByRole('button', { name: 'Prepare selected delivery' }));
  await screen.findByRole('region', { name: 'Captured delivery contents' });
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed every included document/ }));
  if (format === 'package') {
    const build = delivery.buildPackageDeliveryFile;
    vi.spyOn(delivery, 'buildPackageDeliveryFile').mockImplementationOnce(async (...args) => {
      const json = await build(...args);
      vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue({ status: 'error', message: 'Policy unavailable after generation' });
      return json;
    });
  } else {
    const build = deliveryBundle.buildPackageDeliveryBundle;
    vi.spyOn(deliveryBundle, 'buildPackageDeliveryBundle').mockImplementationOnce(async (...args) => {
      const bundle = await build(...args);
      vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue({ status: 'error', message: 'Policy unavailable after generation' });
      return bundle;
    });
  }
  await user.click(screen.getByRole('button', { name: `Download reviewed delivery ${format}` }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Policy unavailable after generation');
  expect(download).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: 'Captured delivery contents' })).toBeNull();
});

it('does not download an already generated delivery after the parent disables the selection', async () => {
  const record = await fixture(), user = userEvent.setup(), download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {}), onPreparedChange = vi.fn();
  const props = { record, revision: getPackageRevision(record), disabled: false, busy: false, run: async (action: () => Promise<void>) => action(), signal: () => undefined, isCurrent: () => true, onPreparedChange };
  const view = render(<PackageDeliveryPanel {...props} />);
  await user.click(screen.getByRole('button', { name: 'Prepare selected delivery' }));
  await screen.findByRole('region', { name: 'Captured delivery contents' });
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed every included document/ }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), build = delivery.buildPackageDeliveryFile;
  vi.spyOn(delivery, 'buildPackageDeliveryFile').mockImplementationOnce(async (...args) => { const json = await build(...args); await gate; return json; });
  await user.click(screen.getByRole('button', { name: 'Download reviewed delivery package' }));
  view.rerender(<PackageDeliveryPanel {...props} disabled />); release();
  await waitFor(() => expect(screen.getByRole('region', { name: 'Recipient delivery' })).toHaveAttribute('aria-busy', 'false'));
  expect(download).not.toHaveBeenCalled(); expect(onPreparedChange).toHaveBeenLastCalledWith(null);
});

it('opens intake for an unresolved condition even when its document already exists', async () => {
  const revision = getPackageRevision(await fixture());
  const member = revision.members[0], navigate = vi.fn();
  render(<PackageDeliveryFindings revision={revision} onNavigate={navigate} disabled={false} findings={[{
    id: 'intake:1', kind: 'document', state: 'missing', label: member.label,
    memberId: member.id, fromIntake: true, message: 'Resolve the intake questions.',
  }]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Review intake' }));
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ revisionId: revision.id, panel: 'intake' }));
});

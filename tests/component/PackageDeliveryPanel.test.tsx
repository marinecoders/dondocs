import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PDFDocument } from 'pdf-lib';
import { PackageDeliveryPanel } from '@/components/PackageDeliveryPanel';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as encoding from '@/lib/encoding';

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
  expect(onPreparedChange.mock.calls.some(([value]) => value?.members.length === 1)).toBe(true);
  await user.type(screen.getByLabelText('Delivery name'), ' revised');
  expect(screen.queryByRole('region', { name: 'Captured delivery contents' })).toBeNull(); expect(onPreparedChange).toHaveBeenLastCalledWith(null);
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

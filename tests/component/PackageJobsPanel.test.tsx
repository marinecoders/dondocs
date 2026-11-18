import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PDFDocument } from 'pdf-lib';
import { PackageJobsPanel } from '@/components/PackageJobsPanel';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { resolveExportDeploymentPolicy, type PolicyResolution } from '@/lib/exportDeploymentPolicy';
import { listPackageJobs } from '@/lib/packageJobs';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
let currentPolicy: PolicyResolution = policy;
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy, getExportDeploymentPolicySync: () => currentPolicy }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); currentPolicy = policy; });
async function fixture() {
  const pdf = await PDFDocument.create(); pdf.addPage(); const data = new Uint8Array(await pdf.save()).buffer;
  const member = await captureOriginalPackageMember({ name: 'Original.pdf', data }, 'basic-letter', false);
  return reviseActionPackage(await createActionPackage(`Jobs UI ${crypto.randomUUID()}`), [member]);
}
const ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true };
it('requires review, assembles an actual retained PDF and shows completed progress and job status', async () => {
  const record = await fixture(), user = userEvent.setup(), onApply = vi.fn();
  const view = render(<PackageJobsPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={false} ports={ports} run={async action => action()} signal={() => undefined} isCurrent={() => true} onApply={onApply} />);
  await user.click(screen.getByText('Resumable PDF assembly'));
  await user.click(screen.getByRole('button', { name: 'Review resumable assembly' }));
  const start = await screen.findByRole('button', { name: 'Start reviewed assembly' }); expect(start).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed every captured/ }));
  await user.click(start);
  await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('progressbar', { name: 'Documents assembled' })).toHaveValue(1);
  expect(getPackageRevision(onApply.mock.calls[0][0]).outputs).toHaveLength(1);
  expect(await screen.findByText('complete · 1 of 1 documents')).toBeInTheDocument();
  const saved = onApply.mock.calls[0][0];
  view.rerender(<PackageJobsPanel record={saved} revision={getPackageRevision(saved)} disabled={false} busy={false} ports={ports} run={async action => action()} signal={() => undefined} isCurrent={() => true} onApply={onApply} />);
  expect(screen.getByText('Resumable PDF assembly').closest('details')).toHaveAttribute('open');
  expect(await screen.findByText('complete · 1 of 1 documents')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Remove saved job' }));
  await waitFor(async () => expect(await listPackageJobs(record.id)).toEqual([]));
});
it('discards old review when policy changes or the panel becomes read-only', async () => {
  const record = await fixture(), user = userEvent.setup();
  const props = { record, revision: getPackageRevision(record), disabled: false, busy: false, ports, run: async (action: () => Promise<void>) => action(), signal: () => undefined, isCurrent: () => true, onApply: vi.fn() };
  const view = render(<PackageJobsPanel {...props} />);
  await user.click(screen.getByText('Resumable PDF assembly'));
  await user.click(screen.getByRole('button', { name: 'Review resumable assembly' }));
  await screen.findByRole('button', { name: 'Start reviewed assembly' });
  currentPolicy = { status: 'not-ready', message: 'Loading' }; window.dispatchEvent(new Event('focus'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Start reviewed assembly' })).toBeNull());
  currentPolicy = policy;
  await user.click(screen.getByRole('button', { name: 'Review resumable assembly' }));
  await screen.findByRole('button', { name: 'Start reviewed assembly' });
  view.rerender(<PackageJobsPanel {...props} disabled />);
  expect(screen.queryByRole('button', { name: 'Start reviewed assembly' })).toBeNull(); expect(screen.getByRole('button', { name: 'Review resumable assembly' })).toBeDisabled();
});
it('reports parent rejection and re-enables controls; switching package removes stale errors', async () => {
  const record = await fixture(), user = userEvent.setup();
  const props = { record, revision: getPackageRevision(record), disabled: false, busy: false, ports, run: async () => { throw new Error('Parent unavailable'); }, signal: () => undefined, isCurrent: () => true, onApply: vi.fn() };
  const view = render(<PackageJobsPanel {...props} />);
  await user.click(screen.getByText('Resumable PDF assembly'));
  await user.click(screen.getByRole('button', { name: 'Review resumable assembly' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Parent unavailable'); expect(screen.getByRole('button', { name: 'Review resumable assembly' })).toBeEnabled();
  const other = await fixture(); view.rerender(<PackageJobsPanel {...props} record={other} revision={getPackageRevision(other)} />);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('clears acknowledgement when paused before the parent starts work and requires a fresh review', async () => {
  const record = await fixture(), user = userEvent.setup();
  let hold = false, release: (() => void) | undefined;
  const run = async (action: () => Promise<void>) => { if (hold) await new Promise<void>(resolve => { release = resolve; }); await action(); };
  render(<PackageJobsPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={false} ports={ports} run={run} signal={() => undefined} isCurrent={() => true} onApply={vi.fn()} />);
  await user.click(screen.getByText('Resumable PDF assembly'));
  await user.click(screen.getByRole('button', { name: 'Review resumable assembly' }));
  await screen.findByRole('button', { name: 'Start reviewed assembly' });
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed every captured/ }));
  hold = true; await user.click(screen.getByRole('button', { name: 'Start reviewed assembly' }));
  await user.click(screen.getByRole('button', { name: 'Pause assembly' }));
  expect(screen.queryByRole('button', { name: 'Start reviewed assembly' })).toBeNull();
  release?.();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review resumable assembly' })).toBeEnabled());
  expect(await listPackageJobs(record.id)).toEqual([]);
});

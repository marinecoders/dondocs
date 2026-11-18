import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { PackageSigningPanel } from '@/components/PackageSigningPanel';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { createSigningHandoff, listSigningRecords, updateSigningFields } from '@/lib/signingWorkspace';
import * as signing from '@/lib/packageSigning';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import * as encoding from '@/lib/encoding';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
vi.mock('@/components/PackageSigningPdfPreview', () => ({ PackageSigningPdfPreview: ({ label }: { label: string }) => <div aria-label={label}>Read-only PDF preview</div> }));
vi.mock('@/components/modals/SigningWorkspace', () => ({ default: ({ initialRecordId, onOpenChange }: { initialRecordId: string; onOpenChange(open: boolean): void }) =>
  <div role="dialog" aria-label="Existing signing workspace">{initialRecordId}<button onClick={() => onOpenChange(false)}>Close existing signing workspace</button></div> }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
const otherPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });
beforeEach(() => { vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy); useUIStore.setState({ storageHealth: 'ok' }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const pdf = await PDFDocument.create(); pdf.addPage([400, 600]);
  const member = await captureOriginalPackageMember({ name: `Synthetic ${crypto.randomUUID()}.pdf`, data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false);
  return reviseActionPackage(await createActionPackage(`Signing ${crypto.randomUUID()}`), [member]);
}
function props(record: ActionPackage) { return { record, revision: getPackageRevision(record), disabled: false, busy: false, run: async (action: () => Promise<void>) => action(),
  onApply: vi.fn(), isCurrent: () => true, signal: () => undefined }; }
it('opens the existing exact-PDF signing editor and saves a reviewed real handoff into a child package revision', async () => {
  const initial = await fixture(), dirty = vi.fn(), applied = vi.fn();
  function Harness() { const [record, setRecord] = useState(initial); return <PackageSigningPanel {...props(record)} onDirtyChange={dirty} onApply={next => { applied(next); setRecord(next); }} />; }
  const user = userEvent.setup(); render(<Harness />);
  await user.selectOptions(screen.getByLabelText('Package signing PDF'), JSON.stringify(signing.packageSigningTargets(getPackageRevision(initial))[0].target));
  await user.click(screen.getByRole('button', { name: 'Review signing source' }));
  expect(await screen.findByLabelText('Exact package signing source PDF')).toBeVisible();
  expect(dirty).toHaveBeenLastCalledWith(true);
  const open = screen.getByRole('button', { name: 'Open signing workspace for this PDF' }); expect(open).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the exact source PDF/ })); await user.click(open);
  const workspace = await screen.findByRole('dialog', { name: 'Existing signing workspace' });
  const id = workspace.textContent!.replace('Close existing signing workspace', '');
  let record = (await listSigningRecords()).find(item => item.id === id)!;
  await act(async () => { record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'Alex Example', page: 0, x: 0.2, y: 0.7, width: 0.4, height: 0.08 }]); record = await createSigningHandoff(record); });
  await user.click(screen.getByRole('button', { name: 'Close existing signing workspace' }));
  await user.click(screen.getByRole('button', { name: 'Refresh saved signing handoffs' }));
  await screen.findByRole('option', { name: /^Handoff 1/ });
  await user.selectOptions(screen.getByLabelText('Package signing handoff'), record.handoffs![0].id);
  await user.click(screen.getByRole('button', { name: 'Review exact package handoff' }));
  await screen.findByLabelText('Exact prepared package handoff PDF');
  const save = screen.getByRole('button', { name: 'Capture handoff in new package revision' }); expect(save).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the handoff PDF/ })); await user.click(save);
  await waitFor(() => expect(applied).toHaveBeenCalledTimes(1));
  const saved = (await listActionPackages()).find(item => item.id === initial.id)!;
  expect(getPackageRevision(saved).parentId).toBe(initial.currentRevisionId); expect(getPackageRevision(saved).signing!.handoffs[0].signers).toEqual(['Alex Example']);
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});
it('drops an asynchronous source result after switching packages and leaves controls usable', async () => {
  const first = await fixture(), second = await fixture(), target = signing.packageSigningTargets(getPackageRevision(first))[0].target;
  const result = await signing.preparePackageSigningSource(first, first.currentRevisionId, target, policy);
  let resolve!: (value: signing.PreparedPackageSigningSource) => void;
  vi.spyOn(signing, 'preparePackageSigningSource').mockReturnValueOnce(new Promise(value => { resolve = value; }));
  const user = userEvent.setup(), view = render(<PackageSigningPanel {...props(first)} />);
  await user.selectOptions(screen.getByLabelText('Package signing PDF'), JSON.stringify(target)); await user.click(screen.getByRole('button', { name: 'Review signing source' }));
  view.rerender(<PackageSigningPanel {...props(second)} />);
  await act(async () => { resolve(result); });
  await waitFor(() => expect(screen.getByLabelText('Package signing PDF')).toBeEnabled());
  expect(screen.queryByLabelText('Exact package signing source PDF')).toBeNull();
});
it('handles a parent operation rejection without an unhandled promise or stuck controls', async () => {
  const record = await fixture(), user = userEvent.setup(); render(<PackageSigningPanel {...props(record)} run={async () => { throw new Error('Parent operation unavailable.'); }} />);
  await user.selectOptions(screen.getByLabelText('Package signing PDF'), JSON.stringify(signing.packageSigningTargets(getPackageRevision(record))[0].target));
  await user.click(screen.getByRole('button', { name: 'Review signing source' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Parent operation unavailable.'); expect(screen.getByRole('button', { name: 'Review signing source' })).toBeEnabled();
});
it('keeps historical handoffs inspectable while policy changes invalidate a reviewed download', async () => {
  const initial = await fixture(), target = signing.packageSigningTargets(getPackageRevision(initial))[0].target;
  let record = await signing.openPackageSigningSource(await signing.preparePackageSigningSource(initial, initial.currentRevisionId, target, policy), policy, true);
  record = await createSigningHandoff(await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'Blair Sample', page: 0, x: 0.2, y: 0.7, width: 0.4, height: 0.08 }]));
  const saved = await signing.capturePackageSigningHandoff(await signing.preparePackageSigningHandoff(initial, initial.currentRevisionId, target, record, record.handoffs![0].id, policy), policy, true);
  const download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {}), user = userEvent.setup();
  render(<PackageSigningPanel {...props(saved)} disabled />);
  expect(screen.queryByRole('button', { name: 'Review signing source' })).toBeNull();
  await user.click(screen.getByText('Captured signing handoff 1', { selector: 'summary' }));
  await user.click(screen.getByRole('button', { name: 'Review retained handoff 1' }));
  await screen.findByLabelText('Exact retained package handoff PDF');
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed every retained source and handoff page/ }));
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(otherPolicy);
  await user.click(screen.getByRole('button', { name: 'Download exact package signing handoff' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Deployment settings changed'); expect(download).not.toHaveBeenCalled();
});

it('invalidates a reviewed signing preparation when its view becomes read-only without changing package identity', async () => {
  const record = await fixture(), user = userEvent.setup(), dirty = vi.fn();
  const view = render(<PackageSigningPanel {...props(record)} onDirtyChange={dirty} />);
  await user.selectOptions(screen.getByLabelText('Package signing PDF'), JSON.stringify(signing.packageSigningTargets(getPackageRevision(record))[0].target));
  await user.click(screen.getByRole('button', { name: 'Review signing source' }));
  await screen.findByLabelText('Exact package signing source PDF');
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the exact source PDF/ }));
  expect(dirty).toHaveBeenLastCalledWith(true);
  view.rerender(<PackageSigningPanel {...props(record)} disabled onDirtyChange={dirty} />);
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  view.rerender(<PackageSigningPanel {...props(record)} onDirtyChange={dirty} />);
  expect(screen.queryByLabelText('Exact package signing source PDF')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open signing workspace for this PDF' })).toBeNull();
});

import { openSavedPackage, workspaceSection, expandDetails } from "../helpers/packageWorkspace";
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PDFDocument } from 'pdf-lib';
import { ActionPackageWorkspace } from '@/components/ActionPackageWorkspace';
import { createExportGate } from '@/lib/exportController';
import { createActionPackage, reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { preparePackageDelivery, type PreparedPackageDelivery } from '@/lib/packageDelivery';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { useUIStore } from '@/stores/uiStore';
import { PACKAGE_WORKSPACE_CONTEXT_KEY } from '@/lib/packageWorkspaceContext';
const controls = vi.hoisted(() => ({ prepared: new Map<string, PreparedPackageDelivery>(), callbacks: new Map<string, (value: PreparedPackageDelivery | null) => void>() }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
vi.mock('@/components/pdf/PdfViewer', () => ({ default: () => null }));
vi.mock('@/components/PackageDeliveryPanel', () => ({ PackageDeliveryPanel: ({ record, onPreparedChange }: { record: ActionPackage; onPreparedChange(value: PreparedPackageDelivery | null): void }) => {
  controls.callbacks.set(record.id, onPreparedChange);
  return <button onClick={() => onPreparedChange(controls.prepared.get(record.id)!)}>Prepare controller scope {record.name}</button>;
} }));
vi.mock('@/components/PackageSearchPanel', () => ({ PackageSearchPanel: ({ delivery }: { delivery?: { label: string } }) => <p data-testid="controller-delivery-scope">{delivery?.label ?? 'No captured delivery'}</p> }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
beforeEach(() => { controls.prepared.clear(); controls.callbacks.clear(); localStorage.removeItem(PACKAGE_WORKSPACE_CONTEXT_KEY); useUIStore.setState({ actionPackagesOpen: false, storageHealth: 'ok' }); });
afterEach(cleanup);
async function fixture(name: string) {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  const member = await captureOriginalPackageMember({ name: `${name}.pdf`, data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false);
  const record = await reviseActionPackage(await createActionPackage(name), [member]);
  controls.prepared.set(record.id, await preparePackageDelivery(record, record.currentRevisionId, { label: `${name} selected scope`, purpose: 'recipient', memberIds: [member.id] }, policy));
  return record;
}
it('ignores a late delivery-scope cleanup from the previously selected owner', async () => {
  const first = await fixture('First synthetic owner'), second = await fixture('Second synthetic owner'), user = userEvent.setup();
  useUIStore.getState().openActionPackage(first.id);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = await screen.findByRole('dialog', { name: 'Action packages' });
  await within(dialog).findByRole('heading', { name: first.name, level: 1 });
  await workspaceSection(dialog, 'Delivery', user); await expandDetails(dialog, user);

  await user.click(await within(dialog).findByRole('button', { name: `Prepare controller scope ${first.name}` }));
  await waitFor(() => expect(screen.getByTestId('controller-delivery-scope')).toHaveTextContent(`${first.name} selected scope`));
  const lateCleanup = controls.callbacks.get(first.id)!;
  await openSavedPackage(dialog, second, user); await workspaceSection(dialog, 'Delivery', user); await expandDetails(dialog, user);
  await user.click(await within(dialog).findByRole('button', { name: `Prepare controller scope ${second.name}` }));
  await waitFor(() => expect(screen.getByTestId('controller-delivery-scope')).toHaveTextContent(`${second.name} selected scope`));
  act(() => lateCleanup(null));
  expect(screen.getByTestId('controller-delivery-scope')).toHaveTextContent(`${second.name} selected scope`);
});

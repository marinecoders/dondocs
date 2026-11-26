import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageDocumentPreview } from '@/components/PackageDocumentPreview';
import { packageFormFixture } from '../_helpers/packageFormReviewFixture';
import { createExportGate } from '@/lib/exportController';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { renderPackageRecipientMember } from '@/lib/packageNativeDelivery';

vi.mock('@/lib/packageNativeDelivery', () => ({ renderPackageRecipientMember: vi.fn() }));
vi.mock('@/components/pdf/PdfViewer', () => ({ default: ({ pdfUrl }: { pdfUrl: string }) => <div aria-label="Rendered preview">{pdfUrl}</div> }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(),
  getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
const ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true };
const renderedMember = () => ({ bytes: new Uint8Array([37, 80, 68, 70]).buffer });
async function member(label: string) {
  return capturePackageMember(captureDocumentRevision({ documentId: label, epoch: 0, editSequence: 0, capturedAt: 100 },
    { ...createBlankSession(), endItems: [], publicationTables: {} }), label, 'basic-letter');
}
beforeEach(() => {
  vi.mocked(renderPackageRecipientMember).mockReset();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it('cancels a queued preview without occupying the renderer after leaving Documents', async () => {
  const captured = await member('Queued document'), gate = createExportGate(), release = gate.acquire()!;
  const props = { packageId: 'package', revisionId: 'version', member: captured, ports, exportGate: gate };
  const view = render(<PackageDocumentPreview {...props} active />);
  await screen.findByRole('status');
  view.rerender(<PackageDocumentPreview {...props} active={false} />);
  await act(async () => release());
  expect(renderPackageRecipientMember).not.toHaveBeenCalled();
  const next = gate.acquire();
  expect(next).not.toBeNull();
  next?.();
});

it('discards a late render for the previously selected document and releases its renderer', async () => {
  const first = await member('First document'), second = await member('Second document'), gate = createExportGate();
  let finish!: (value: ReturnType<typeof renderedMember>) => void;
  vi.mocked(renderPackageRecipientMember).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(renderedMember());
  const props = { packageId: 'package', revisionId: 'version', ports, exportGate: gate, active: true };
  const view = render(<PackageDocumentPreview {...props} member={first} />);
  await waitFor(() => expect(renderPackageRecipientMember).toHaveBeenCalledTimes(1));
  const firstSignal = vi.mocked(renderPackageRecipientMember).mock.calls[0][4];
  view.rerender(<PackageDocumentPreview {...props} member={second} />);
  expect(firstSignal?.aborted).toBe(true);
  await act(async () => finish(renderedMember()));
  await waitFor(() => expect(renderPackageRecipientMember).toHaveBeenCalledTimes(2));
  await screen.findByLabelText('Rendered preview');
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('region', { name: 'Preview of Second document' })).toBeVisible();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  const release = gate.acquire();
  expect(release).not.toBeNull();
  release?.();
});

it('offers a working retry after a failed render', async () => {
  vi.mocked(renderPackageRecipientMember).mockRejectedValueOnce(new Error('Renderer unavailable')).mockResolvedValueOnce(renderedMember());
  render(<PackageDocumentPreview packageId="package" revisionId="version" member={await member('Retry document')} active ports={ports} exportGate={createExportGate()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Renderer unavailable');
  await userEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
  await screen.findByLabelText('Rendered preview');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('can restart a slow preview and ignores the canceled result', async () => {
  const captured = await member('Training letter');
  let finish!: (value: ReturnType<typeof renderedMember>) => void;
  vi.mocked(renderPackageRecipientMember).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(renderedMember());
  vi.useFakeTimers();
  try {
    render(<PackageDocumentPreview packageId="package" revisionId="version" member={captured} active ports={ports} exportGate={createExportGate()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByRole('status')).toHaveTextContent('Still preparing Training letter');
    const signal = vi.mocked(renderPackageRecipientMember).mock.calls[0][4];
    await act(async () => screen.getByRole('button', { name: 'Retry preview' }).click());
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(renderedMember()));
    expect(renderPackageRecipientMember).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Still preparing Training letter…')).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('previews the saved configured form answers when no editor is open', async () => {
  const { member } = await packageFormFixture();
  vi.mocked(renderPackageRecipientMember).mockResolvedValue(renderedMember());
  render(<PackageDocumentPreview packageId="package" revisionId="saved" member={member} active ports={ports} exportGate={createExportGate()} />);
  await screen.findByLabelText('Rendered preview');
  expect(vi.mocked(renderPackageRecipientMember).mock.calls[0].slice(6)).toEqual(['editable', {
    kind: 'configured', answers: member.session.genericForm!.answers, rows: member.session.genericForm!.rows,
  }]);
});

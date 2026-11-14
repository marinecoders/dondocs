import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi, beforeEach } from 'vitest';
import { createExportGate } from '@/lib/exportController';
import { WordPackageDownload } from '@/components/WordPackageDownload';
import { prepareWordPackage, renderWordPackage } from '@/services/exports/wordPackage';
import { triggerDownload } from '@/lib/encoding';
import type { ActionPackage } from '@/lib/actionPackages';

vi.mock('@/config/classification', () => ({ getExportDeploymentPolicy: async () => ({ status: 'ready', policy: {} }) }));
vi.mock('@/services/exports/wordPackage', () => ({ prepareWordPackage: vi.fn(), acknowledgeWordPackage: vi.fn(), renderWordPackage: vi.fn() }));
vi.mock('@/lib/encoding', () => ({ triggerDownload: vi.fn() }));
const record = (id = 'package_one'): ActionPackage => ({ kind: 'dondocs-action-package-record', version: 1, id, name: 'Captured action', archived: false, sequence: 1, currentRevisionId: 'revision_one', revisions: [{ id: 'revision_one', createdAt: 1, members: [], outputs: [] }] });
const prepared = { packageName: 'Captured action', revisionId: 'revision_one', privacy: { found: false, findings: [], summary: { ssn: 0, edipi: 0, dob: 0, phone: 0, medicalKeywords: 0, emailAddresses: 0 }, matches: [] }, reviews: [], limitations: ['PDF signing fields remain separate.'] };
const exportGate = createExportGate();
const ports = { compile: async () => null, convertDocx: async () => new Blob(['docx']) };
beforeEach(() => { vi.clearAllMocks();vi.mocked(prepareWordPackage).mockResolvedValue(prepared); });

it.each(['package', 'revision'] as const)('aborts preparation and resets review when the displayed %s changes', async change => {
  let finish!: () => void;
  vi.mocked(prepareWordPackage).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(prepared); }));
  const first = record(), view = render(<WordPackageDownload record={first} revisionId="revision_one" ports={ports} exportGate={exportGate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review Word package' }));
  await waitFor(() => expect(prepareWordPackage).toHaveBeenCalledOnce());
  const signal = vi.mocked(prepareWordPackage).mock.calls[0][3]!;
  view.rerender(<WordPackageDownload record={change === 'package' ? record('package_two') : first} revisionId={change === 'revision' ? 'revision_two' : 'revision_one'} ports={ports} exportGate={exportGate} />);
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(); });
  expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.queryByText(/Captured package:/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Review Word package' })).toBeEnabled();
});

it('suppresses an in-flight download and its approval after switching the displayed revision', async () => {
  let finish!: () => void;
  vi.mocked(renderWordPackage).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ blob: new Blob(['zip']), filename: 'captured.zip', manifest: { revisionId: 'revision_one', measured: { fileCount: 1 } } } as Awaited<ReturnType<typeof renderWordPackage>>); }));
  const first = record(), view = render(<WordPackageDownload record={first} revisionId="revision_one" ports={ports} exportGate={exportGate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review Word package' }));
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Download reviewed Word package' }));
  await waitFor(() => expect(renderWordPackage).toHaveBeenCalledOnce());
  const signal = vi.mocked(renderWordPackage).mock.calls[0][2]!;
  view.rerender(<WordPackageDownload record={first} revisionId="revision_two" ports={ports} exportGate={exportGate} />);
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(); });
  expect(triggerDownload).not.toHaveBeenCalled();expect(screen.queryByRole('checkbox')).toBeNull();
});

it('waits for cancelled conversion to finish before releasing the shared export gate', async () => {
  let finish!: () => void;
  vi.mocked(renderWordPackage).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ blob: new Blob(['zip']), filename: 'cancelled.zip', manifest: { revisionId: 'revision_one', measured: { fileCount: 1 } } } as Awaited<ReturnType<typeof renderWordPackage>>); }));
  render(<WordPackageDownload record={record()} revisionId="revision_one" ports={ports} exportGate={exportGate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review Word package' }));fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Download reviewed Word package' }));
  await waitFor(() => expect(renderWordPackage).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Word package' }));
  expect(screen.getByRole('button', { name: 'Review Word package' })).toBeDisabled();expect(exportGate.acquire()).toBeNull();
  await act(async () => { finish(); });
  expect(triggerDownload).not.toHaveBeenCalled();expect(screen.getByRole('button', { name: 'Review Word package' })).toBeEnabled();
  const release = exportGate.acquire();expect(release).not.toBeNull();release!();
});

it('keeps an ordinary export lease from being bypassed by the Word package download', async () => {
  const release = exportGate.acquire();
  try {
    render(<WordPackageDownload record={record()} revisionId="revision_one" ports={ports} exportGate={exportGate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Word package' }));fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Download reviewed Word package' }));
    await expect(screen.findByRole('alert')).resolves.toHaveTextContent('Another export is running or waiting for review');
    expect(renderWordPackage).not.toHaveBeenCalled();expect(triggerDownload).not.toHaveBeenCalled();
  } finally { release!(); }
});

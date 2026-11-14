import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChangeReportDownload } from '@/components/ChangeReportDownload';
import { getSerializedSession } from '@/stores/documentStore';
import { resolveExportDeploymentPolicy, type PolicyResolution } from '@/lib/exportDeploymentPolicy';
import { getExportDeploymentPolicy } from '@/config/classification';
import { downloadChangeReport } from '@/lib/changeReport';

vi.mock('@/config/classification', () => ({ getExportDeploymentPolicy: vi.fn() }));
vi.mock('@/lib/changeReport', async original => ({ ...await original<typeof import('@/lib/changeReport')>(), downloadChangeReport: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
const props = () => ({ before: { session: getSerializedSession(), label: 'Saved version', title: 'Saved' }, after: { session: getSerializedSession(), label: 'Current captured', title: 'Current' }, capturedAt: '2026-11-13T12:00:00.000Z', ownsDocument: () => true });
beforeEach(() => { vi.clearAllMocks();vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy); });

it('reviews removed private values before downloading the captured pair and preserves newer edits', async () => {
  const input = props();input.before.session.formData.subject = 'SSN 123-45-6789';input.after.session.formData.subject = 'Clean current';
  render(<ChangeReportDownload {...input} />);
  await userEvent.click(screen.getByRole('button', { name: 'Prepare change report' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Social Security Number');
  expect(downloadChangeReport).not.toHaveBeenCalled();
  input.after.session.formData.subject = 'Newer work';
  await userEvent.click(screen.getByRole('button', { name: 'Download reviewed report (.html)' }));
  const report = vi.mocked(downloadChangeReport).mock.calls[0][0];
  expect(report.changes.find(change => change.field.endsWith('Subject'))?.after).toBe('Clean current');
  expect(screen.getByRole('status')).toHaveTextContent('browser downloads');
  expect(input.after.session.formData.subject).toBe('Newer work');
});

it('cancels reviewed content and allows retry after a policy failure', async () => {
  vi.mocked(getExportDeploymentPolicy).mockResolvedValueOnce({ status: 'error', message: 'Policy read failed' });
  render(<ChangeReportDownload {...props()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Prepare change report' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Policy read failed');
  await userEvent.click(screen.getByRole('button', { name: 'Prepare change report' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel report' }));
  expect(downloadChangeReport).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Prepare change report' })).toBeEnabled();
});

it('rejects a document switch while policy is loading', async () => {
  let resolve!: (policy: PolicyResolution) => void;
  vi.mocked(getExportDeploymentPolicy).mockReturnValue(new Promise(finish => { resolve = finish; }));
  let owns = true;
  const view = render(<ChangeReportDownload {...props()} ownsDocument={() => owns} />);
  await userEvent.click(screen.getByRole('button', { name: 'Prepare change report' }));
  owns = false;await act(async () => resolve(policy));
  expect(screen.getByRole('alert')).toHaveTextContent('active document changed');
  view.unmount();expect(downloadChangeReport).not.toHaveBeenCalled();
});

it('ignores an old selection’s preparation after it unmounts', async () => {
  let resolve!: (policy: PolicyResolution) => void;
  vi.mocked(getExportDeploymentPolicy).mockReturnValueOnce(new Promise(finish => { resolve = finish; }));
  const view = render(<ChangeReportDownload key="old" {...props()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Prepare change report' }));
  view.rerender(<ChangeReportDownload key="new" {...props()} />);
  await act(async () => resolve(policy));
  expect(screen.queryByRole('button', { name: 'Download reviewed report (.html)' })).not.toBeInTheDocument();
  expect(downloadChangeReport).not.toHaveBeenCalled();
});

it('rejects a switched document at final download and reports delivery failures for retry', async () => {
  let owns = true;
  render(<ChangeReportDownload {...props()} ownsDocument={() => owns} />);
  await userEvent.click(screen.getByRole('button', { name: 'Prepare change report' }));
  const download = await screen.findByRole('button', { name: 'Download reviewed report (.html)' });
  owns = false;await userEvent.click(download);
  expect(screen.getByRole('alert')).toHaveTextContent('active document changed');expect(downloadChangeReport).not.toHaveBeenCalled();
  owns = true;vi.mocked(downloadChangeReport).mockImplementationOnce(() => { throw new Error('Browser delivery failed'); });
  await userEvent.click(download);
  expect(screen.getByRole('alert')).toHaveTextContent('Browser delivery failed');
  await userEvent.click(download);
  expect(screen.getByRole('status')).toHaveTextContent('browser downloads');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

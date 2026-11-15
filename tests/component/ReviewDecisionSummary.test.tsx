import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReviewDecisionSummary } from '@/components/ReviewDecisionSummary';
import { captureReviewDecisionSummary, loadReviewDecisionSummary } from '@/lib/reviewDecisionSummary';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy, type PolicyResolution } from '@/lib/exportDeploymentPolicy';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { decisionSummaryFixture } from '../_helpers/decisionSummaryFixture';

vi.mock('@/config/classification', () => ({ getExportDeploymentPolicy: vi.fn() }));
vi.mock('@/lib/reviewDecisionSummary', async original => ({ ...await original<typeof import('@/lib/reviewDecisionSummary')>(), loadReviewDecisionSummary: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
const when = '2026-11-15T05:00:00.000Z';
let roundId: string;
beforeEach(async () => {
  vi.clearAllMocks();
  const input = decisionSummaryFixture();roundId = input.round.id;
  input.state!.proposals[0].changes[0].proposed = 'Retained SSN 123-45-6789';
  vi.mocked(loadReviewDecisionSummary).mockResolvedValue(await captureReviewDecisionSummary(input, when));
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:decision-summary');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it('requires content acknowledgement and downloads the frozen reviewed HTML while preserving newer draft edits', async () => {
  const user = userEvent.setup();render(<ReviewDecisionSummary roundId={roundId} />);
  await user.click(screen.getByRole('button', { name: 'Prepare decision summary' }));
  expect(await screen.findByText(/Possible sensitive information:/)).toHaveTextContent('Social Security Number');
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  await act(async () => { useDocumentStore.getState().setField('subject', 'NEWER WORK EXCLUDED FROM SUMMARY'); });
  await user.click(screen.getByRole('button', { name: 'Download reviewed decision summary (.html)' }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
  const html = await blob.text();
  expect(html).toContain('Retained SSN 123-45-6789');expect(html).not.toContain('NEWER WORK EXCLUDED');
  expect(useDocumentStore.getState().formData.subject).toBe('NEWER WORK EXCLUDED FROM SUMMARY');
  expect(getExportDeploymentPolicy).toHaveBeenCalledTimes(2);
});

it('cancels pending policy work and ignores its late completion', async () => {
  let finish!: (value: PolicyResolution) => void;
  vi.mocked(getExportDeploymentPolicy).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup();render(<ReviewDecisionSummary roundId={roundId} />);
  await user.click(screen.getByRole('button', { name: 'Prepare decision summary' }));
  await waitFor(() => expect(getExportDeploymentPolicy).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: 'Cancel decision summary' }));
  await act(async () => finish(policy));
  expect(screen.queryByRole('button', { name: 'Download reviewed decision summary (.html)' })).not.toBeInTheDocument();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Prepare decision summary' })).toBeEnabled();
});

it('checks fresh deployment policy again at final download and keeps the capture for a retry', async () => {
  const user = userEvent.setup();render(<ReviewDecisionSummary roundId={roundId} />);
  await user.click(screen.getByRole('button', { name: 'Prepare decision summary' }));
  const download = await screen.findByRole('button', { name: 'Download reviewed decision summary (.html)' });
  vi.mocked(getExportDeploymentPolicy).mockResolvedValueOnce({ status: 'error', message: 'Deployment policy unavailable' });
  await user.click(download);
  expect(await screen.findByRole('alert')).toHaveTextContent('Deployment policy unavailable');
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  await user.click(download);
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
});

it('discards prepared and in-flight reports when another document activates', async () => {
  const user = userEvent.setup();render(<ReviewDecisionSummary roundId={roundId} />);
  await user.click(screen.getByRole('button', { name: 'Prepare decision summary' }));
  await screen.findByRole('button', { name: 'Download reviewed decision summary (.html)' });
  await act(async () => { useDocumentsStore.getState().newDocument(); });
  expect(screen.queryByRole('button', { name: 'Download reviewed decision summary (.html)' })).not.toBeInTheDocument();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

it('retains the reviewed capture after browser delivery fails and releases the failed blob URL', async () => {
  const user = userEvent.setup();render(<ReviewDecisionSummary roundId={roundId} />);
  await user.click(screen.getByRole('button', { name: 'Prepare decision summary' }));
  const download = await screen.findByRole('button', { name: 'Download reviewed decision summary (.html)' });
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error('Download blocked'); });
  await user.click(download);
  expect(await screen.findByRole('alert')).toHaveTextContent('Download blocked');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:decision-summary');
  await user.click(download);
  expect(await screen.findByText('Decision summary sent to browser downloads.')).toBeVisible();
});

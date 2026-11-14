import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewRoundsModal } from '@/components/modals/ReviewRoundsModal';
import { listReviewRounds, type ReviewRound } from '@/lib/reviewRounds';
import { buildReviewCopy, downloadReviewCopy, prepareReviewCopyExport } from '@/lib/reviewRoundActions';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { createBlankSession, useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { detectTextPII } from '@/services/pii/detector';

vi.mock('@/lib/reviewRounds', async actual => ({ ...await actual<typeof import('@/lib/reviewRounds')>(), listReviewRounds: vi.fn() }));
vi.mock('@/lib/reviewRoundActions', async actual => ({ ...await actual<typeof import('@/lib/reviewRoundActions')>(),
  initialReviewLabel: () => 'Current letter', buildReviewCopy: vi.fn(), prepareReviewCopyExport: vi.fn(), downloadReviewCopy: vi.fn() }));
vi.mock('@/config/classification', () => ({ getExportDeploymentPolicy: vi.fn() }));

const session = { ...createBlankSession(), timestamp: 1 };
const round: ReviewRound = { kind: 'dondocs-review-round', version: 1,
  id: 'review_00000000-0000-4000-8000-000000000001', createdAt: 1, label: 'Retained letter',
  sourceDocumentId: 'deleted-source', ownerDocumentId: 'deleted-source', baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session } };
const envelope = { kind: 'dondocs-review-copy' as const, version: 1 as const,
  round: { id: round.id, createdAt: 1, label: round.label, sourceDocumentId: round.sourceDocumentId, baselineDigest: round.baselineDigest }, draft: {} };
const prepared = { review: { before: { label: 'Empty', title: '', discussions: [] }, after: { label: 'Baseline', title: round.label, discussions: [] },
  changes: [], capturedAt: '1970-01-01T00:00:00.001Z', filename: 'review.json', privacy: detectTextPII([]), notices: [], marking: 'UNCLASSIFIED', customMarkings: [] } };

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: 'different-current-document' });
  useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'naval_letter' });
  vi.mocked(listReviewRounds).mockResolvedValue([structuredClone(round)]);
  vi.mocked(buildReviewCopy).mockResolvedValue(envelope);
  vi.mocked(prepareReviewCopyExport).mockReturnValue(prepared);
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(resolveExportDeploymentPolicy({ hostname: 'example.com', environment: null, runtime: { status: 'absent' } }));
});

it('keeps a deleted-source pin reachable and requires content review before download, including StrictMode', async () => {
  render(<StrictMode><ReviewRoundsModal open onOpenChange={vi.fn()} /></StrictMode>);
  expect(await screen.findByText('Retained letter')).toBeVisible();
  expect(screen.getByText(/Source unavailable/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Open baseline as new review copy' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare reviewer copy' }));
  await screen.findByRole('heading', { name: 'Check this reviewer copy before downloading' });
  expect(buildReviewCopy).toHaveBeenCalledWith(expect.objectContaining({ id: round.id }));
  expect(downloadReviewCopy).not.toHaveBeenCalled();
  expect(screen.getByText(/file is unencrypted/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Download reviewer copy' }));
  expect(downloadReviewCopy).toHaveBeenCalledWith(prepared);
});

it('does not turn a failed inventory read into an empty successful review list', async () => {
  vi.mocked(listReviewRounds).mockRejectedValueOnce(new Error('Synthetic storage failure'));
  render(<ReviewRoundsModal open onOpenChange={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be read completely');
  expect(screen.queryByText('No review baselines saved yet.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start review from current draft' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry saved reviews' }));
  await waitFor(() => expect(screen.getByText('Retained letter')).toBeVisible());
});

it('still exposes retained native review copies while a form is active', async () => {
  useDocumentStore.setState({ documentCategory: 'forms' });
  render(<ReviewRoundsModal open onOpenChange={vi.fn()} />);
  await screen.findByText('Retained letter');
  expect(screen.getByRole('button', { name: 'Start review from current draft' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Prepare reviewer copy' })).toBeEnabled();
});

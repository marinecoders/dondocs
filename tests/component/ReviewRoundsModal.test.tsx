import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReviewRoundsModal } from '@/components/modals/ReviewRoundsModal';
import { listReviewRounds, type ReviewRound } from '@/lib/reviewRounds';
import { buildReviewCopy, downloadReviewCopy, prepareReviewCopyExport } from '@/lib/reviewRoundActions';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { createBlankSession, useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { detectTextPII } from '@/services/pii/detector';
import { captureReviewDecisionSummary, loadReviewDecisionSummary, type DecisionSummaryCapture } from '@/lib/reviewDecisionSummary';
import userEvent from '@testing-library/user-event';
import { loadReviewSuggestionWorkspace } from '@/lib/reviewSuggestionActions';
import { decisionSummaryFixture } from '../_helpers/decisionSummaryFixture';

vi.mock('@/lib/reviewRounds', async actual => ({ ...await actual<typeof import('@/lib/reviewRounds')>(), listReviewRounds: vi.fn(), readReviewCopyLink: vi.fn(async () => null) }));
vi.mock('@/lib/reviewRoundActions', async actual => ({ ...await actual<typeof import('@/lib/reviewRoundActions')>(),
  initialReviewLabel: () => 'Current letter', buildReviewCopy: vi.fn(), prepareReviewCopyExport: vi.fn(), downloadReviewCopy: vi.fn() }));
vi.mock('@/config/classification', () => ({ getExportDeploymentPolicy: vi.fn() }));
vi.mock('@/lib/reviewDecisionSummary', async actual => ({ ...await actual<typeof import('@/lib/reviewDecisionSummary')>(), loadReviewDecisionSummary: vi.fn() }));

vi.mock('@/lib/reviewSuggestionActions', async actual => ({ ...await actual<typeof import('@/lib/reviewSuggestionActions')>(), loadReviewSuggestionWorkspace: vi.fn() }));

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
  await waitFor(() => expect(downloadReviewCopy).toHaveBeenCalledWith(prepared, expect.objectContaining({ status: 'ready' })));
  expect(getExportDeploymentPolicy).toHaveBeenCalledTimes(2);
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

it('does not download an older prepared copy when the active document changes during the fresh policy read', async () => {
  render(<ReviewRoundsModal open onOpenChange={vi.fn()} />);
  await screen.findByText('Retained letter');
  fireEvent.click(screen.getByRole('button', { name: 'Prepare reviewer copy' }));
  await screen.findByRole('heading', { name: 'Check this reviewer copy before downloading' });
  let release!: (policy: Awaited<ReturnType<typeof getExportDeploymentPolicy>>) => void;
  vi.mocked(getExportDeploymentPolicy).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Download reviewer copy' }));
  await waitFor(() => expect(getExportDeploymentPolicy).toHaveBeenCalledTimes(2));
  useDocumentsStore.setState({ currentId: 'another-current-document' });
  release(resolveExportDeploymentPolicy({ hostname: 'example.com', environment: null, runtime: { status: 'absent' } }));
  expect(await screen.findByRole('alert')).toHaveTextContent('draft changed');
  expect(downloadReviewCopy).not.toHaveBeenCalled();
});

it('keeps other actions disabled when canceling an idle prepared summary while another round is preparing', async () => {
  const workspace = decisionSummaryFixture();
  workspace.round.label = 'First summary round';
  const second = { ...structuredClone(workspace.round), id: `review_${crypto.randomUUID()}`, label: 'Second summary round' };
  vi.mocked(listReviewRounds).mockResolvedValue([workspace.round, second]);
  const capture = await captureReviewDecisionSummary(workspace, '2026-11-15T05:00:00.000Z');
  vi.mocked(loadReviewDecisionSummary).mockResolvedValueOnce(capture);
  render(<ReviewRoundsModal open onOpenChange={vi.fn()} />);
  const firstArticle = await screen.findByRole('article', { name: 'Review First summary round' });
  const secondArticle = screen.getByRole('article', { name: 'Review Second summary round' });
  expect(screen.getAllByRole('group', { name: 'Review decision summary' })).toHaveLength(2);
  expect(within(firstArticle).getByRole('group', { name: 'Review decision summary' })).toBeVisible();
  expect(within(secondArticle).getByRole('group', { name: 'Review decision summary' })).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Review decision summary' })).not.toBeInTheDocument();
  fireEvent.click(within(firstArticle).getByRole('button', { name: 'Prepare decision summary' }));
  await within(firstArticle).findByRole('button', { name: 'Download reviewed decision summary (.html)' });
  let finish!: (value: DecisionSummaryCapture) => void;
  vi.mocked(loadReviewDecisionSummary).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  fireEvent.click(within(secondArticle).getByRole('button', { name: 'Prepare decision summary' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh review rounds' })).toBeDisabled());
  fireEvent.click(within(firstArticle).getByRole('button', { name: 'Cancel decision summary' }));
  expect(screen.getByRole('button', { name: 'Refresh review rounds' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Review for comparison checkpoint' })).toBeDisabled();
  expect(within(firstArticle).getByRole('button', { name: 'Prepare decision summary' })).toBeDisabled();
  expect(within(firstArticle).getByRole('button', { name: 'Close review' })).toBeDisabled();
  for (const button of screen.getAllByRole('button', { name: 'Prepare reviewer copy' })) expect(button).toBeDisabled();
  expect(within(secondArticle).getByText('Checking captured summary contents…')).toBeVisible();
  fireEvent.click(within(secondArticle).getByRole('button', { name: 'Cancel decision summary' }));
  expect(screen.getByRole('button', { name: 'Refresh review rounds' })).toBeEnabled();
  expect(screen.getByRole('combobox', { name: 'Review for comparison checkpoint' })).toBeEnabled();
  await act(async () => finish(capture));
  expect(screen.queryByRole('button', { name: 'Download reviewed decision summary (.html)' })).not.toBeInTheDocument();
});

it('keeps unsaved typed changes reachable when closing, switching rounds or preparing feedback', async () => {
  const workspace = decisionSummaryFixture();workspace.state = null;
  vi.mocked(listReviewRounds).mockResolvedValue([workspace.round]);
  vi.mocked(loadReviewSuggestionWorkspace).mockResolvedValue(workspace);
  const close = vi.fn();render(<ReviewRoundsModal open onOpenChange={close} />);
  await screen.findByRole('heading', { name: workspace.round.label });
  await userEvent.selectOptions(screen.getByLabelText('Review for suggested edits'), workspace.round.id);
  await userEvent.click(await screen.findByRole('button', { name: 'Suggest Changes mode' }));
  await userEvent.selectOptions(screen.getByLabelText('Paragraph for suggested typing'), 'first');
  const editor = screen.getByRole('textbox', { name: 'Suggested paragraph text' }) as HTMLTextAreaElement;
  editor.focus();editor.setSelectionRange(0, 0);fireEvent.select(editor);await userEvent.keyboard('Unsaved ');
  expect(screen.getByLabelText('Review for suggested edits')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Prepare feedback return' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Prepare reviewer copy' })).toBeDisabled();
  await userEvent.keyboard('{Escape}');expect(close).not.toHaveBeenCalled();expect(editor).toHaveValue('Unsaved First body.');
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));expect(close).not.toHaveBeenCalled();
  const palette = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });window.dispatchEvent(palette);expect(palette.defaultPrevented).toBe(true);
  const template = new KeyboardEvent('keydown', { key: 'T', ctrlKey: true, shiftKey: true, cancelable: true });window.dispatchEvent(template);expect(template.defaultPrevented).toBe(true);
  const unload = new Event('beforeunload', { cancelable: true });window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Cancel typed changes' }));
  expect(screen.getByLabelText('Review for suggested edits')).toBeEnabled();
  const cleanUnload = new Event('beforeunload', { cancelable: true });window.dispatchEvent(cleanUnload);expect(cleanUnload.defaultPrevented).toBe(false);
  await userEvent.keyboard('{Escape}');expect(close).toHaveBeenCalledWith(false);
});

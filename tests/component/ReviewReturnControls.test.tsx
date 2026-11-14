import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewReturnControls } from '@/components/ReviewReturnControls';
import { readReviewCopyLink } from '@/lib/reviewRounds';
import { applyReviewReturn, downloadReviewReturn, prepareReviewReturnExport, prepareReviewReturnImport, reviewReturnPlan } from '@/lib/reviewReturnActions';
import { flushPendingReviewWrites } from '@/stores/documentsStore';
import { detectTextPII } from '@/services/pii/detector';

vi.mock('@/lib/reviewRounds', async original => ({ ...await original<typeof import('@/lib/reviewRounds')>(), readReviewCopyLink: vi.fn() }));
vi.mock('@/lib/reviewReturnActions', () => ({ applyReviewReturn: vi.fn(), downloadReviewReturn: vi.fn(), prepareReviewReturnExport: vi.fn(),
  prepareReviewReturnImport: vi.fn(), reviewReturnPlan: vi.fn(), reviewReturnTargetLabel: () => 'Detached paragraph' }));
vi.mock('@/stores/documentsStore', () => ({ useDocumentsStore: (select: (state: { currentId: string }) => unknown) => select({ currentId: 'owner' }), flushPendingReviewWrites: vi.fn() }));
const message = { id: 'message', author: 'Example reviewer', text: 'Complete returned feedback', createdAt: '2026-11-13T00:00:00Z' };
const comments = { version: 1 as const, threads: [{ id: 'thread', anchor: { kind: 'document' as const }, resolved: false, messages: [message] }] };
const safety = { marking: 'UNCLASSIFIED', customMarkings: [], notices: [], privacy: detectTextPII([]) };
const conflict = { id: 'message:thread:message', kind: 'message' as const, threadId: 'thread', messageId: 'message', baseline: message,
  current: { ...message, text: 'Newer local correction' }, returned: { ...message, text: 'Returned correction' } };
const plan = { status: 'conflict' as const, comments, conflicts: [conflict], addedThreads: 0, changedThreads: 1, removedThreads: 0 };
const prepared = { ...safety, roundLabel: 'November letter', createdAt: 1, currentMarking: 'UNCLASSIFIED', alreadyImported: false, comments, plan };
function upload() {
  const file = new File(['{}'], 'feedback.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => '{}' });
  fireEvent.change(screen.getByLabelText('Import feedback return'), { target: { files: [file] } });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readReviewCopyLink).mockResolvedValue({ documentId: 'owner', roundId: 'review', baselineDigest: 'a'.repeat(64) });
  vi.mocked(prepareReviewReturnExport).mockResolvedValue({ ...safety, roundLabel: 'November letter', comments } as unknown as Awaited<ReturnType<typeof prepareReviewReturnExport>>);
  vi.mocked(prepareReviewReturnImport).mockResolvedValue(prepared as unknown as Awaited<ReturnType<typeof prepareReviewReturnImport>>);
  vi.mocked(reviewReturnPlan).mockReturnValue({ ...plan, status: 'ready' });
  vi.mocked(applyReviewReturn).mockResolvedValue('committed');vi.mocked(flushPendingReviewWrites).mockResolvedValue();
});
it('shows complete outgoing discussions and requires a reviewed download action', async () => {
  render(<ReviewReturnControls disabled={false} onBusyChange={vi.fn()} />);
  const prepare = screen.getByRole('button', { name: 'Prepare feedback return' });
  await waitFor(() => expect(prepare).toBeEnabled());fireEvent.click(prepare);
  await screen.findByRole('heading', { name: 'Review feedback before downloading' });
  expect(downloadReviewReturn).not.toHaveBeenCalled();expect(screen.getByText(/unencrypted JSON/)).toBeVisible();
  fireEvent.click(screen.getByText('Outgoing discussions (1)'));expect(screen.getByText('Complete returned feedback')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Download feedback return' }));
  expect(downloadReviewReturn).toHaveBeenCalledOnce();expect(screen.getByRole('status')).toHaveTextContent('browser downloads');
});
it('holds import until every conflicting update has a deliberate choice and keeps full versions readable', async () => {
  render(<ReviewReturnControls disabled={false} onBusyChange={vi.fn()} />);upload();
  await screen.findByRole('heading', { name: 'November letter' });
  const apply = screen.getByRole('button', { name: 'Import reviewed feedback' });expect(apply).toBeDisabled();
  expect(screen.getByRole('region', { name: 'Conflict 1 current' })).toHaveTextContent('Newer local correction');
  expect(screen.getByRole('region', { name: 'Conflict 1 returned' })).toHaveTextContent('Returned correction');
  fireEvent.click(screen.getByRole('radio', { name: 'Keep current' }));expect(apply).toBeEnabled();
  fireEvent.click(apply);await waitFor(() => expect(applyReviewReturn).toHaveBeenCalledWith(prepared, { [conflict.id]: 'current' }));
  expect(await screen.findByText(/Feedback imported/)).toBeVisible();
});
it('keeps a failed receipt visible and retries the existing queued feedback instead of importing twice', async () => {
  vi.mocked(prepareReviewReturnImport).mockResolvedValue({ ...prepared, plan: { ...plan, conflicts: [], status: 'ready' } } as unknown as Awaited<ReturnType<typeof prepareReviewReturnImport>>);
  vi.mocked(applyReviewReturn).mockResolvedValue('pending');
  render(<ReviewReturnControls disabled={false} onBusyChange={vi.fn()} />);upload();
  fireEvent.click(await screen.findByRole('button', { name: 'Import reviewed feedback' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry feedback save' }));
  expect(await screen.findByText('Review feedback committed to its document.')).toBeVisible();
  expect(flushPendingReviewWrites).toHaveBeenCalledOnce();expect(applyReviewReturn).toHaveBeenCalledOnce();
});
it('rejects an oversized file before parsing or mutating any draft', async () => {
  render(<ReviewReturnControls disabled={false} onBusyChange={vi.fn()} />);
  const file = new File(['{}'], 'large.json');Object.defineProperty(file, 'size', { value: 2_097_153 });
  fireEvent.change(screen.getByLabelText('Import feedback return'), { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('limited to 2 MB');expect(prepareReviewReturnImport).not.toHaveBeenCalled();expect(applyReviewReturn).not.toHaveBeenCalled();
});
it('does not publish a preview that finishes after the review screen closes', async () => {
  let finish!: (value: Awaited<ReturnType<typeof prepareReviewReturnImport>>) => void;
  vi.mocked(prepareReviewReturnImport).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const busy = vi.fn(), view = render(<ReviewReturnControls disabled={false} onBusyChange={busy} />);upload();
  await waitFor(() => expect(prepareReviewReturnImport).toHaveBeenCalledOnce());view.unmount();
  finish(prepared as unknown as Awaited<ReturnType<typeof prepareReviewReturnImport>>);
  expect(busy).toHaveBeenLastCalledWith(false);expect(applyReviewReturn).not.toHaveBeenCalled();
});
it.each(['download', 'import'] as const)('keeps the next review name focused after a completed feedback %s', async operation => {
  const frames: FrameRequestCallback[] = [];
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback);return frames.length; });
  try {
    function ReviewWithName() {
      const [busy, setBusy] = useState(false);
      return <><label>Review name<input disabled={busy} /></label><ReviewReturnControls disabled={false} onBusyChange={setBusy} /></>;
    }
    if (operation === 'import') vi.mocked(prepareReviewReturnImport).mockResolvedValue({ ...prepared, plan: { ...plan, conflicts: [], status: 'ready' } } as unknown as Awaited<ReturnType<typeof prepareReviewReturnImport>>);
    render(<ReviewWithName />);
    if (operation === 'download') {
      const prepare = screen.getByRole('button', { name: 'Prepare feedback return' });
      await waitFor(() => expect(prepare).toBeEnabled());fireEvent.click(prepare);
      fireEvent.click(await screen.findByRole('button', { name: 'Download feedback return' }));
      expect(screen.getByRole('status')).toHaveTextContent('browser downloads');
    } else {
      upload();
      const apply = await screen.findByRole('button', { name: 'Import reviewed feedback' });
      await waitFor(() => expect(apply).toBeEnabled());fireEvent.click(apply);
      await screen.findByText('Feedback imported. Use Undo to restore the previous discussions.');
    }
    const name = screen.getByRole('textbox', { name: 'Review name' });
    await waitFor(() => expect(name).toBeEnabled());
    expect(screen.getByRole('status')).toHaveFocus();name.focus();
    act(() => { for (const callback of frames.splice(0)) callback(performance.now()); });
    expect(name).toHaveFocus();
  } finally { raf.mockRestore(); }
});

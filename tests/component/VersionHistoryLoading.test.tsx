import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VersionHistoryModal } from '@/components/modals/VersionHistoryModal';
import { idbReadSnapshots, type DocSnapshot } from '@/lib/documentsDb';
import { getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/lib/documentsDb', async (original) => ({ ...await original<typeof import('@/lib/documentsDb')>(), idbReadSnapshots: vi.fn() }));
const read = vi.mocked(idbReadSnapshots);
const snapshot = (): DocSnapshot => ({ ts: 1, session: getSerializedSession() });
const deferred = () => {
  let resolve!: (value: DocSnapshot[]) => void;
  const promise = new Promise<DocSnapshot[]>((r) => { resolve = r; });
  return { promise, resolve };
};
beforeEach(() => { read.mockReset(); useUIStore.setState({ historyDocId: 'first' }); });

it('shows loading, then genuine empty history', async () => {
  const pending = deferred(); read.mockReturnValueOnce(pending.promise);
  render(<VersionHistoryModal />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading saved versions');
  expect(screen.queryByText(/No saved versions yet/)).not.toBeInTheDocument();
  await act(async () => pending.resolve([]));
  expect(screen.getByText(/No saved versions yet/)).toBeVisible();
});

it('shows read failure and retries without changing the current document', async () => {
  const current = getSerializedSession();
  read.mockRejectedValueOnce(new Error('Storage blocked')).mockResolvedValueOnce([snapshot()]);
  render(<VersionHistoryModal />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load saved versions');
  expect(screen.queryByText(/No saved versions yet/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Compare' })).toBeVisible();
  expect(getSerializedSession().formData).toEqual(current.formData);
});

it('clears previous versions and comparison when the document changes', async () => {
  const pending = deferred();
  read.mockResolvedValueOnce([snapshot()]).mockReturnValueOnce(pending.promise);
  render(<VersionHistoryModal />);
  await userEvent.click(await screen.findByRole('button', { name: 'Compare' }));
  expect(screen.getByRole('button', { name: 'Restore selected version' })).toBeVisible();
  act(() => useUIStore.setState({ historyDocId: 'second' }));
  expect(screen.getByRole('status')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Restore selected version' })).not.toBeInTheDocument();
  await act(async () => pending.resolve([]));
  expect(screen.getByText(/No saved versions yet/)).toBeVisible();
});

it('ignores a late response for another document', async () => {
  const old = deferred();
  read.mockReturnValueOnce(old.promise).mockResolvedValueOnce([]);
  render(<VersionHistoryModal />);
  act(() => useUIStore.setState({ historyDocId: 'second' }));
  await screen.findByText(/No saved versions yet/);
  await act(async () => old.resolve([snapshot()]));
  expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument();
});

it('preserves the safety-copy failure message and keeps history open', async () => {
  read.mockResolvedValueOnce([snapshot()]);
  const restore = vi.spyOn(useDocumentsStore.getState(), 'restoreSnapshot').mockResolvedValueOnce(false);
  useDocumentsStore.setState({ currentId: 'first' });
  try {
    render(<VersionHistoryModal />);
    await userEvent.click(await screen.findByRole('button', { name: 'Compare' }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore selected version' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save a safety copy");
    expect(useUIStore.getState().historyDocId).toBe('first');
  } finally { restore.mockRestore(); }
});

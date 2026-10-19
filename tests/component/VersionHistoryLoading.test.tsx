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
  expect(await screen.findByRole('button', { name: /Compare version/ })).toBeVisible();
  expect(getSerializedSession().formData).toEqual(current.formData);
});

it('clears previous versions and comparison when the document changes', async () => {
  const pending = deferred();
  read.mockResolvedValueOnce([snapshot()]).mockReturnValueOnce(pending.promise);
  render(<VersionHistoryModal />);
  await userEvent.click(await screen.findByRole('button', { name: /Compare version/ }));
  expect(screen.getByRole('button', { name: 'Restore selected version' })).toBeVisible();
  act(() => useUIStore.setState({ historyDocId: 'second' }));
  expect(screen.getByRole('status')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Compare version/ })).not.toBeInTheDocument();
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
  expect(screen.queryByRole('button', { name: /Compare version/ })).not.toBeInTheDocument();
});

it('preserves the safety-copy failure message and keeps history open', async () => {
  read.mockResolvedValueOnce([snapshot()]);
  const restore = vi.spyOn(useDocumentsStore.getState(), 'restoreSnapshot').mockResolvedValueOnce(false);
  useDocumentsStore.setState({ currentId: 'first' });
  try {
    render(<VersionHistoryModal />);
    await userEvent.click(await screen.findByRole('button', { name: /Compare version/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore selected version' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save a safety copy");
    expect(useUIStore.getState().historyDocId).toBe('first');
  } finally { restore.mockRestore(); }
});


it('selects and compares versions without saving or restoring them', async () => {
  const first = snapshot();
  const second = { ...snapshot(), ts: 2 };
  first.session.formData.subject = 'Earlier subject';
  second.session.formData.subject = 'Another subject';
  read.mockResolvedValueOnce([second, first]);
  const save = vi.spyOn(useDocumentsStore.getState(), 'saveCurrent');
  const restore = vi.spyOn(useDocumentsStore.getState(), 'restoreSnapshot');
  const current = getSerializedSession();
  try {
    render(<VersionHistoryModal />);
    const buttons = await screen.findAllByRole('button', { name: /Compare version/ });
    await userEvent.click(buttons[0]);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(buttons[1]);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Version comparison' })).toHaveTextContent('Earlier subject');
    expect(save).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(getSerializedSession().formData).toEqual(current.formData);
  } finally { save.mockRestore(); restore.mockRestore(); }
});

it('only restores the selected version and closes after successful restoration', async () => {
  const saved = snapshot();
  read.mockResolvedValueOnce([saved]);
  const restore = vi.spyOn(useDocumentsStore.getState(), 'restoreSnapshot').mockResolvedValueOnce(true);
  useDocumentsStore.setState({ currentId: 'first' });
  try {
    render(<VersionHistoryModal />);
    await userEvent.click(await screen.findByRole('button', { name: /Compare version/ }));
    expect(restore).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Restore selected version' }));
    expect(restore).toHaveBeenCalledExactlyOnceWith(saved.session);
    expect(useUIStore.getState().historyDocId).toBeNull();
  } finally { restore.mockRestore(); }
});

it('uses the mobile picker to compare without changing the current document', async () => {
  const saved = snapshot();
  saved.session.formData.subject = 'Mobile saved version';
  read.mockResolvedValueOnce([saved]);
  const current = getSerializedSession();
  render(<VersionHistoryModal />);
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Saved version' }), '0');
  expect(screen.getByRole('region', { name: 'Version comparison' })).toHaveTextContent('Mobile saved version');
  expect(getSerializedSession().formData).toEqual(current.formData);
});

it('recovers controls after an unexpected restore rejection', async () => {
  read.mockResolvedValueOnce([snapshot()]);
  const restore = vi.spyOn(useDocumentsStore.getState(), 'restoreSnapshot').mockRejectedValueOnce(new Error('Storage unavailable'));
  useDocumentsStore.setState({ currentId: 'first' });
  try {
    render(<VersionHistoryModal />);
    await userEvent.click(await screen.findByRole('button', { name: /Compare version/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore selected version' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t finish restoring');
    expect(screen.getByRole('button', { name: 'Restore selected version' })).toBeEnabled();
    expect(useUIStore.getState().historyDocId).toBe('first');
  } finally { restore.mockRestore(); }
});

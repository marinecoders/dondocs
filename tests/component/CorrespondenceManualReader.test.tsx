import { readFile } from 'node:fs/promises';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import Reader from '@/components/manual/CorrespondenceManualReader';
import { CORRESPONDENCE_MANUAL as source, loadManualResource } from '@/lib/correspondenceManual';
import { useCorrespondenceManualStore, openCorrespondenceManual } from '@/stores/correspondenceManualStore';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/lib/correspondenceManual', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/correspondenceManual')>(), loadManualResource: vi.fn() }));
const bytes = new Uint8Array(await readFile(`public/${source.textPath}`));
beforeEach(() => {
  vi.mocked(loadManualResource).mockReset().mockResolvedValue({ bytes, cached: true });
  useCorrespondenceManualStore.setState({ location: { chapter: 2, paragraph: '19' }, request: 0 });
});

it('opens the real cited page and searches actual source text without changing a draft', async () => {
  const user = userEvent.setup();render(<Reader />);
  expect(await screen.findByRole('heading', { name: /Page 2-12/ })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Manual text page 2-12' })).toHaveTextContent('19. Proofreading.');
  expect(screen.getByRole('region', { name: 'Manual text page 2-12' }).querySelector('mark')).toHaveTextContent('19. Proofreading.');
  expect(screen.getByText(/currentness has not been established/)).toBeVisible();
  await user.type(screen.getByRole('searchbox', { name: 'Search manual' }), 'Are enclosure markings correct?');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await user.click(screen.getByRole('button', { name: /Page 2-12 · PDF page 28/ }));
  expect(screen.getByRole('region', { name: 'Manual text page 2-12' }).querySelector('mark')).toHaveTextContent('Are enclosure markings correct?');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Chapter or appendix' }), '12');
  expect(screen.getByRole('heading', { name: /Executive Correspondence · Page 12-1/ })).toBeVisible();
});

it('keeps resource failures recoverable and describes unavailable caching', async () => {
  const user = userEvent.setup();vi.mocked(loadManualResource).mockRejectedValueOnce(new Error('Offline manual missing'));
  render(<Reader />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline manual missing');
  vi.mocked(loadManualResource).mockResolvedValue({ bytes, cached: false });
  await user.click(screen.getByRole('button', { name: 'Retry manual' }));
  expect(await screen.findByText(/persistent offline storage is unavailable/)).toBeVisible();
});

it('cancels a pending PDF when a new source link is opened', async () => {
  const user = userEvent.setup();let pendingSignal: AbortSignal | undefined;
  vi.mocked(loadManualResource).mockImplementation(async (kind, signal) => {
    if (kind === 'text') return { bytes, cached: true };
    pendingSignal = signal;return new Promise(() => {});
  });
  render(<Reader />);
  await user.click(await screen.findByRole('button', { name: 'View original PDF page 28' }));
  expect(screen.getByText('Loading original PDF…')).toBeVisible();
  act(() => openCorrespondenceManual({ chapter: 7, paragraph: '9' }));
  await waitFor(() => expect(pendingSignal?.aborted).toBe(true));
  expect(screen.queryByText('Loading original PDF…')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Chapter or appendix' })).toHaveValue('7');
  expect(useUIStore.getState()).toMatchObject({ documentGuideOpen: true, documentGuideTab: 'manual' });
});

it('aborts an outstanding text request on close', () => {
  let signal: AbortSignal | undefined;
  vi.mocked(loadManualResource).mockImplementation((_kind, value) => { signal = value;return new Promise(() => {}); });
  const { unmount } = render(<Reader />);unmount();
  expect(signal?.aborted).toBe(true);
});


it('does not steal focus chosen after page navigation but before its frame commits', async () => {
  const frames: FrameRequestCallback[] = [];
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback);return frames.length; });
  try {
    render(<Reader />);
    await screen.findByRole('heading', { name: /Page 2-12/ });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    const search = screen.getByRole('searchbox', { name: 'Search manual' });
    search.focus();
    act(() => { for (const callback of frames.splice(0)) callback(0); });
    expect(search).toHaveFocus();
  } finally { frame.mockRestore(); }
});

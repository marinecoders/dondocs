import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { usePackageEditorNavigation } from '@/components/usePackageEditorNavigation';

it('keeps the editor usable after a rejected switch and accepts only one destination per save', async () => {
  let finish!: (saved: boolean) => void;
  const flush = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const { result } = renderHook(() => usePackageEditorNavigation(flush));
  const failed = vi.fn().mockRejectedValue(new Error('Document unavailable'));
  const other = vi.fn();
  let first!: Promise<void>;
  act(() => { first = result.current.navigate(failed); void result.current.navigate(other); });
  expect(flush).toHaveBeenCalledTimes(1);
  await act(async () => { finish(true); await first; });
  expect(result.current.navigationError).toBe('Document unavailable');
  expect(result.current.navigating).toBe(false);
  expect(other).not.toHaveBeenCalled();
  flush.mockResolvedValueOnce(false);
  await act(() => result.current.navigate(other));
  expect(other).not.toHaveBeenCalled();
  flush.mockResolvedValueOnce(true);
  await act(() => result.current.navigate(other));
  expect(other).toHaveBeenCalledOnce();
  expect(result.current.navigationError).toBe('');
});

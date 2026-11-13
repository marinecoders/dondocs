import { afterEach, expect, it, vi } from 'vitest';
import { triggerDownload } from '@/lib/encoding';

afterEach(() => { vi.restoreAllMocks();vi.useRealTimers();document.querySelectorAll('a[download]').forEach(anchor => anchor.remove()); });

it('keeps a successful download URL alive until the browser has had time to consume it', () => {
  vi.useFakeTimers();
  const blob = new Blob(['ZIP bytes'], { type: 'application/zip' });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:zip');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.isConnected).toBe(true);
    expect(this.download).toBe('batch.zip');
    expect(this.href).toBe('blob:zip');
  });
  triggerDownload(blob, 'batch.zip');
  expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
  expect(document.querySelector('a[download]')).toBeNull();
  vi.advanceTimersByTime(9999);
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:zip');
});

it.each(['append', 'click'] as const)('reclaims the URL and hidden link when %s fails', phase => {
  vi.useFakeTimers();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:zip');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  if (phase === 'append') vi.spyOn(document.body, 'appendChild').mockImplementation(() => { throw new Error('Blocked'); });
  else vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('Blocked'); });
  expect(() => triggerDownload(new Blob(['ZIP bytes']), 'batch.zip')).toThrow('Blocked');
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:zip');
  expect(document.querySelector('a[download]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

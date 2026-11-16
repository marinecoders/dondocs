import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ download: vi.fn(), reserve: vi.fn() }));
vi.mock('@/utils/downloadPdf', () => ({ downloadPdfBlob: mocks.download, preOpenWindowForIOS: mocks.reserve }));
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';

beforeEach(() => { vi.clearAllMocks(); });
it('reserves a PDF window synchronously and transfers it only on successful delivery', async () => {
  const popup = { close: vi.fn(), closed: false };mocks.reserve.mockReturnValue(popup);mocks.download.mockResolvedValue(true);
  const lease = reserveSigningPdfDownload();expect(mocks.reserve).toHaveBeenCalledOnce();
  await expect(lease.deliver(new Uint8Array([1, 2]), 'Exact.pdf')).resolves.toBe(true);
  expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), 'Exact.pdf', popup);
  lease.release();expect(popup.close).not.toHaveBeenCalled();
  await expect(lease.deliver(new Uint8Array([1]), 'Again.pdf')).rejects.toThrow('no longer');
});
it('closes an unused or failed PDF window on cancellation', async () => {
  const popup = { close: vi.fn(), closed: false };mocks.reserve.mockReturnValue(popup);mocks.download.mockResolvedValue(false);
  const lease = reserveSigningPdfDownload();await lease.deliver(new Uint8Array([1]), 'Failed.pdf');lease.release();
  expect(popup.close).toHaveBeenCalledOnce();
  const unused = reserveSigningPdfDownload();unused.release();expect(popup.close).toHaveBeenCalledTimes(2);
});

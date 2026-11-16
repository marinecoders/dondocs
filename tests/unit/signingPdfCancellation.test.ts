import { afterEach, expect, it, vi } from 'vitest';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('does not reopen an iOS PDF tab after its lease is released during FileReader preparation', async () => {
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/135.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 0 });
  const target = { document: document.implementation.createHTMLDocument(), opener: window, closed: false, close() { this.closed = true; } };
  const open = vi.spyOn(window, 'open').mockReturnValue(target as unknown as Window);
  const lease = reserveSigningPdfDownload();
  const delivery = lease.deliver(new TextEncoder().encode('%PDF-1.7\nRetained bytes'), 'cancelled.pdf');
  lease.release();
  expect(await delivery).toBe(false);
  expect(open).toHaveBeenCalledOnce();
  expect(target.document.querySelector('iframe')).toBeNull();
});

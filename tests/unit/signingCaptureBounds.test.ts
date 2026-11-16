import { expect, it, vi } from 'vitest';
import { captureSigningPdf } from '@/lib/signingWorkspace';
import { MAX_SIGNING_PDF_BYTES } from '@/lib/manualSignatureFields';

it('rejects an oversized signing source before copying its PDF bytes', async () => {
  const oversized = new Uint8Array(MAX_SIGNING_PDF_BYTES + 1);
  const Native = Uint8Array;
  let copies = 0;
  vi.stubGlobal('Uint8Array', new Proxy(Native, {
    construct(target, args) { if (args[0] === oversized) copies++; return Reflect.construct(target, args); },
  }));
  try {
    await expect(captureSigningPdf(oversized, 'oversized.pdf')).rejects.toThrow('20 MB');
    expect(copies).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});

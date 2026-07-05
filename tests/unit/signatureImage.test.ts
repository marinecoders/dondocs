// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { loadSignatureAsPngBase64 } from '@/lib/signatureImage';

// The JPG/GIF→PNG canvas re-encode needs a real 2D canvas (unavailable in
// happy-dom) and is verified in the browser. Here we lock in the PNG
// pass-through: a PNG upload must be stored verbatim, not round-tripped.
describe('loadSignatureAsPngBase64 — PNG pass-through', () => {
  it('returns the input bytes as base64 for a PNG upload', async () => {
    // PNG magic bytes + a little payload.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const file = new File([bytes], 'signature.png', { type: 'image/png' });

    const b64 = await loadSignatureAsPngBase64(file);

    const decoded = atob(b64);
    expect(decoded.length).toBe(bytes.length);
    // Still a PNG (magic byte intact) — proves no re-encode happened.
    expect(decoded.charCodeAt(0)).toBe(0x89);
    expect(decoded.charCodeAt(1)).toBe(0x50);
  });
});

import { describe, expect, it } from 'vitest';
import { readSignatureGraphic } from '@/lib/signatureGraphic';

function pngHeader(width: number, height: number, chunk?: number): File {
  const bytes = new Uint8Array(chunk ? 45 : 33);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a);
  view.setUint32(8, 13); view.setUint32(12, 0x49484452);
  view.setUint32(16, width); view.setUint32(20, height);
  if (chunk) view.setUint32(37, chunk);
  return new File([bytes], 'graphic.png', { type: 'image/png' });
}

describe('signature graphic input bounds', () => {
  it('rejects renamed files before invoking an image decoder', async () => {
    await expect(readSignatureGraphic(new File([new Uint8Array(33)], 'file.png'))).rejects.toThrow('Choose a PNG image.');
  });
  it('rejects oversized and animated rasters before decoding', async () => {
    await expect(readSignatureGraphic(pngHeader(4000, 4000))).rejects.toThrow('smaller PNG');
    await expect(readSignatureGraphic(pngHeader(1, 1, 0x6163544c))).rejects.toThrow('still PNG');
  });
});

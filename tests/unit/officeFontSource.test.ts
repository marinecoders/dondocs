import { afterEach, expect, it, vi } from 'vitest';
import { loadLocalOfficeFonts, OFFICE_FONT_FILES } from '@/services/officeFonts';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('shares one font load, retries a failed load, and gives renderers independent buffers', async () => {
  const fetchFont = vi.fn(async () => new Response(new Uint8Array([12, 34])));
  vi.stubGlobal('fetch', fetchFont);
  vi.stubEnv('VITE_LOCAL_OFFICE_FONTS', '0');
  expect(loadLocalOfficeFonts()).toBeUndefined();
  expect(fetchFont).not.toHaveBeenCalled();

  vi.stubEnv('VITE_LOCAL_OFFICE_FONTS', '1');
  fetchFont.mockResolvedValueOnce(new Response(null, { status: 503 }));
  const failed = loadLocalOfficeFonts();
  expect(loadLocalOfficeFonts()).toBe(failed);
  await expect(failed).rejects.toThrow('Could not load local PDF font asset');

  const retry = loadLocalOfficeFonts();
  expect(loadLocalOfficeFonts()).toBe(retry);
  const source = await retry;
  if (!source) throw new Error('Expected an enabled font source');
  expect(fetchFont).toHaveBeenCalledTimes(OFFICE_FONT_FILES.length * 2);
  const rendererBytes = source.readFace('times', 'bold');
  rendererBytes.fill(0);
  structuredClone(rendererBytes, { transfer: [rendererBytes.buffer] });
  expect(source.readFace('times', 'bold')).toEqual(new Uint8Array([12, 34]));
});

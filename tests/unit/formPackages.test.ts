import { it, expect, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { loadPackagePage, packageAvailableOffline } from '@/services/forms/packages';
import { fixtureDefinition, fixturePage } from '../_helpers/formFixture';

afterEach(() => vi.unstubAllGlobals());
it('verifies template bytes and refuses a stale asset before rendering', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const d = fixtureDefinition();
  d.pages[0].sha256 = 'a'.repeat(64);
  const { bytes } = await fixturePage();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes))));
  expect(await packageAvailableOffline(d)).toBe(false);
  await expect(loadPackagePage(d, 'page1.pdf')).rejects.toThrow(/revision mismatch/);
});
it('reads a complete verified package offline and detects partial caches', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const page = await fixturePage(); const d = fixtureDefinition(); d.pages[0].sha256 = page.sha256;
  const entries = new Map<string, Response>();
  vi.stubGlobal('caches', { open: async () => ({
    match: async (key: string) => entries.get(key)?.clone(),
    keys: async () => [...entries.keys()],
    put: async (key: string, value: Response) => { entries.set(key, value); },
  }) });
  const fetch = vi.fn(async () => new Response(new Uint8Array(page.bytes)));
  vi.stubGlobal('fetch', fetch);
  await loadPackagePage(d, 'page1.pdf');
  expect(await packageAvailableOffline(d)).toBe(true);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  await expect(loadPackagePage(d, 'page1.pdf')).resolves.toEqual(page.bytes);
  d.pages.push({ ...d.pages[0], file: 'page2.pdf', sha256: 'b'.repeat(64) });
  expect(await packageAvailableOffline(d)).toBe(false);
});

it('allows online use when browser cache access is denied, but refuses an offline guarantee', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const page = await fixturePage(); const d = fixtureDefinition(); d.pages[0].sha256 = page.sha256;
  vi.stubGlobal('caches', { open: async () => { throw new Error('Storage denied'); } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(page.bytes))));
  await expect(loadPackagePage(d, 'page1.pdf')).resolves.toEqual(page.bytes);
  await expect(loadPackagePage(d, 'page1.pdf', true)).rejects.toThrow(/Storage denied/);
  d.pages[0].width = 500;
  await expect(loadPackagePage(d, 'page1.pdf')).rejects.toThrow(/dimensions/);
});

it('repairs a corrupt cached page from the verified network copy', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const page = await fixturePage(); const d = fixtureDefinition(); d.pages[0].sha256 = page.sha256;
  const entries = new Map<string, Response>([[`/__form_assets/${page.sha256}.pdf`, new Response('corrupt')]]);
  vi.stubGlobal('caches', { open: async () => ({
    match: async (key: string) => entries.get(key)?.clone(),
    keys: async () => [...entries.keys()],
    delete: async (key: string) => entries.delete(key),
    put: async (key: string, value: Response) => { entries.set(key, value); },
  }) });
  const fetch = vi.fn(async () => new Response(new Uint8Array(page.bytes)));
  vi.stubGlobal('fetch', fetch);
  expect(await packageAvailableOffline(d)).toBe(false);
  await expect(loadPackagePage(d, 'page1.pdf', true)).resolves.toEqual(page.bytes);
  expect(fetch).toHaveBeenCalledOnce();
  expect(await packageAvailableOffline(d)).toBe(true);
  d.pages[0].width = 500;
  expect(await packageAvailableOffline(d)).toBe(false);
});

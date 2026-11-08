import { afterEach, expect, it, vi } from 'vitest';
import { loadNavmc10274Templates } from '@/services/pdf/navmc10274Generator';
import { loadNavmc11811Template } from '@/services/pdf/navmc11811Generator';

afterEach(() => { vi.restoreAllMocks(); });

it('retries only the failed NAVMC 10274 page and retains every successful page', async () => {
  const attempts = new Map<string, number>();
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input);
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    const page = Number(url.match(/page(\d)\.pdf$/)![1]);
    if (page === 3 && attempt === 1) throw new TypeError('Connection terminated unexpectedly');
    return new Response(new Uint8Array([page]));
  });
  const result = await loadNavmc10274Templates();
  expect([...new Uint8Array(result.page1)]).toEqual([1]);
  expect([...new Uint8Array(result.page2)]).toEqual([2]);
  expect([...new Uint8Array(result.page3)]).toEqual([3]);
  expect([...attempts.values()]).toEqual([1, 1, 2]);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('reports an HTTP failure after two attempts instead of accepting its body as a PDF', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('Unavailable', { status: 503 }));
  await expect(loadNavmc11811Template()).rejects.toThrow('503');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('retries an interrupted template body read', async () => {
  const broken = new Response(new Uint8Array([1]));
  vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(new TypeError('Body stream failed'));
  const fetcher = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(broken)
    .mockResolvedValueOnce(new Response(new Uint8Array([2])));
  expect([...new Uint8Array(await loadNavmc11811Template())]).toEqual([2]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('keeps a successful first template response without another request', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([3])));
  expect([...new Uint8Array(await loadNavmc11811Template())]).toEqual([3]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

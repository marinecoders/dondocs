import { vi } from 'vitest';

/** An origin-local Cache Storage implementation with real response bodies. */
export function formCache() {
  const entries = new Map<string, Response>();
  const path = (key: RequestInfo | URL) => new URL(typeof key === 'string' ? key : key instanceof URL ? key.href : key.url, 'http://localhost').pathname;
  const cache = {
    match: vi.fn(async (key: RequestInfo | URL) => entries.get(path(key))?.clone()),
    keys: vi.fn(async () => [...entries.keys()].map(key => new Request(`http://localhost${key}`))),
    put: vi.fn(async (key: RequestInfo | URL, response: Response) => { entries.set(path(key), response.clone()); }),
    delete: vi.fn(async (key: RequestInfo | URL) => entries.delete(path(key))),
  };
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
  return { cache, entries };
}

/**
 * Pre-loaded by `tsx --import` before any other module is evaluated.
 *
 * Defines the runtime globals that `src/lib/version.ts` and `src/lib/debug.ts`
 * read at top level. Vitest handles these via its `define` config and
 * `setupFiles`; the cartesian CLI runner has no Vite, so we set them
 * directly on globalThis here.
 *
 * The `localStorage` shim mirrors what `tests/_helpers/setup.ts` installs
 * for vitest. Without it, `src/lib/debug.ts:53` crashes because Node has
 * no `localStorage`.
 */
declare global {
  // eslint-disable-next-line no-var
  var __APP_VERSION__: string;
  // eslint-disable-next-line no-var
  var __GIT_SHA__: string;
  // eslint-disable-next-line no-var
  var __BUILD_TIME__: string;
}

(globalThis as Record<string, unknown>).__APP_VERSION__ = 'cartesian-harness';
(globalThis as Record<string, unknown>).__GIT_SHA__ = 'cartesian-harness';
(globalThis as Record<string, unknown>).__BUILD_TIME__ = '1970-01-01T00:00:00Z';

class InMemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
}

if (typeof globalThis.localStorage === 'undefined' ||
    typeof globalThis.localStorage.getItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new InMemoryStorage(),
    writable: true,
    configurable: true,
  });
}
if (typeof globalThis.sessionStorage === 'undefined' ||
    typeof globalThis.sessionStorage.getItem !== 'function') {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new InMemoryStorage(),
    writable: true,
    configurable: true,
  });
}

export {};

/**
 * Per-test global setup. Loaded via `vitest.config.ts > test.setupFiles`
 * before each test file's imports run, so any side-effecting top-level
 * imports in the SUT don't blow up on missing globals.
 *
 * What we patch and why:
 *
 * 1. `localStorage` / `sessionStorage` — happy-dom 20.x wires these to a
 *    constructor stub whose instance methods (`getItem`, `setItem`, …)
 *    aren't always present, so a top-level import that calls
 *    `localStorage.getItem(...)` crashes with "getItem is not a function".
 *    `src/lib/debug.ts` does exactly this at module-init time, and every
 *    file in `src/lib/` transitively imports it, so without this patch
 *    the entire `lib/` test surface is unreachable. The patch installs a
 *    minimal in-memory Storage shim — sufficient for the read/write
 *    paths the SUT exercises during tests.
 */
class InMemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
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

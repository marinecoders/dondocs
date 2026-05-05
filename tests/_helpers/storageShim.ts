/**
 * In-memory `localStorage` / `sessionStorage` shim, shared between the
 * vitest test runner (`tests/_helpers/setup.ts`) and the cartesian CLI
 * runner (`tests/cartesian/_globals.ts`).
 *
 * Why we need it:
 *
 *   - `src/lib/debug.ts` calls `localStorage.getItem(...)` at module-init
 *     time. Every file in `src/lib/` transitively imports it, so the
 *     entire `lib/` surface is unreachable without `localStorage` being
 *     present in the runtime environment.
 *
 *   - Vitest runs the SUT under happy-dom 20.x, whose Storage constructor
 *     stub doesn't always have `getItem` / `setItem` instance methods —
 *     so a freshly-instantiated localStorage may exist but its method
 *     calls crash with "getItem is not a function".
 *
 *   - The cartesian CLI runner uses `vite-node`, which has no DOM at
 *     all — `localStorage` is genuinely undefined.
 *
 * `installStorageShim()` patches both cases idempotently: only installs
 * if the existing global is undefined OR has a non-function `getItem`.
 *
 * Sufficient for the read/write paths the SUT exercises during tests;
 * not a full Storage spec implementation.
 */

class InMemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
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

function isUsable(s: unknown): boolean {
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof (s as Storage).getItem === 'function'
  );
}

/**
 * Install the in-memory storage shim on globalThis if not already present
 * and usable. Safe to call multiple times.
 */
export function installStorageShim(): void {
  if (!isUsable(globalThis.localStorage)) {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new InMemoryStorage(),
      writable: true,
      configurable: true,
    });
  }
  if (!isUsable(globalThis.sessionStorage)) {
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: new InMemoryStorage(),
      writable: true,
      configurable: true,
    });
  }
}

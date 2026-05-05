/**
 * Pre-loaded as the FIRST import of `tests/cartesian/run.ts` so the
 * runtime globals that `src/lib/version.ts` and `src/lib/debug.ts` read
 * at top level are in place before any src/ module is evaluated.
 *
 * Vitest handles these via its `define` config and `setupFiles`; the
 * cartesian CLI runner has no Vite. The localStorage shim is shared
 * with the vitest setup via `../_helpers/storageShim.ts` — single
 * source of truth for the in-memory Storage implementation.
 */
import { installStorageShim } from '../_helpers/storageShim';

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

installStorageShim();

export {};

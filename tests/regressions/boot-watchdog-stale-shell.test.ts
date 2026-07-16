/**
 * Regression: the v1.2.94 stale-shell white screen.
 *
 * After a deploy, the service worker's NetworkFirst navigation fetch could be
 * satisfied by the browser's HTTP cache, serve an index.html whose hashed
 * bundles no longer existed, and store that stale shell in its own runtime
 * cache — every new load white-screened until a manual hard refresh. The fix
 * is a boot watchdog inlined in index.html that self-heals with a one-shot,
 * session-guarded recovery.
 *
 * These tests execute the ACTUAL inline script extracted from index.html (not
 * a copy) against injected doubles, so editing or removing the watchdog — or
 * breaking any of its guards — fails CI at the PR stage. A final test pins the
 * cross-file couplings the watchdog depends on: main.tsx must set the boot
 * flag, and the shell-cache prefix it deletes must match the cacheName in
 * vite.config.ts (rename one without the other and recovery silently stops
 * cleaning the poisoned cache).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf-8');

const SHELL_CACHE_PREFIX = 'dondocs-app-shell';
const GUARD_KEY = 'dondocs-boot-recovery';

function extractWatchdogSource(): string {
  // Case-insensitive: this only extracts a known inline script from our own
  // index.html, but CodeQL (rightly) treats case-sensitive tag regexes as a
  // sanitizer-bypass smell, and <SCRIPT> is valid HTML anyway.
  const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const src = scripts.find((s) => s.includes(GUARD_KEY));
  if (!src) throw new Error('boot watchdog inline script not found in index.html');
  return src;
}

interface RunOptions {
  booted: boolean;
  online?: boolean;
  guardAlreadySet?: boolean;
  cacheKeys?: string[];
}

/** Run the extracted watchdog against doubles and fire its timer. */
async function runWatchdog(opts: RunOptions) {
  const storage = new Map<string, string>();
  if (opts.guardAlreadySet) storage.set(GUARD_KEY, '1');

  const deleted: string[] = [];
  const fetchCalls: { url: string; init?: RequestInit }[] = [];
  let reloads = 0;
  let timerCb: (() => void) | null = null;

  const cachesStub = {
    keys: async () => opts.cacheKeys ?? [],
    delete: async (k: string) => {
      deleted.push(k);
      return true;
    },
  };
  const sandbox = {
    window: { __DD_BOOTED__: opts.booted ? true : undefined, caches: cachesStub },
    navigator: { onLine: opts.online ?? true },
    sessionStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    caches: cachesStub,
    fetch: (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true });
    },
    location: {
      href: 'https://dondocs.test/',
      reload: () => {
        reloads++;
      },
    },
    setTimeout: (cb: () => void) => {
      timerCb = cb;
      return 0;
    },
  };

  // Execute the real inline script with our doubles shadowing the globals.
  new Function(...Object.keys(sandbox), extractWatchdogSource())(...Object.values(sandbox));

  const fireTimer = async () => {
    timerCb?.();
    // let the recovery's promise chain settle
    await new Promise((r) => globalThis.setTimeout(r, 0));
    await new Promise((r) => globalThis.setTimeout(r, 0));
  };
  await fireTimer();

  return { deleted, fetchCalls, reloads: () => reloads, storage, fireTimer };
}

describe('boot watchdog — stale shell recovery (v1.2.94 incident)', () => {
  it('stale shell: drops only app-shell caches, refetches past the HTTP cache, reloads once', async () => {
    const r = await runWatchdog({
      booted: false,
      cacheKeys: [
        `${SHELL_CACHE_PREFIX}-deadbeef`,
        `${SHELL_CACHE_PREFIX}-cafef00d`,
        'engine-core-cache-v1', // must survive — offline engine assets
        'pandoc-wasm-cache-v2', // must survive — air-gap DOCX engine
      ],
    });
    expect(r.deleted).toEqual([`${SHELL_CACHE_PREFIX}-deadbeef`, `${SHELL_CACHE_PREFIX}-cafef00d`]);
    // cache:'reload' bypasses the stale HTTP entry AND replaces it with the
    // fresh response — 'no-store' would leave the poison in place.
    expect(r.fetchCalls).toEqual([
      { url: 'https://dondocs.test/', init: { cache: 'reload' } },
    ]);
    expect(r.reloads()).toBe(1);
    expect(r.storage.get(GUARD_KEY)).toBe('1');
  });

  it('never loops: a second firing with the guard set does nothing', async () => {
    const r = await runWatchdog({
      booted: false,
      guardAlreadySet: true,
      cacheKeys: [`${SHELL_CACHE_PREFIX}-deadbeef`],
    });
    expect(r.deleted).toEqual([]);
    expect(r.fetchCalls).toEqual([]);
    expect(r.reloads()).toBe(0);
  });

  it('healthy boot: no recovery, and the one-shot guard is cleared for next time', async () => {
    const r = await runWatchdog({
      booted: true,
      guardAlreadySet: true, // left over from a prior recovered session
      cacheKeys: [`${SHELL_CACHE_PREFIX}-deadbeef`],
    });
    expect(r.deleted).toEqual([]);
    expect(r.reloads()).toBe(0);
    expect(r.storage.has(GUARD_KEY)).toBe(false);
  });

  it('offline: stands down entirely — the cached shell is all an air-gapped machine has', async () => {
    const r = await runWatchdog({
      booted: false,
      online: false,
      cacheKeys: [`${SHELL_CACHE_PREFIX}-deadbeef`],
    });
    expect(r.deleted).toEqual([]);
    expect(r.fetchCalls).toEqual([]);
    expect(r.reloads()).toBe(0);
    // and it must NOT burn the one-shot guard while offline, or a machine that
    // comes back online later has no recovery left
    expect(r.storage.has(GUARD_KEY)).toBe(false);
  });
});

describe('boot watchdog — cross-file couplings', () => {
  it('main.tsx sets the boot flag the watchdog waits for', () => {
    const main = readFileSync(join(ROOT, 'src', 'main.tsx'), 'utf-8');
    expect(main).toMatch(/window\.__DD_BOOTED__\s*=\s*true/);
    expect(extractWatchdogSource()).toContain('__DD_BOOTED__');
  });

  it('the cache prefix the watchdog deletes matches the shell cacheName in vite.config.ts', () => {
    const viteConfig = readFileSync(join(ROOT, 'vite.config.ts'), 'utf-8');
    // vite.config.ts names the runtime cache `dondocs-app-shell-<build>`; the
    // watchdog deletes by prefix. Renaming one without the other makes
    // recovery silently stop cleaning the poisoned cache.
    expect(viteConfig).toMatch(new RegExp(`cacheName:\\s*\`${SHELL_CACHE_PREFIX}-`));
    expect(extractWatchdogSource()).toContain(`'${SHELL_CACHE_PREFIX}'`);
  });
});

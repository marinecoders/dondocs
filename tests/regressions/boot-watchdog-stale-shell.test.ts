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
  // Slice on the known id rather than an HTML-tag regex: parsing tags with a
  // regex is a sanitizer-bypass smell CodeQL rightly flags (js/bad-tag-filter),
  // and we only ever extract this one inline script from our own index.html.
  const OPEN = '<script id="boot-watchdog">';
  const start = indexHtml.indexOf(OPEN);
  if (start === -1) throw new Error('boot watchdog inline script not found in index.html');
  const bodyStart = start + OPEN.length;
  const end = indexHtml.indexOf('</script>', bodyStart);
  if (end === -1) throw new Error('boot watchdog script end tag not found in index.html');
  const src = indexHtml.slice(bodyStart, end);
  if (!src.includes(GUARD_KEY)) throw new Error('boot watchdog script missing its guard key');
  return src;
}

// The shell fingerprint: the hashed module src of the build this index.html
// belongs to. The guard stores it so recovery is one-shot PER BROKEN SHELL —
// a different stale shell (served by a stale SW after the first heal) gets one
// more attempt, while the same shell can never loop.
const SHELL_SRC = '/assets/main-abc123.js';

interface RunOptions {
  booted: boolean;
  /** Whether our --background token resolved (the stylesheet applied). Default
   *  true: booting is only healthy when the CSS also loaded. */
  stylesApplied?: boolean;
  online?: boolean;
  /** Pre-set guard value: SHELL_SRC = this shell already healed. */
  guardValue?: string;
  cacheKeys?: string[];
  /** The module script src the current shell carries (null = none found). */
  shellSrc?: string | null;
  /** Whether a service worker controls the page (default: yes, one worker). */
  serviceWorker?: boolean;
  /** Skip the automatic timer firing (to exercise the fast CSS-error path alone). */
  autoFireTimer?: boolean;
}

/** A minimal resource-error event target, as the capture listener sees it. */
interface ErrorTarget {
  tagName: string;
  rel?: string;
  href?: string;
}

/** Run the extracted watchdog against doubles and fire its timer. */
async function runWatchdog(opts: RunOptions) {
  const storage = new Map<string, string>();
  if (opts.guardValue !== undefined) storage.set(GUARD_KEY, opts.guardValue);

  const deleted: string[] = [];
  const fetchCalls: { url: string; init?: RequestInit }[] = [];
  let reloads = 0;
  let unregistered = 0;
  let timerCb: (() => void) | null = null;
  let errorCb: ((e: { target: ErrorTarget | null }) => void) | null = null;
  let errorCapture: boolean | undefined;

  const cachesStub = {
    keys: async () => opts.cacheKeys ?? [],
    delete: async (k: string) => {
      deleted.push(k);
      return true;
    },
  };
  const hasSW = opts.serviceWorker ?? true;
  const navigatorStub: Record<string, unknown> = { onLine: opts.online ?? true };
  if (hasSW) {
    navigatorStub.serviceWorker = {
      getRegistrations: async () => [
        { unregister: async () => void unregistered++ },
        { unregister: async () => void unregistered++ },
      ],
    };
  }
  const stylesApplied = opts.stylesApplied ?? true;
  const sandbox = {
    window: {
      __DD_BOOTED__: opts.booted ? true : undefined,
      caches: cachesStub,
      addEventListener: (
        type: string,
        cb: (e: { target: ErrorTarget | null }) => void,
        capture?: boolean
      ) => {
        if (type === 'error') {
          errorCb = cb;
          errorCapture = capture;
        }
      },
    },
    // The watchdog probes getComputedStyle(...).getPropertyValue('--background');
    // an empty value means the stylesheet never applied (unstyled shell).
    getComputedStyle: () => ({
      getPropertyValue: (prop: string) =>
        prop === '--background' && stylesApplied ? 'oklch(0.97 0.008 250)' : '',
    }),
    document: {
      querySelector: (sel: string) => {
        if (!sel.includes('script')) return null;
        const src = opts.shellSrc === undefined ? SHELL_SRC : opts.shellSrc;
        return src === null ? null : { getAttribute: () => src };
      },
    },
    navigator: navigatorStub,
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

  const settle = async () => {
    // let the recovery's promise chain settle
    await new Promise((r) => globalThis.setTimeout(r, 0));
    await new Promise((r) => globalThis.setTimeout(r, 0));
  };
  const fireTimer = async () => {
    timerCb?.();
    await settle();
  };
  /** Fire the capture-phase resource-error listener with the given target. */
  const fireError = async (target: ErrorTarget | null) => {
    errorCb?.({ target });
    await settle();
  };
  if (opts.autoFireTimer !== false) await fireTimer();

  return {
    deleted,
    fetchCalls,
    reloads: () => reloads,
    unregistered: () => unregistered,
    storage,
    fireTimer,
    fireError,
    errorListener: () => ({ registered: errorCb !== null, capture: errorCapture }),
  };
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
    // Recovery unregisters the service worker — it is what serves the stale
    // shell, so the healing reload must not be intercepted by it.
    expect(r.unregistered()).toBe(2);
    // The guard records WHICH shell was healed (the hashed module src), so
    // recovery is one-shot per broken build rather than per tab session.
    expect(r.storage.get(GUARD_KEY)).toBe(SHELL_SRC);
  });

  it('booted-but-unstyled shell (poisoned CSS) is recovered, not treated as healthy', async () => {
    // The regression this release fixes: the JS booted (__DD_BOOTED__ set) but
    // a stale service worker served a bad stylesheet, so --background never
    // resolved. The old watchdog saw "booted" and stood down, leaving the user
    // on a white/unstyled page. Health now requires the stylesheet too.
    const r = await runWatchdog({
      booted: true,
      stylesApplied: false,
      cacheKeys: [`${SHELL_CACHE_PREFIX}-deadbeef`],
    });
    expect(r.reloads()).toBe(1);
    expect(r.unregistered()).toBe(2); // the poisoned worker is unregistered
    expect(r.deleted).toEqual([`${SHELL_CACHE_PREFIX}-deadbeef`]);
    expect(r.storage.get(GUARD_KEY)).toBe(SHELL_SRC);
  });

  it('never loops: a second firing on the SAME broken shell does nothing', async () => {
    const r = await runWatchdog({
      booted: false,
      guardValue: SHELL_SRC,
      cacheKeys: [`${SHELL_CACHE_PREFIX}-deadbeef`],
    });
    expect(r.deleted).toEqual([]);
    expect(r.fetchCalls).toEqual([]);
    expect(r.reloads()).toBe(0);
  });

  it('heals again when a DIFFERENT stale shell appears after the first recovery', async () => {
    // The reported incident: heal #1 ran, but a stale service worker then
    // served a different stale shell — under the session-wide guard the tab
    // was stuck until a manual hard refresh. A new shell fingerprint earns
    // exactly one more attempt.
    const r = await runWatchdog({
      booted: false,
      guardValue: '/assets/main-oldbuild.js',
      cacheKeys: [`${SHELL_CACHE_PREFIX}-deadbeef`],
    });
    expect(r.deleted).toEqual([`${SHELL_CACHE_PREFIX}-deadbeef`]);
    expect(r.reloads()).toBe(1);
    expect(r.storage.get(GUARD_KEY)).toBe(SHELL_SRC);
  });

  it('a shell with no module script still gets a one-shot recovery under a stable key', async () => {
    const r = await runWatchdog({ booted: false, shellSrc: null, cacheKeys: [] });
    expect(r.reloads()).toBe(1);
    expect(r.storage.get(GUARD_KEY)).toBe('unknown');
  });

  it('healthy boot: no recovery, and the one-shot guard is cleared for next time', async () => {
    const r = await runWatchdog({
      booted: true,
      stylesApplied: true, // booted AND styled — genuinely healthy
      guardValue: SHELL_SRC, // left over from a prior recovered session
      cacheKeys: [`${SHELL_CACHE_PREFIX}-deadbeef`],
    });
    expect(r.deleted).toEqual([]);
    expect(r.reloads()).toBe(0);
    expect(r.unregistered()).toBe(0);
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

describe('boot watchdog — fast heal on stylesheet failure', () => {
  const cssTarget = (href = 'https://dondocs.test/assets/main-abc123.css'): {
    tagName: string;
    rel: string;
    href: string;
  } => ({ tagName: 'LINK', rel: 'stylesheet', href });

  it('a failed shell stylesheet heals immediately — no waiting for the timer', async () => {
    const r = await runWatchdog({
      booted: false,
      stylesApplied: false,
      autoFireTimer: false,
      cacheKeys: [`${SHELL_CACHE_PREFIX}-deadbeef`],
    });
    // capture phase is load-bearing: resource errors don't bubble, so a
    // bubble-phase listener would never fire and the fast path silently dies.
    expect(r.errorListener()).toEqual({ registered: true, capture: true });
    await r.fireError(cssTarget());
    expect(r.reloads()).toBe(1);
    expect(r.unregistered()).toBe(2);
    expect(r.deleted).toEqual([`${SHELL_CACHE_PREFIX}-deadbeef`]);
    expect(r.storage.get(GUARD_KEY)).toBe(SHELL_SRC);
  });

  it('the timer firing after a fast heal does not heal twice', async () => {
    const r = await runWatchdog({
      booted: false,
      stylesApplied: false,
      autoFireTimer: false,
      cacheKeys: [`${SHELL_CACHE_PREFIX}-deadbeef`],
    });
    await r.fireError(cssTarget());
    await r.fireTimer();
    expect(r.reloads()).toBe(1); // one-shot guard holds across both triggers
  });

  it('ignores failures that are not our shell stylesheet', async () => {
    const r = await runWatchdog({ booted: false, stylesApplied: false, autoFireTimer: false });
    await r.fireError(null); // no target at all
    await r.fireError({ tagName: 'IMG', href: 'https://dondocs.test/assets/x.png' });
    await r.fireError({ tagName: 'LINK', rel: 'preload', href: 'https://dondocs.test/assets/a.css' });
    await r.fireError(cssTarget('https://dondocs.test/other/site.css')); // not /assets/
    expect(r.reloads()).toBe(0);
  });

  it('a stylesheet error while styles ARE applied never nukes a healthy session', async () => {
    // e.g. a secondary/print stylesheet failing after the main one applied.
    const r = await runWatchdog({ booted: true, stylesApplied: true, autoFireTimer: false });
    await r.fireError(cssTarget());
    expect(r.reloads()).toBe(0);
    expect(r.unregistered()).toBe(0);
  });

  it('offline: the fast path stands down like the timer path', async () => {
    const r = await runWatchdog({
      booted: false,
      stylesApplied: false,
      online: false,
      autoFireTimer: false,
    });
    await r.fireError(cssTarget());
    expect(r.reloads()).toBe(0);
    expect(r.storage.has(GUARD_KEY)).toBe(false); // guard not burned while offline
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

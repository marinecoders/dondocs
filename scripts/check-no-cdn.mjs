#!/usr/bin/env node
/**
 * Postbuild guard: fail the build if any shipped asset references a public
 * CDN. The app promises air-gap operation (SIPR/JWICS) — a dependency bump or
 * a copied snippet can quietly reintroduce a CDN fetch that works in an
 * online dev session and only fails in the field, where nobody sees the
 * error. This converts that silent regression into a loud CI stop.
 *
 * Runs via the `postbuild` npm hook, so the existing "production build" CI
 * job enforces it with no workflow changes.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Hosts that must never appear in a shipped asset. */
export const FORBIDDEN = [
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
];

const SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map']);

/**
 * Pure detector: every {host, line} hit in a text blob. Exported for unit
 * tests (tests/unit/checkNoCdn.test.ts) — CI proves absence on the current
 * dist; the test proves the detector actually fires when a host appears.
 */
export function findCdnHits(text, forbidden = FORBIDDEN) {
  const hits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const host of forbidden) {
      if (lines[i].includes(host)) hits.push({ host, line: i + 1 });
    }
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

function main() {
  // Resolved here, not at module load: vitest imports this module under a
  // non-file URL scheme, where fileURLToPath throws. Only execution needs it.
  const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  let scanned = 0;
  let failed = false;
  for (const file of walk(DIST)) {
    if (!SCAN_EXTENSIONS.has(extname(file))) continue;
    scanned++;
    const hits = findCdnHits(readFileSync(file, 'utf8'));
    for (const { host, line } of hits) {
      failed = true;
      console.error(`[check-no-cdn] ${relative(DIST, file)}:${line} references ${host}`);
    }
  }
  if (failed) {
    console.error(
      '\n[check-no-cdn] FAIL — the build references public CDNs, which breaks the ' +
        'advertised air-gap capability. Vendor the asset same-origin (see ' +
        'scripts/vendor-assets.mjs) instead of fetching it from a CDN.'
    );
    process.exit(1);
  }
  console.log(`[check-no-cdn] OK — ${scanned} dist assets scanned, no CDN references`);
}

// Execution guard: unit tests import findCdnHits without scanning anything.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

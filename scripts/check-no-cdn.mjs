#!/usr/bin/env node
/**
 * Air-gap guard: fail the build if the production bundle (dist/) contains any
 * reference to a public CDN host.
 *
 * dondocs advertises "air-gap capable — works completely offline on SIPR/JWICS."
 * That guarantee rests on the shipped artifact contacting zero third-party
 * origins at runtime. It is easy to silently regress: a dependency bump, a new
 * library, or a copied snippet can reintroduce a `fetch`/`import`/`workerUrl`
 * pointing at unpkg/jsdelivr/cdnjs that works in dev (online) and breaks in the
 * field (air-gapped). This check converts that silent field failure into a loud
 * CI failure.
 *
 * Run after `vite build`. Scans every shipped text asset (JS, MJS, CSS, HTML,
 * the service worker) for a blocklist of CDN host substrings. Exits non-zero on
 * any hit, printing file + matched host.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');

// CDN host substrings that must never appear in a shipped asset. Add hosts here
// as new ones are encountered; keep them specific to avoid false positives on,
// e.g., a docs URL in a comment that got stripped from prod anyway.
const FORBIDDEN = [
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
];

// Only scan text-like assets that could carry a URL the browser would resolve.
const SCAN_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (SCAN_EXT.has(extname(entry))) out.push(full);
  }
  return out;
}

function main() {
  let distExists = true;
  try {
    statSync(DIST);
  } catch {
    distExists = false;
  }
  if (!distExists) {
    console.error('[check-no-cdn] dist/ not found — run `vite build` first.');
    process.exit(1);
  }

  const files = walk(DIST);
  const hits = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const host of FORBIDDEN) {
      if (text.includes(host)) {
        // Report the first matched line for context.
        const line = text.split('\n').findIndex((l) => l.includes(host)) + 1;
        hits.push({ file: file.replace(DIST + '/', 'dist/'), host, line });
      }
    }
  }

  if (hits.length > 0) {
    console.error('[check-no-cdn] FAIL — production bundle references public CDN host(s):\n');
    for (const h of hits) {
      console.error(`  ${h.file}:${h.line}  →  ${h.host}`);
    }
    console.error(
      '\nThe air-gap guarantee requires zero third-party origins in the shipped artifact.\n' +
        'Vendor the asset same-origin (see scripts/vendor-assets.mjs and public/lib/pandoc/),\n' +
        'or, if the host is genuinely required and safe, add it to the FORBIDDEN allowlist\n' +
        'exception with a documented reason.'
    );
    process.exit(1);
  }

  console.log(`[check-no-cdn] OK — scanned ${files.length} shipped assets, no CDN host references.`);
}

main();

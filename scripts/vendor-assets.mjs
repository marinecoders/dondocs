#!/usr/bin/env node
/**
 * Vendor large third-party binary assets into public/lib/ so the deployed
 * artifact is fully self-contained and works on air-gapped SIPR/JWICS networks.
 *
 * Why a build-time download instead of committing the binary:
 *   pandoc.wasm is ~58 MB. Committing it to git would nearly triple the repo
 *   and live in history forever. Instead we fetch it once (on postinstall and
 *   before build, when CI/dev machines are online) into public/lib/pandoc/, and
 *   .gitignore it. Vite copies public/ verbatim into dist/, so the *deployed*
 *   bundle bakes the binary in — the air-gap guarantee holds for end users even
 *   though the repo stays lean.
 *
 * Small vendored assets (the WASI shim, the pdfjs 3.11 worker) are committed
 * directly — they're in the same size class as the already-committed
 * pdf.worker.min.mjs and committing them avoids a network dependency for
 * everyday `npm run dev`.
 *
 * Idempotent: skips a download when the target already exists with the right
 * size. Safe to run repeatedly. Never contacts a CDN at app runtime — only here,
 * at build time.
 */
import { createWriteStream, existsSync, statSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

/**
 * Assets fetched at build time (gitignored). Each entry pins an exact upstream
 * version so the air-gapped artifact is reproducible.
 */
const ASSETS = [
  {
    name: 'pandoc.wasm',
    url: 'https://unpkg.com/pandoc-wasm@1.0.1/src/pandoc.wasm',
    dest: join(REPO_ROOT, 'public/lib/pandoc/pandoc.wasm'),
    minBytes: 50 * 1024 * 1024, // ~58 MB; sanity floor to reject truncated/HTML error bodies
    magic: [0x00, 0x61, 0x73, 0x6d], // WASM magic word — guards against a CDN error page
  },
];

async function fetchTo(asset) {
  const { name, url, dest, minBytes, magic } = asset;

  if (existsSync(dest) && statSync(dest).size >= minBytes) {
    console.log(`[vendor] ${name}: already present (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB) — skipping`);
    return;
  }

  mkdirSync(dirname(dest), { recursive: true });
  console.log(`[vendor] ${name}: downloading from ${url} ...`);

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`[vendor] ${name}: HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }

  const tmp = `${dest}.partial`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));

  const size = statSync(tmp).size;
  if (size < minBytes) {
    await rm(tmp, { force: true });
    throw new Error(`[vendor] ${name}: downloaded only ${size} bytes (< ${minBytes}); likely a CDN error body, not the asset`);
  }

  if (magic) {
    const { open } = await import('node:fs/promises');
    const fh = await open(tmp, 'r');
    const buf = Buffer.alloc(magic.length);
    await fh.read(buf, 0, magic.length, 0);
    await fh.close();
    const ok = magic.every((b, i) => buf[i] === b);
    if (!ok) {
      await rm(tmp, { force: true });
      throw new Error(`[vendor] ${name}: magic-byte check failed (got ${[...buf].map((b) => b.toString(16)).join(' ')}); refusing to ship a corrupt asset`);
    }
  }

  // Atomic-ish rename into place only after all validation passes.
  const { rename } = await import('node:fs/promises');
  await rename(tmp, dest);
  console.log(`[vendor] ${name}: OK (${(size / 1024 / 1024).toFixed(1)} MB) → ${dest.replace(REPO_ROOT + '/', '')}`);
}

async function main() {
  // Allow opting out in fully-offline build environments that have pre-staged
  // the assets some other way (e.g. an internal mirror copied them in).
  if (process.env.SKIP_VENDOR_ASSETS === '1') {
    console.log('[vendor] SKIP_VENDOR_ASSETS=1 set — skipping all downloads');
    return;
  }

  let failed = false;
  for (const asset of ASSETS) {
    try {
      await fetchTo(asset);
    } catch (err) {
      failed = true;
      console.error(String(err instanceof Error ? err.message : err));
    }
  }

  if (failed) {
    console.error(
      '\n[vendor] One or more assets failed to download. DOCX export will not work ' +
        'until they are present. If this machine is offline, stage the files manually ' +
        'into public/lib/pandoc/ and re-run, or set SKIP_VENDOR_ASSETS=1 to bypass.'
    );
    process.exit(1);
  }
}

main();

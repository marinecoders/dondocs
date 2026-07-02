#!/usr/bin/env node
/**
 * Vendor the pandoc WASM binary into public/lib/pandoc/ as same-origin PARTS,
 * so the deployed artifact is fully self-contained and works on air-gapped
 * SIPR/JWICS networks — the app's advertised promise.
 *
 * Why parts instead of one file:
 *   pandoc.wasm is ~58 MB. Cloudflare Pages and Workers static assets enforce
 *   a 25 MiB per-file limit — a single vendored wasm cannot deploy (this is
 *   the failure that stalled the original vendoring attempt, PR #75). The
 *   binary is split into ≤19 MiB parts here and reassembled by
 *   public/lib/pandoc/pandoc.js in the browser before instantiation.
 *
 * Why a build-time download instead of committing the binary:
 *   Committing ~58 MB would triple the repo and live in history forever.
 *   Instead we fetch a pinned version before dev/build (when machines are
 *   online) and .gitignore the output. Vite copies public/ verbatim into
 *   dist/, so the DEPLOYED bundle bakes the parts in. Never contacted at app
 *   runtime — only here, at build time.
 *
 * The manifest (pandoc.wasm.manifest.json) is written LAST, atomically: its
 * presence is the commit point. A crash mid-split leaves no valid manifest,
 * so the next run redoes the work instead of trusting half-written parts.
 *
 * Idempotent: skips when the manifest matches the pinned version and every
 * listed part exists at its recorded size. SKIP_VENDOR_ASSETS=1 bypasses all
 * network work for fully-offline builders that pre-stage the files.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when this module is the entry point. Both sides are realpath-resolved:
 *  Node realpaths import.meta.url for the main module, but process.argv[1] keeps
 *  any symlink as typed, so a plain path.resolve comparison is false under a
 *  symlinked checkout (e.g. macOS /tmp → /private/tmp) and the script would
 *  silently no-op — disabling the air-gap staging it exists to guarantee. */
function isMainModule() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PANDOC_DIR = join(REPO_ROOT, 'public/lib/pandoc');

const WASM = {
  name: 'pandoc.wasm',
  version: '1.0.1', // pinned upstream release — reproducible artifact
  url: 'https://unpkg.com/pandoc-wasm@1.0.1/src/pandoc.wasm',
  minBytes: 50 * 1024 * 1024, // sanity floor: rejects truncated/HTML error bodies
  magic: [0x00, 0x61, 0x73, 0x6d], // WASM magic word
};

const MANIFEST_PATH = join(PANDOC_DIR, 'pandoc.wasm.manifest.json');

/** Cloudflare's per-file limit is 25 MiB; 19 MiB leaves ~6 MiB of headroom. */
export const PART_SIZE = 19 * 1024 * 1024;

/**
 * Pure split plan: the byte length of each part for a payload of totalBytes.
 * Exported for unit tests (tests/unit/vendorAssets.split.test.ts).
 */
export function planParts(totalBytes, partSize = PART_SIZE) {
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) {
    throw new Error(`planParts: invalid totalBytes ${totalBytes}`);
  }
  if (!Number.isInteger(partSize) || partSize <= 0) {
    throw new Error(`planParts: invalid partSize ${partSize}`);
  }
  const sizes = [];
  for (let off = 0; off < totalBytes; off += partSize) {
    sizes.push(Math.min(partSize, totalBytes - off));
  }
  return sizes;
}

/** The stale whole-file and any half-written temp must never reach dist/ —
 *  a single >25 MiB file re-kills the Cloudflare deploy even with parts
 *  present. Runs unconditionally, including on the idempotent-skip path. */
async function cleanupLegacyFiles() {
  await rm(join(PANDOC_DIR, 'pandoc.wasm'), { force: true });
  if (!existsSync(PANDOC_DIR)) return;
  for (const f of readdirSync(PANDOC_DIR)) {
    if (f.endsWith('.partial')) await rm(join(PANDOC_DIR, f), { force: true });
  }
}

async function isCurrent() {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    if (manifest.version !== WASM.version) return false;
    if (!Array.isArray(manifest.parts) || manifest.parts.length !== manifest.partBytes?.length) return false;
    return manifest.parts.every((part, i) => {
      const p = join(PANDOC_DIR, part);
      return existsSync(p) && statSync(p).size === manifest.partBytes[i];
    });
  } catch {
    return false;
  }
}

async function vendorPandocWasm() {
  if (await isCurrent()) {
    console.log(`[vendor] ${WASM.name} ${WASM.version}: parts current per manifest — skipping download`);
    return;
  }

  mkdirSync(PANDOC_DIR, { recursive: true });
  console.log(`[vendor] ${WASM.name}: downloading ${WASM.url} ...`);
  // Bounded: a black-holing proxy would otherwise hang the build/dev startup
  // forever (native fetch has no default timeout).
  const res = await fetch(WASM.url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) {
    throw new Error(`[vendor] ${WASM.name}: HTTP ${res.status} ${res.statusText} fetching ${WASM.url}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());

  if (bytes.byteLength < WASM.minBytes) {
    throw new Error(
      `[vendor] ${WASM.name}: got ${bytes.byteLength} bytes (< ${WASM.minBytes}); likely a CDN error body, not the asset`
    );
  }
  if (!WASM.magic.every((b, i) => bytes[i] === b)) {
    throw new Error(`[vendor] ${WASM.name}: magic-byte check failed; refusing to ship a corrupt asset`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  // Write each part directly. writeFile loops on short writes internally
  // (a single fh.write does not — its bytesWritten can be < length on ENOSPC/
  // RLIMIT and the caller must retry the remainder), so this can't ship a
  // truncated part the manifest then blesses. Per-part .partial staging would
  // be redundant: the manifest is written last as the commit point, so a crash
  // before it lands leaves isCurrent() false and the next run re-vendors.
  const sizes = planParts(bytes.byteLength);
  const parts = sizes.map((_, i) => `pandoc.wasm.part${i}`);
  let offset = 0;
  for (let i = 0; i < sizes.length; i++) {
    await writeFile(join(PANDOC_DIR, parts[i]), bytes.subarray(offset, offset + sizes[i]));
    offset += sizes[i];
  }

  // Manifest last: presence == the whole set is valid.
  const manifest = {
    name: WASM.name,
    version: WASM.version,
    totalBytes: bytes.byteLength,
    parts,
    partBytes: sizes,
    sha256,
  };
  const tmpManifest = `${MANIFEST_PATH}.partial`;
  await writeFile(tmpManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(tmpManifest, MANIFEST_PATH);

  console.log(
    `[vendor] ${WASM.name}: OK — ${sizes.length} parts (${sizes
      .map((s) => `${(s / 1024 / 1024).toFixed(1)}MB`)
      .join(' + ')}), sha256 ${sha256.slice(0, 12)}…`
  );
}

async function main() {
  // predev passes --allow-offline: dev doesn't need DOCX to boot, so a failed
  // vendor there is a warning, not a hard stop. prebuild passes nothing, so a
  // release build still fails loudly if the parts can't be staged.
  const allowOffline = process.argv.includes('--allow-offline');
  await cleanupLegacyFiles();
  try {
    if (process.env.SKIP_VENDOR_ASSETS === '1') {
      // Pre-staged builder: don't download, but DO verify the operator actually
      // staged valid parts. isCurrent() is pure local filesystem work — there's
      // no air-gap reason to skip it — and a green build with no parts is the
      // exact silent regression this pipeline exists to prevent.
      if (await isCurrent()) {
        console.log(`[vendor] SKIP_VENDOR_ASSETS=1 — pre-staged parts verified (${WASM.name} ${WASM.version})`);
        return;
      }
      throw new Error(
        'SKIP_VENDOR_ASSETS=1 but the pandoc parts/manifest are missing or stale in public/lib/pandoc/'
      );
    }
    await vendorPandocWasm();
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    const guidance =
      '[vendor] pandoc parts are unavailable — DOCX export will not work until they exist. ' +
      'Offline? Stage the parts + manifest into public/lib/pandoc/ and set SKIP_VENDOR_ASSETS=1.';
    if (allowOffline) {
      console.warn(`${guidance}\n[vendor] --allow-offline: continuing without them (dev only).`);
      return;
    }
    console.error(guidance);
    process.exit(1);
  }
}

// Execution guard: unit tests import planParts without triggering a download.
if (isMainModule()) {
  await main();
}

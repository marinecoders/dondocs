#!/usr/bin/env node
/**
 * generate-icons.mjs — rasterize the PWA/Apple icons from the ONE canonical
 * icon, public/icon.svg, so the installed-app icon can never drift from the
 * brand mark. Runs on predev/prebuild (like vendor-assets); outputs are
 * gitignored build artifacts, regenerated in <1s of pure local CPU — no
 * network, air-gap safe.
 *
 * Outputs (all in public/):
 *  - apple-touch-icon.png  180×180, flattened onto the icon's navy — iOS
 *    ignores SVG here and composites black behind transparency, so the
 *    background must be baked in.
 *  - pwa-192.png / pwa-512.png  transparent, manifest purpose "any".
 *  - pwa-maskable-512.png  the mark scaled to ~70% and centered on a
 *    full-bleed navy square, so Android launcher masks (circle, squircle,
 *    rounded square) never crop the emblem — the raw SVG's circle spans ~94%
 *    of the canvas and had no safe zone.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'icon.svg');
const OUT = (name) => path.join(ROOT, 'public', name);

// The icon's own bottom-gradient navy; used wherever transparency must be
// filled (Apple home screen, maskable full-bleed).
export const ICON_BACKGROUND = '#0f1f33';

/** Every icon this script produces — the single list the manifest/index.html
 *  entries must stay in lockstep with. */
export const TARGETS = [
  { file: 'apple-touch-icon.png', size: 180, mode: 'flatten' },
  { file: 'pwa-192.png', size: 192, mode: 'transparent' },
  { file: 'pwa-512.png', size: 512, mode: 'transparent' },
  { file: 'pwa-maskable-512.png', size: 512, mode: 'maskable' },
];

// Maskable safe zone: the W3C spec guarantees only the inner 80% (r=0.4)
// survives every mask shape; rendering the mark at 70% leaves margin beyond
// that minimum so even a circle mask keeps the gold ring fully visible.
const MASKABLE_SCALE = 0.7;

export async function generateIcons() {
  const svg = await readFile(SRC);
  for (const t of TARGETS) {
    if (t.mode === 'maskable') {
      const inner = Math.round(t.size * MASKABLE_SCALE);
      const mark = await sharp(svg, { density: 300 }).resize(inner, inner).png().toBuffer();
      await sharp({
        create: { width: t.size, height: t.size, channels: 4, background: ICON_BACKGROUND },
      })
        .composite([{ input: mark, gravity: 'center' }])
        .png()
        .toFile(OUT(t.file));
    } else {
      let img = sharp(svg, { density: 300 }).resize(t.size, t.size);
      if (t.mode === 'flatten') img = img.flatten({ background: ICON_BACKGROUND });
      await img.png().toFile(OUT(t.file));
    }
    // Trust nothing: a wrong-sized icon ships silently and only breaks on a
    // user's home screen. Verify what actually landed on disk.
    const meta = await sharp(OUT(t.file)).metadata();
    if (meta.width !== t.size || meta.height !== t.size) {
      throw new Error(`${t.file}: expected ${t.size}×${t.size}, got ${meta.width}×${meta.height}`);
    }
  }
  console.log(`[generate-icons] OK — ${TARGETS.length} icons rendered from public/icon.svg`);
}

// Execution guard (realpath'd, matching vendor-assets) so tests can import the
// pure config without triggering generation.
import { realpathSync } from 'node:fs';
const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isMain) {
  generateIcons().catch((err) => {
    console.error('[generate-icons] FAILED:', err.message);
    process.exit(1);
  });
}

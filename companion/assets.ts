/**
 * Where the render assets live: the TeX engine and packages under `lib/`
 * and the seals under `attachments/`.
 *
 * From the source tree they are `public/lib` and `public/attachments`, one
 * directory above `companion/`. The built server sits in
 * `dist-companion/companion/` with `lib/` and `attachments/` beside it, and
 * the bundle keeps that layout. Either way they are one directory up; the
 * source tree has `public/` in between.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [join(HERE, '..', 'public'), join(HERE, '..')];

const PUBLIC = CANDIDATES.find((dir) => existsSync(join(dir, 'lib', 'texlive-packages.js')));
if (!PUBLIC) {
  throw new Error(`render assets not found: no lib/texlive-packages.js under ${CANDIDATES.join(' or ')}`);
}

export const LIB = join(PUBLIC, 'lib');
export const ATTACHMENTS = join(PUBLIC, 'attachments');

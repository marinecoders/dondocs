import { formatBodyTables } from '@/services/docx/bodyTables';
/**
 * DOCX through the same generators the app uses.
 * Publications use the shared native OOXML renderer and local bundled assets.
 * The Pandoc limitation below applies to correspondence only.
 *
 * `generateFlatLatex` produces a flattened source that pandoc converts, with the
 * project's own lua filter and reference document.
 *
 * KNOWN LIMITATION — the converter is not the same one the app runs. The app
 * uses a vendored pandoc 3.9 WASM build; this spawns whatever pandoc is on
 * PATH. Output can therefore differ from a browser export in ways this code
 * cannot see.
 *
 * That is a deliberate, pre-existing tradeoff rather than a new one:
 * `tests/_helpers/compileDocx.ts`, the repo's production-faithful DOCX harness,
 * spawns system pandoc for the same reason — `pandoc-converter.ts` is 1569
 * lines of browser-bound code (window.location, fetch, Blob, dynamic URL
 * import) and cannot be imported here. Closing the gap means porting it behind
 * a port the way `LatexEngine` was, which is its own project.
 *
 * What this file owes the caller in the meantime is honesty: report the version
 * actually used, and fail clearly when pandoc is absent rather than at the far
 * end of a confusing stack.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { toStore, type CompanionDefaults, type LetterInput } from './letterInput';
import { RENDER_TIMEOUT_MS } from './limits';
import { LIB, ATTACHMENTS } from './assets';
import { renderPublicationDocx } from '@/services/docx/publication';
import { sl3FigureIds } from '@/data/techpub/sl3';
import { sl4FigureIds } from '@/data/techpub/sl4';
import { prepareDocxImages } from '@/services/docx/imageAssets';
import { attachment } from './publicationInput';


/** The pandoc the app vendors, for comparison against whatever is on PATH. */
export const VENDORED_PANDOC = '3.9';

let cachedVersion: string | null | undefined;

/** The system pandoc version, or null when pandoc is not installed. */
export async function systemPandocVersion(): Promise<string | null> {
  if (cachedVersion !== undefined) { return cachedVersion; }
  cachedVersion = await new Promise<string | null>((resolve) => {
    const p = spawn('pandoc', ['--version']);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(null));
    p.on('close', (code) => resolve(code === 0 ? (out.match(/pandoc\s+([0-9.]+)/)?.[1] ?? 'unknown') : null));
  });
  return cachedVersion;
}

/**
 * Pandoc rides the same budget as the render as a whole (see limits.ts), so the
 * two cannot drift apart and leave a wedged pandoc outliving the request that
 * started it.
 */
const PANDOC_TIMEOUT_MS = RENDER_TIMEOUT_MS;

export async function renderDocx(input: LetterInput, defaults: CompanionDefaults = {}): Promise<Uint8Array> {
  const store = toStore(input, defaults);
  if (['tm_ietm_front_matter', 'i_type', 'sl3', 'sl4'].includes(store.docType)) {
    const stock = store.docType === 'sl3' ? store.formData.sl3 : store.docType === 'sl4' ? store.formData.sl4 : undefined;
    const figures = new Set(store.docType === 'sl3' && store.formData.sl3 ? sl3FigureIds(store.formData.sl3) : store.docType === 'sl4' && store.formData.sl4 ? sl4FigureIds(store.formData.sl4) : []);
    if (stock?.artwork.some(artwork => figures.has(artwork.figureId) && artwork.labels.length)) throw new Error('Labelled stock artwork is not supported by companion Word export. Use the browser Word export or PDF.');
    const result = await renderPublicationDocx({ ...store, endItems: store.endItems ?? [], publicationTables: store.publicationTables ?? {} }, {
      loadSeal: async () => new Uint8Array(await readFile(join(ATTACHMENTS, 'usmc-seal.png'))),
      readAsset: id => {
        const file = attachment(input, id), bytes = Uint8Array.from(Buffer.from(file.dataBase64, 'base64'));
        return { id, name: file.name, type: file.mimeType, size: bytes.byteLength, data: bytes.buffer };
      },
      renderArtwork: async () => { throw new Error('Labelled stock artwork is not supported by companion Word export. Use the browser Word export or PDF.'); },
    }, new AbortController().signal, new Date());
    return new Uint8Array(await result.arrayBuffer());
  }
  const media = await prepareDocxImages(store, async id => Buffer.from(attachment(input, id).dataBase64, 'base64'));
  const tex = generateFlatLatex(store as never);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-companion-'));

  try {
    if (Object.keys(media).length) {
      for (const [path, bytes] of Object.entries(media)) await writeFile(join(dir, path), bytes);
    }
    await writeFile(join(dir, 'in.tex'), tex, 'utf-8');

    await new Promise<void>((resolve, reject) => {
      // Not `--sandbox`: the Debian build (pandoc-data split out) cannot find
      // its own docx data files under it and exits 97. Every field in the
      // .tex is escaped upstream, which is what keeps a caller's text from
      // naming a file here.
      const pandoc = spawn('pandoc', [
        'in.tex', '-f', 'latex+raw_tex', '-o', 'out.docx',
        '--lua-filter', join(LIB, 'pandoc', 'dondocs.lua'),
        '--reference-doc', join(LIB, 'pandoc', 'reference.docx'),
      ], { cwd: dir });

      let stderr = '';
      let settled = false;
      const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };

      const timer = setTimeout(() => {
        pandoc.kill('SIGKILL');
        finish(() => reject(new Error(`pandoc did not finish within ${PANDOC_TIMEOUT_MS}ms and was killed`)));
      }, PANDOC_TIMEOUT_MS);

      pandoc.stderr.on('data', (d) => { stderr += d; });
      pandoc.on('error', () => finish(() => reject(new Error('pandoc is not installed or not on PATH'))));
      pandoc.on('close', (code) => finish(() => (code === 0
        ? resolve()
        : reject(new Error(`pandoc exited ${code}: ${stderr}`)))));
    });

    return formatBodyTables(new Uint8Array(await readFile(join(dir, 'out.docx'))), store.paragraphs.flatMap(paragraph => paragraph.bodyTable ? [paragraph.bodyTable] : []));
  } finally {
    // Every conversion used to leave its scratch directory behind. One is
    // nothing; a companion left running for a week is thousands.
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best effort */ });
  }
}

import { resolvePublicationDestinations } from '../pdf/publicationDestinations';
import { validateFigureFiles } from './figureAssets';
import { ImageInputError, inspectRasterImage, supportsCorrespondenceSignatureImage } from '../docx/imageAssets';
import { OFFICE_FONT_ENCODING, OFFICE_FONT_FACES, OFFICE_FONT_FILES, OFFICE_FONT_UNICODE, type OfficeFontSource } from '../officeFonts';
/**
 * The LaTeX compile sequence, held once.
 *
 * Everything here is host-neutral: it takes a `LatexEngine` and already-loaded
 * assets and drives them in the order pdfTeX needs. What stays with the caller
 * is the part that genuinely differs — constructing the engine, and fetching the
 * assets (script tags and `fetch` in the browser, the filesystem in Node).
 *
 * The order is not arbitrary and is the reason this lives in one place:
 * folders must exist before any write; every preload must be queued before the
 * templates that reference them; `\input{\DocumentType}` resolves at the root,
 * so template prefixes have to be stripped. A second implementation of this
 * sequence got all three wrong in turn.
 */
import { LATEX } from '@/lib/constants';
import {
  ENGINE_FOLDERS,
  stripTemplatePrefix,
  type LatexEngine,
  type TexlivePackage,
} from './latexEngine';

/** Everything the engine needs in its filesystem before a compile. */
export interface EngineAssets {
  /** `.cls` / `.sty` / `.cfg` text members, content used as-is. */
  packages?: TexlivePackage[];
  /** Binary members — TFM metrics, Type1, virtual fonts — already decoded. */
  fonts?: TexlivePackage[];
  /** Bundled `tex/` + `templates/` sources, keyed by repo path. */
  templates?: Record<string, string>;
  /** Seal images keyed by bare filename; written under `attachments/`. */
  seals?: Record<string, Uint8Array>;
  /** Exact operating-system fonts for the optional loopback development server. */
  officeFonts?: OfficeFontSource;
}

/**
 * Some packages `\input{null}`. Preloading a stub under every format kpathsea
 * might ask for is cheaper than letting the lookup fail — a miss becomes a 404
 * fetch in the browser, and the engine caches the failure.
 */
const NULL_STUB = '% null stub file - prevents 404 errors\n\\endinput\n';
const NULL_PATHS = ['null', 'null.tex'];
const NULL_FORMATS = [0, 10, 26, 27, 32, 39];
const officeFontEngines = new WeakSet<LatexEngine>();

function officeFontMain(content: string): string {
  return content.replace('\\usepackage{times}', `\\usepackage{times}\n\\usepackage[T1]{fontenc}\n\\input{${OFFICE_FONT_UNICODE}}\n\\pdfgentounicode=1`)
    .replace('\\fontsize{12pt}{14.4pt}\\selectfont', '\\fontsize{12bp}{14.4pt}\\selectfont');
}

function officeFontMap(original: string): string {
  let map = original;
  for (const { metric, postScriptName, program } of OFFICE_FONT_FACES) {
    const entry = new RegExp(`^${metric} .+$`, 'm');
    if (!entry.test(map)) throw new Error(`The PDF font map is missing ${metric}.`);
    map = map.replace(entry, `${metric} ${postScriptName} " TeXBase1Encoding ReEncodeFont " <${OFFICE_FONT_ENCODING} <${program}`);
  }
  return map;
}

/**
 * Populate a freshly-loaded engine. Synchronous on purpose: every call posts a
 * message to the worker, and the worker's queue is FIFO, so ordering here is
 * ordering there. Awaiting between steps would buy nothing.
 */
export function prepareEngine(engine: LatexEngine, assets: EngineAssets): void {
  for (const dir of ENGINE_FOLDERS) {
    engine.makeMemFSFolder(dir);
  }

  for (const pkg of assets.packages ?? []) {
    const content = assets.officeFonts && pkg.filename === 'pdftex.map' && typeof pkg.content === 'string'
      ? officeFontMap(pkg.content) : pkg.content;
    engine.preloadTexliveFile(pkg.format, pkg.filename, content);
    if (assets.officeFonts && pkg.format === 28 && ['t1pcr.fd', 't1ptm.fd'].includes(pkg.filename)) {
      // The browser looks up LaTeX font definitions through the TeX input format.
      engine.preloadTexliveFile(26, pkg.filename, content);
    }
  }
  for (const font of assets.fonts ?? []) {
    engine.preloadTexliveFile(font.format, font.filename, font.content);
  }

  for (const format of NULL_FORMATS) {
    for (const path of NULL_PATHS) {
      engine.preloadTexliveFile(format, path, NULL_STUB);
    }
  }

  for (const [path, content] of Object.entries(assets.templates ?? {})) {
    const filename = stripTemplatePrefix(path);
    engine.writeMemFSFile(filename, filename === LATEX.MAIN_FILE && assets.officeFonts ? officeFontMain(content) : content);
  }

  if (assets.officeFonts) {
    officeFontEngines.add(engine);
    for (const filename of OFFICE_FONT_FILES) {
      const bytes = assets.officeFonts.read(filename);
      if (filename.endsWith('.vf')) engine.preloadTexliveFile(33, filename, bytes);
      else engine.writeMemFSFile(filename, bytes);
    }
  }

  // Also on the filesystem, in case a preload lookup misses.
  for (const path of NULL_PATHS) {
    engine.writeMemFSFile(path, NULL_STUB);
  }

  for (const [name, bytes] of Object.entries(assets.seals ?? {})) {
    engine.writeMemFSFile(`attachments/${name}`, bytes);
  }
}

/** A compile that produced no PDF. Carries the log so callers can diagnose. */
export class LatexCompileError extends Error {
  readonly log: string;
  readonly status: number;
  /** A corrupt format file needs the engine rebuilt, not just a retry. */
  readonly needsReset: boolean;

  constructor(status: number, log: string) {
    const needsReset = log.includes('Fatal format file error');
    super(needsReset ? 'ENGINE_RESET_NEEDED'
      : log.includes('Address block is too tall')
        ? 'The address and Via routing block does not fit on the opening page. Shorten the address or routing text before exporting.'
        : `LaTeX compilation failed (status ${status})`);
    this.name = 'LatexCompileError';
    this.status = status;
    this.log = log;
    this.needsReset = needsReset;
  }
}

/**
 * One compile queue per engine.
 *
 * The engine is single-instance and `compileLaTeX()` cannot overlap: two rapid
 * compiles can both pass `isReady()` before either flips the worker's Busy flag.
 * That is a property of the engine rather than of any one host, so the queue
 * belongs here — otherwise every host has to remember to serialize, and the one
 * that forgets fails intermittently under exactly the load that matters.
 *
 * Keyed weakly so a discarded engine takes its queue with it.
 */
const compileQueues = new WeakMap<LatexEngine, Promise<unknown>>();
export type LatexCompileProfile = 'standard' | 'tagged-correspondence';
export const TAGGED_MAIN_FILE = 'dondocs-tagged-main.tex';

async function runCompile(
  engine: LatexEngine,
  files: Record<string, string | Uint8Array>,
  profile: LatexCompileProfile
): Promise<Uint8Array> {
  if (!engine.isReady()) {
    throw new Error('Engine not ready');
  }

  await validateFigureFiles(files);

  const docType = typeof files['document.tex'] === 'string' ? /\\setDocumentType\{([^}]+)\}/.exec(files['document.tex'])?.[1] : undefined;
  if (docType && supportsCorrespondenceSignatureImage(docType) && typeof files['signatory.tex'] === 'string'
    && /\\setSignatureImage\{signature\.png\}/.test(files['signatory.tex'])) {
    const signature = files['attachments/signature.png'];
    if (!(signature instanceof Uint8Array)) throw new ImageInputError('The signature image is missing. Reattach a valid PNG before exporting.');
    try { await inspectRasterImage(signature, 'image/png'); }
    catch (error) {
      throw new ImageInputError(`Signature image: ${error instanceof ImageInputError ? error.message : 'Choose a valid PNG before exporting.'}`, { cause: error });
    }
  }

  for (const [path, content] of Object.entries(files)) {
    engine.writeMemFSFile(path, path === TAGGED_MAIN_FILE && typeof content === 'string' && officeFontEngines.has(engine)
      ? officeFontMain(content) : content);
  }

  if (profile !== 'standard' && profile !== 'tagged-correspondence') throw new Error('Unknown PDF compilation profile.');
  if (profile === 'tagged-correspondence' && typeof files[TAGGED_MAIN_FILE] !== 'string') throw new Error('The tagged PDF main source is missing.');
  // Always select the entry point, including after another profile failed.
  engine.setEngineMainFile(profile === 'tagged-correspondence' ? TAGGED_MAIN_FILE : LATEX.MAIN_FILE);
  let result = await engine.compileLaTeX();
  // Resolve stock-list page references and custom page totals from this draft,
  // rather than auxiliary data left behind by the previous draft.
  if (result.status === 0 && typeof files['document.tex'] === 'string' && (/\\setDocumentType\{(?:sl3|sl4|technical_volume)\}/.test(files['document.tex']) || files['document.tex'].includes('\\setPageNumberStyle{xofy}'))) {
    result = await engine.compileLaTeX();
  }

  if (result.status === 0 && result.pdf) {
    return typeof files['document.tex'] === 'string' && /\\setDocumentType\{(?:i_type|sl3|sl4|tm_ietm_front_matter|technical_volume)\}/.test(files['document.tex'])
      ? resolvePublicationDestinations(result.pdf, files['document.tex'].includes('\\setDocumentType{tm_ietm_front_matter}')) : result.pdf;
  }
  throw new LatexCompileError(result.status, result.log ?? '');
}

/**
 * Write the generated files and compile, serialized against any compile already
 * running on this engine. Throws `LatexCompileError` rather than returning null,
 * so a caller cannot mistake a failed compile for an empty one — which is the
 * shape of bug that ships a blank document.
 */
export function compileDocument(
  engine: LatexEngine,
  files: Record<string, string | Uint8Array>,
  profile: LatexCompileProfile = 'standard'
): Promise<Uint8Array> {
  // Strip the prior error before chaining so one caller's failure does not
  // reject the next caller's compile, but hand *this* caller the un-swallowed
  // promise so it still sees its own.
  const prior = compileQueues.get(engine) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(() => runCompile(engine, files, profile));
  compileQueues.set(engine, next.catch(() => undefined));
  return next;
}

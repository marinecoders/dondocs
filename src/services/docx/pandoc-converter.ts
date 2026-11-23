import { applyIndentMarkers, applyMemoAddressIndents } from './paragraphIndents';
export { applyIndentMarkers, applyMemoAddressIndents } from './paragraphIndents';
import { applyPageFurniture, getClassificationMarking, type PageFurniture } from './pageFurniture';
export { applyPageFurniture } from './pageFurniture';
export type { PageFurniture } from './pageFurniture';
import { correspondenceStationery, type StationerySize } from '@/lib/stationery';
import { applyLetterheadStyling, perfectLetterheadCentering } from './letterheadStyling';
import { applyBodyTableLayouts } from './bodyTables';
/**
 * Pandoc WASM Converter Service
 *
 * Converts flat LaTeX to DOCX using pandoc 3.9+ WASM running entirely in-browser.
 * Lazy-loads the WASM module on first use (~58MB download, cached by service worker).
 *
 * Pipeline: flat LaTeX string → pandoc WASM → DOCX Blob
 *
 * The pandoc.js module (public/lib/pandoc/pandoc.js) exports:
 *   convert(options, stdin, files) → { stdout, stderr, warnings }
 * where files is a mutable Record<string, Blob> — output files are added to it.
 */

import JSZip from 'jszip';
import { getDocxFontName, LAYOUT, layoutToMetadata } from './layout-config';
import { debug } from '@/lib/debug';
import { RUNTIME_BASE } from '@/lib/releasePaths';

const BASE_PATH = RUNTIME_BASE;

interface PandocModule {
  convert: (
    options: Record<string, unknown>,
    stdin: string | null,
    files: Record<string, Blob>
  ) => Promise<{ stdout: string; stderr: string; warnings: unknown[] }>;
  query: (options: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Phased progress events for DOCX conversion.
 *
 * Phases run roughly in this order the FIRST time a DOCX is generated:
 *   preparing → fetching-engine → instantiating → fetching-support → converting → postprocessing
 *
 * On subsequent calls the pandoc WASM module is already cached in memory,
 * so only `preparing → converting → postprocessing` will fire.
 *
 * `fetching-engine` carries optional `loaded`/`total` byte counts; all other
 * phases are status-only.
 */
export type DocxProgressPhase =
  | { kind: 'preparing' }
  | { kind: 'fetching-engine'; loaded: number; total: number }
  | { kind: 'instantiating' }
  | { kind: 'fetching-support' }
  | { kind: 'converting' }
  | { kind: 'postprocessing' };

export type DocxProgressCallback = (phase: DocxProgressPhase) => void;

// Low-level event shape emitted by pandoc.js (see public/lib/pandoc/pandoc.js).
type PandocLoaderEvent =
  | { kind: 'fetch-start' }
  | { kind: 'fetch-progress'; loaded: number; total: number }
  | { kind: 'instantiate-start' }
  | { kind: 'ready' };

// Singleton: lazily loaded pandoc module
let pandocModule: PandocModule | null = null;
let loadPromise: Promise<PandocModule> | null = null;
let failedModuleLoads = 0;

// Cached support files
let referenceDocxBlob: Blob | null = null;
let luaFilterBlob: Blob | null = null;

async function loadPandocModule(): Promise<PandocModule> {
  // pandoc.js is an ES module with top-level await; it loads the WASI shim
  // and the pandoc WASM parts same-origin from /lib/pandoc/ (vendored at
  // build time — air-gap safe, no CDN). It lives in public/ and must NOT go
  // through Vite's transform pipeline.
  // We construct a full absolute URL so the browser loads it directly.
  const moduleUrl = new URL(`${BASE_PATH}lib/pandoc/pandoc.js`, window.location.origin);
  // Browsers cache a rejected module evaluation, including a failed top-level
  // WASM fetch. A fresh URL lets an explicit retry evaluate the loader again.
  if (failedModuleLoads) moduleUrl.searchParams.set('retry', String(failedModuleLoads));
  debug.log('DOCX', `Loading pandoc WASM module from ${moduleUrl}`);
  debug.time('DOCX:loadPandocModule');
  try {
    const mod = await import(/* @vite-ignore */ moduleUrl.href);
    debug.timeEnd('DOCX:loadPandocModule');
    return mod as PandocModule;
  } catch (error) {
    failedModuleLoads += 1;
    throw error;
  }
}

export function pandocSupportFileUrl(filename: string, buildTime = __BUILD_TIME__): string {
  return `${BASE_PATH}lib/pandoc/${filename}?v=${encodeURIComponent(buildTime)}`;
}

async function fetchSupportFile(filename: string): Promise<Blob> {
  const url = pandocSupportFileUrl(filename);
  debug.verbose('DOCX', `Fetching support file: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    debug.error('DOCX', `Failed to fetch ${filename}: HTTP ${response.status}`);
    throw new Error(`Failed to fetch ${filename}: ${response.status}`);
  }
  const blob = await response.blob();
  debug.verbose('DOCX', `Fetched ${filename}: ${(blob.size / 1024).toFixed(1)} KB`);
  return blob;
}

/**
 * Install a progress hook that pandoc.js will call during its top-level
 * WASM fetch + instantiation. Must be set BEFORE the dynamic import() of
 * pandoc.js resolves for the first time.
 *
 * Returns a cleanup function that restores the previous hook (or removes it).
 *
 * Note: if the pandoc module is already cached from a prior call, the hook
 * will never fire — top-level await only runs once per module URL.
 */
function installPandocLoaderHook(
  onEvent: (event: PandocLoaderEvent) => void
): () => void {
  const scope = globalThis as typeof globalThis & {
    __dondocsPandocProgress?: (event: PandocLoaderEvent) => void;
  };
  const previous = scope.__dondocsPandocProgress;
  scope.__dondocsPandocProgress = onEvent;
  return () => {
    if (previous) {
      scope.__dondocsPandocProgress = previous;
    } else {
      delete scope.__dondocsPandocProgress;
    }
  };
}

async function ensureLoaded(
  onLoaderEvent?: (event: PandocLoaderEvent) => void
): Promise<PandocModule> {
  if (pandocModule) {
    debug.verbose('DOCX', 'Pandoc module already loaded (cached)');
    return pandocModule;
  }

  if (!loadPromise) {
    // Install the loader hook BEFORE we kick off the dynamic import, because
    // pandoc.js uses top-level await and will start fetching the WASM binary
    // the moment the import resolves. A hook installed after `import()` would
    // miss the `fetch-start`/`fetch-progress` events on the first load.
    const cleanup = onLoaderEvent ? installPandocLoaderHook(onLoaderEvent) : () => {};

    loadPromise = (async () => {
      debug.log('DOCX', 'Initializing pandoc WASM (first load)...');
      debug.time('DOCX:ensureLoaded');

      try {
        // Load pandoc WASM module and support files in parallel
        const [mod, refDocx, luaFilter] = await Promise.all([
          loadPandocModule(),
          referenceDocxBlob ? Promise.resolve(referenceDocxBlob) : fetchSupportFile('reference.docx'),
          luaFilterBlob ? Promise.resolve(luaFilterBlob) : fetchSupportFile('dondocs.lua'),
        ]);

        pandocModule = mod;
        referenceDocxBlob = refDocx;
        luaFilterBlob = luaFilter;

        debug.timeEnd('DOCX:ensureLoaded');
        debug.log('DOCX', 'Pandoc WASM ready');
        return mod;
      } catch (error) {
        // A transient support-file failure must not poison every later export
        // in this tab. Let Retry (or the first export after a failed idle
        // prefetch) fetch the missing resources again.
        loadPromise = null;
        throw error;
      } finally {
        cleanup();
      }
    })();
  }

  return loadPromise;
}

/**
 * Prefetch the pandoc WASM module + support files during browser idle time.
 *
 * Populates the in-memory singleton, the browser's HTTP cache, and the
 * workbox runtime cache (90-day CacheFirst — see vite.config.ts) so that
 * the FIRST user-initiated DOCX export feels instant rather than a 5-15s
 * wait for the ~58 MB WASM download.
 *
 * Safe to call multiple times — `ensureLoaded` short-circuits via the
 * singleton + in-flight loadPromise. Errors are swallowed; a persistent
 * loading failure surfaces later when the user actually exports DOCX.
 *
 * Should be gated on connection type by the caller (see
 * `usePandocIdlePrefetch`) so we don't burn cellular data for users who
 * never export DOCX.
 */
export async function prefetchPandocModule(): Promise<void> {
  try {
    await ensureLoaded();
    debug.log('DOCX', 'Idle prefetch: pandoc WASM cached for next DOCX export');
  } catch (err) {
    // Don't surface to user -- the actual export call will retry and
    // produce a real error then, with proper UI feedback.
    debug.verbose('DOCX', 'Idle prefetch failed (will retry on first export)', err);
  }
}

/**
 * Read a .docx file's text content by running pandoc WASM in reverse
 * (docx → plain). Used by the letter importer so the same SECNAV parser can
 * consume Word documents, not just PDFs. Everything runs in-browser, offline.
 *
 * The bytes are handed to pandoc through the virtual-FS `files` map (binary
 * input can't go through the string `stdin` channel — it would be mangled by
 * UTF-8 encoding); `input-files` names the entry to read. `wrap: 'none'` keeps
 * each source paragraph on a single line so the line-oriented header parser
 * sees "From:", "To:", "Subj:" intact rather than hard-wrapped at 72 columns.
 */
export async function convertDocxToPlainText(bytes: Uint8Array): Promise<string> {
  const mod = await ensureLoaded();

  // Copy into a standalone ArrayBuffer so the Blob owns its bytes regardless of
  // how the caller allocated the view (e.g. a subarray of a larger buffer).
  const buffer = bytes.slice().buffer;
  const files: Record<string, Blob> = {
    'input.docx': new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  };

  const options: Record<string, unknown> = {
    from: 'docx',
    to: 'plain',
    'input-files': ['input.docx'],
    'output-file': 'output.txt',
    wrap: 'none',
  };

  debug.log('DOCX', 'Reading DOCX text via pandoc (docx → plain)...');
  const result = await mod.convert(options, null, files);
  if (result.stderr) debug.warn('DOCX', `Pandoc docx-read stderr: ${result.stderr}`);

  const out = files['output.txt'];
  if (out && out.size > 0) return out.text();
  // Fall back to stdout if the build streams the result there instead.
  return result.stdout ?? '';
}

const XML_TEXT_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<', gt: '>', quot: '"', apos: "'", amp: '&',
};

// Decode one XML layer, including decimal/hexadecimal character references.
// A single pass keeps both "&amp;lt;" and "&#38;lt;" as literal "&lt;".
function decodeXmlText(s: string): string {
  return s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-fA-F]+);/g, (entity, reference: string) => {
    if (!reference.startsWith('#')) return XML_TEXT_ENTITIES[reference] ?? entity;
    const hexadecimal = reference.startsWith('#x');
    const point = Number.parseInt(reference.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    const valid = point === 9 || point === 10 || point === 13
      || point >= 0x20 && point <= 0xD7FF || point >= 0xE000 && point <= 0xFFFD
      || point >= 0x10000 && point <= 0x10FFFF;
    return valid ? String.fromCodePoint(point) : entity;
  });
}

/**
 * Extract the text of a .docx file's headers and footers, one line per source
 * paragraph. The classification banner is rendered into the Word page header
 * and footer (word/header*.xml, word/footer*.xml), which pandoc's body-only
 * `docx → plain` read never sees — so the importer reads these parts directly
 * to recover the banner marking. Pure text, in-browser (JSZip), no network.
 *
 * Rather than strip tags from the raw XML (an incomplete, injection-prone form
 * of sanitization), it pulls the text out of each `<w:t>` run and joins the runs
 * within a `<w:p>` paragraph — OOXML run text contains no nested markup, so this
 * is exact. Paragraphs become newlines, keeping the banner on its own line.
 */
export async function extractDocxMarkingText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes.slice().buffer);
  const parts = Object.keys(zip.files).filter((n) => /word\/(?:header|footer)\d*\.xml$/i.test(n));
  const chunks: string[] = [];
  for (const name of parts) {
    const xml = await zip.files[name].async('string');
    const lines: string[] = [];
    // Split on the paragraph close tag so each <w:p> becomes its own line.
    for (const paragraph of xml.split(/<\/w:p>/)) {
      const runs = [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
      const text = decodeXmlText(runs.join('')).replace(/[ \t]+/g, ' ').trim();
      if (text) lines.push(text);
    }
    if (lines.length) chunks.push(lines.join('\n'));
  }
  return chunks.join('\n');
}

function getSealFilename(sealType?: string, letterheadColor?: string): string {
  const type = sealType || 'dow';
  const bwSuffix = letterheadColor === 'black' ? '-bw' : '';
  return `${type}-seal${bwSuffix}.png`;
}

async function fetchSealImage(sealType?: string, letterheadColor?: string): Promise<{ path: string; blob: Blob }> {
  const filename = getSealFilename(sealType, letterheadColor);
  const url = `${BASE_PATH}attachments/${filename}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch seal image ${filename}: ${response.status}`);
  }
  return { path: filename, blob: await response.blob() };
}

/** Map fontSize string (e.g. '12pt') to OOXML half-points (e.g. 24) */
function getFontSizeHalfPoints(fontSize: string): number {
  const map: Record<string, number> = { '10pt': 20, '11pt': 22, '12pt': 24 };
  return map[fontSize] || 24;
}

/**
 * Post-process pandoc DOCX output to fix known pandoc writer limitations:
 *
 * 1. Zero out table cell padding — pandoc adds ~0.08in (115 twips) by default,
 *    which pushes content away from column edges and breaks precise alignment.
 *
 * 2. Rescale table gridCol widths — pandoc hardcodes textwidth = 7920 twips
 *    (5.5in, assuming 1.5in margins) in its DOCX writer (Table.hs). Our layout
 *    uses 1in margins → 6.5in = 9360 twips. We scale all gridCol values by
 *    9360/7920 so column proportions render at the correct absolute widths.
 *
 * 3. Ensure page geometry — inject US Letter pgSz and 1in pgMar into sectPr
 *    if missing, so Word uses the correct page dimensions.
 *
 * 4. Apply font family and size — update document defaults in styles.xml
 *    to match the user's font selection, since pandoc ignores LaTeX font
 *    settings when producing DOCX.
 */
/**
 * Everything the DOCX writer needs from the document beyond its LaTeX.
 *
 * An object rather than positional arguments: these are all `formData` fields
 * read at one call site, and the last two arrived only because the Word export
 * had been silently ignoring two settings the PDF honours. Six loose strings
 * was already at the edge of readable; eight would not be.
 */
export interface DocxConversionOptions {
  bodyTables?: readonly import('@/lib/bodyTable').BodyTable[];
  /** Captured PNG/JPEG bytes, addressed only by generated attachment paths. */
  mediaFiles?: import('./imageAssets').DocxMedia;
  docType?: string;
  sealType?: string;
  letterheadColor?: string;
  stationerySize?: StationerySize;
  letterheadMode?: import('@/lib/letterheadMode').LetterheadMode;
  fontFamily?: string;
  fontSize?: string;
  classLevel?: string;
  customClassification?: string;
  /** Repeat "Subj:" at the top of pages 2+ — SECNAV M-5216.5 ¶7-16. */
  showSubjectOnContinuation?: boolean;
  directiveContinuation?: PageFurniture['directiveContinuation'];
  /** 'none' | 'simple' | 'xofy'; custom totals include the first page. */
  pageNumbering?: string;
  /**
   * First page's number. Above 1 means this document continues an earlier one's
   * sequence — an endorsement — and Ch 9 Fig 9-2 numbers its opening sheet.
   */
  startingPageNumber?: number;
}

/**
 * Recover the subject text from the rendered document so the continuation
 * header can repeat it verbatim.
 *
 * Reading it back out of `document.xml` beats threading it down from the store:
 * `convertLatexToDocx` already takes six loose formData fields, and the subject
 * here is guaranteed to be the one that actually rendered — same escaping, same
 * casing, same underline decision — rather than a second derivation of it that
 * can drift.
 *
 * Three shapes have to be recognised, because the label is not one string and
 * the block is not always a table:
 *
 *   - letters and endorsements  — a two-column row labelled "Subj:"
 *   - memoranda and executive   — the same, labelled "SUBJECT:" (Ch 12 ¶2l)
 *   - business letters          — a bare paragraph, "SUBJECT: ..." , no table
 *
 * Matching only the first shape is not a smaller fix, it is a silent one: the
 * PDF templates carry \ContinuationSubject for all of them, so a memo would
 * repeat its subject in the PDF and not in the Word file, with nothing to say
 * why.
 *
 * Returns '' when the document has no subject line at all, which is correct for
 * a same-page endorsement (`skipSubject`).
 *
 * The label comes back with the text because the continuation header has to
 * repeat whichever one this document uses — see continuationSubjectParagraph.
 */
const SUBJECT_LABELS = ['Subj:', 'SUBJECT:'];

export function extractSubjectFromDocument(xml: string): string {
  // Read only text nodes: a loose `w:t` prefix also matches w:tab and can
  // consume the following text run. Decode once because page furniture will
  // escape this plain text again when writing the continuation header.
  const textOf = (fragment: string) => decodeXmlText(
    [...fragment.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(?:br|cr|tab)\b[^>]*\/>|<\/w:p>/g)]
      .map(match => match[1] ?? ' ')
      .join(''),
  ).replace(/[ \t\r\n]+/g, ' ').trim();

  for (const row of xml.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g) || []) {
    const [label, value] = row.match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g) || [];
    if (!label || !value) continue;
    const labelText = textOf(label);
    if (SUBJECT_LABELS.includes(labelText)) return `${labelText}  ${textOf(value)}`;
  }

  // Business letters render the subject as an ordinary paragraph. Tables are
  // searched first so a document carrying both cannot match the looser shape.
  for (const paragraph of xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []) {
    const text = textOf(paragraph);
    const label = SUBJECT_LABELS.find(l => text.startsWith(l));
    if (label) return `${label}  ${text.slice(label.length).trim()}`;
  }
  return '';
}

/** Convert letterheadColor setting to OOXML color hex (without #) */
function getLetterheadColorHex(letterheadColor?: string): string {
  // PMS 288 navy blue per MCO 5216.20B Section 2, para 1.a
  // RGB(0, 32, 91) = hex 00205B
  return letterheadColor === 'black' ? '000000' : '00205B';
}

export async function postProcessDocx(
  docxBlob: Blob,
  {
    docType,
    fontFamily = 'times',
    fontSize = '12pt',
    letterheadColor,
    letterheadMode,
    stationerySize,
    classLevel,
    customClassification,
    showSubjectOnContinuation,
    directiveContinuation,
    pageNumbering,
    startingPageNumber,
    bodyTables = [],
  }: DocxConversionOptions = {},
): Promise<Blob> {
  const stock = correspondenceStationery(docType, { stationerySize });
  if (stock.small && classLevel === 'custom') throw new Error('Custom classification banners require US Letter stock.');
  debug.log('DOCX', `Post-processing DOCX (${(docxBlob.size / 1024).toFixed(1)} KB)`);
  debug.time('DOCX:postProcess');
  debug.verbose('DOCX', `Options: font=${fontFamily}, size=${fontSize}, color=${letterheadColor}, class=${classLevel}`);

  const zip = await JSZip.loadAsync(await docxBlob.arrayBuffer());
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    debug.warn('DOCX', 'No word/document.xml found in DOCX — skipping post-processing');
    return docxBlob;
  }

  let xml = await docFile.async('string');
  debug.verbose('DOCX', `document.xml size: ${(xml.length / 1024).toFixed(1)} KB`);

  // --- 1. Zero out table cell margins ---
  debug.verbose('DOCX', 'Step 1: Zeroing table cell margins');
  const ZERO_MARGINS = '<w:tblCellMar>'
    + '<w:top w:w="0" w:type="dxa"/>'
    + '<w:left w:w="0" w:type="dxa"/>'
    + '<w:bottom w:w="0" w:type="dxa"/>'
    + '<w:right w:w="0" w:type="dxa"/>'
    + '</w:tblCellMar>';

  // Replace any existing tblCellMar blocks with zero margins
  xml = xml.replace(/<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/g, ZERO_MARGINS);

  // For tblPr elements that don't have tblCellMar, inject zero margins before </w:tblPr>
  xml = xml.replace(/<\/w:tblPr>/g, (match) => {
    return ZERO_MARGINS + match;
  });

  // Deduplicate: if a tblPr now has two tblCellMar blocks, keep only one
  xml = xml.replace(
    /(<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>)\s*<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/g,
    '$1'
  );

  // --- 2. Rescale gridCol widths from pandoc's 7920 to our 9360 twips ---
  // Pandoc hardcodes textwidth = 7920 in Table.hs (5.5in with 1.5in margins).
  // Our layout uses 1in margins → 6.5in text width = 9360 twips.
  const PANDOC_TEXT_WIDTH = 7920;
  const TARGET_TEXT_WIDTH = Math.round(stock.textWidth * 1440); // 6.5in × 1440 twips/in
  const SCALE = TARGET_TEXT_WIDTH / PANDOC_TEXT_WIDTH;
  debug.verbose('DOCX', `Step 2: Rescaling gridCol widths (${PANDOC_TEXT_WIDTH} → ${TARGET_TEXT_WIDTH} twips, scale=${SCALE.toFixed(4)})`);

  xml = xml.replace(/<w:gridCol w:w="(\d+)"\s*\/>/g, (_match, width) => {
    const scaled = Math.round(parseInt(width, 10) * SCALE);
    return `<w:gridCol w:w="${scaled}"/>`;
  });

  // --- 2b. Normalize gridCol sums to exactly TARGET_TEXT_WIDTH ---
  // Individual Math.round() on each column can cause rounding drift of a few
  // twips. Walk each <w:tblGrid> and adjust the widest column so the total
  // is exactly 9360 twips (6.5in). A 2-twip error is 0.035mm — invisible,
  // but we enforce exactness for pixel-perfect SECNAV compliance.
  xml = xml.replace(
    /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g,
    (_match, inner: string) => {
      const colMatches = [...inner.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)];
      if (colMatches.length === 0) return _match;

      const widths = colMatches.map(m => parseInt(m[1], 10));
      const total = widths.reduce((a, b) => a + b, 0);
      const drift = TARGET_TEXT_WIDTH - total;

      if (drift !== 0) {
        // Add the drift to the widest column (least relative impact)
        const maxIdx = widths.indexOf(Math.max(...widths));
        widths[maxIdx] += drift;
        debug.verbose('DOCX', `Normalized tblGrid: adjusted col ${maxIdx} by ${drift} twips (${total} → ${TARGET_TEXT_WIDTH})`);
      }

      const newGrid = '<w:tblGrid>'
        + widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')
        + '</w:tblGrid>';
      return newGrid;
    }
  );

  // --- 3. Fix table width rounding: 4995 → 5000 (100%) ---
  debug.verbose('DOCX', 'Step 3: Fixing table width rounding (4995 → 5000)');
  // Pandoc sometimes rounds 3-col proportions to 4995 instead of 5000 (99.9% vs 100%).
  // This causes the letterhead table to be slightly narrower than the text width.
  xml = xml.replace(/w:w="4995"/g, 'w:w="5000"');

  // --- 3b. Perfect letterhead centering ---
  debug.verbose('DOCX', 'Step 3b: Enforcing symmetric letterhead centering');
  // The letterhead table must have exactly symmetric seal/spacer columns
  // so the center column is precisely centered on the page. Rounding in
  // pandoc's column width calculation + our rescaling can introduce a
  // few-twip asymmetry. We detect the letterhead table (first table with
  // a drawing) and force exact gridCol values from our layout config.
  const letterheadResult = letterheadMode === 'preprinted' || letterheadMode === 'title-only'
    ? { xml, hasLetterheadSeal: false } : perfectLetterheadCentering(xml, TARGET_TEXT_WIDTH);
  xml = letterheadResult.xml;
  const hasLetterheadSeal = letterheadResult.hasLetterheadSeal;

  // --- 4. Remove unwanted empty paragraphs ---
  debug.verbose('DOCX', 'Step 4: Removing empty paragraphs between tables');
  // Pandoc inserts empty paragraphs between tables and at the start of the document.
  // These have either no content (<w:p />) or just a style (<w:p><w:pPr>...</w:pPr></w:p>).
  // Remove them between adjacent tables and at the document start.
  // The Lua filter's spacing_para handles all intentional spacing via w:before.

  // Remove empty styled paragraphs between tables (e.g. <w:p><w:pPr><w:pStyle .../></w:pPr></w:p>)
  xml = xml.replace(
    /<\/w:tbl>\s*<w:p><w:pPr><w:pStyle[^/]*\/><\/w:pPr><\/w:p>\s*<w:tbl>/g,
    '</w:tbl><w:tbl>'
  );
  // Also handle bare <w:p /> between tables
  xml = xml.replace(
    /<\/w:tbl>\s*<w:p\s*\/>\s*<w:tbl>/g,
    '</w:tbl><w:tbl>'
  );

  // Remove empty styled paragraph at the very start of body (before first table)
  xml = xml.replace(
    /(<w:body>)\s*<w:p><w:pPr><w:pStyle[^/]*\/><\/w:pPr><\/w:p>\s*/g,
    '$1'
  );
  // Also handle bare <w:p /> at body start
  xml = xml.replace(
    /(<w:body>)\s*<w:p\s*\/>\s*/g,
    '$1'
  );

  // Remove empty styled paragraphs between a spacing paragraph and a table
  // (the \noindent generates an empty paragraph that pandoc wraps with BodyText style)
  xml = xml.replace(
    /(<w:p><w:pPr><w:spacing[^/]*\/><\/w:pPr><\/w:p>)\s*<w:p><w:pPr><w:pStyle[^/]*\/><\/w:pPr><\/w:p>\s*<w:tbl>/g,
    '$1<w:tbl>'
  );

  // --- 4b. Constrain empty spacer rows in address/label tables ---
  // Pandoc ignores \\[12pt] row spacing in tabular, so we emit explicit empty
  // spacer rows (`& \\`) between To/Via and Subj. Pandoc creates a full-height
  // empty row in the DOCX. We detect these (all cells have no text content) and
  // set w:trHeight to 240 twips (12pt) to match the PDF's \tabularnewline[12pt].
  // An empty row is: <w:tr> containing only <w:tc> with no <w:t> elements.
  {
    let spacerRowsFixed = 0;
    xml = xml.replace(
      /<w:tr>([\s\S]*?)<\/w:tr>/g,
      (_match, inner: string) => {
        // Only process rows that have NO text content at all
        // Use regex to match actual <w:t> or <w:t ...> elements, not <w:tcPr> etc.
        // An image-only row has no w:t, but still needs its natural height.
        // A fixed 12pt row clips inline signatures when Word lays out the file.
        if (/<w:(?:t|drawing|pict|object)(?:[ >])/.test(inner)) return _match;
        // Must have at least one cell (not a malformed row)
        if (!inner.includes('<w:tc>')) return _match;
        // Skip if already has trPr (don't double-process)
        if (inner.includes('<w:trPr>')) return _match;

        // This is an empty spacer row — add trHeight of 240 twips (12pt)
        // w:hRule="exact" forces the height rather than treating it as minimum
        // 12pt matches SECNAV standard gap before Subj line per Ch 7
        spacerRowsFixed++;
        return `<w:tr><w:trPr><w:trHeight w:val="240" w:hRule="exact"/></w:trPr>${inner}</w:tr>`;
      }
    );
    debug.verbose('DOCX', `Step 4b: Constrained ${spacerRowsFixed} empty spacer row(s) to 12pt height`);
  }

  // --- 5. Enforce page geometry in sectPr ---
  // US Letter = 12240 × 15840 twips (8.5in × 11in)
  // Top margin depends on whether the document has a letterhead with seal:
  //   - WITH seal: 720 twips (0.5in) per SECNAV App C ¶1b — seal is 0.5in from top edge.
  //     The letterhead table (~1.09in tall) pushes content past the 1.0in mark naturally.
  //   - WITHOUT seal: 1440 twips (1.0in) standard margin per SECNAV Ch 7 ¶1.
  // Side/bottom margins = 1440 twips (1in) in all cases.
  const topMargin = stock.small ? 1440 : hasLetterheadSeal || letterheadMode === 'title-only' || letterheadMode === 'preprinted' ? 720 : 1440;
  debug.log('DOCX', `Step 5: Enforcing US Letter page geometry (${topMargin / 1440}in top, 1in sides)${hasLetterheadSeal ? ' — seal detected, 0.5in top' : ''}`);
  const PG_SZ = `<w:pgSz w:w="${Math.round(stock.width * 1440)}" w:h="${Math.round(stock.height * 1440)}" w:orient="portrait"/>`;
  const PG_MAR = `<w:pgMar w:top="${topMargin}" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>`;

  // Always replace existing pgSz and pgMar to enforce US Letter with 1in margins.
  // Pandoc WASM may output A4 dimensions (11906 × 16838) or non-standard margins
  // from its built-in default reference, even when our reference.docx specifies
  // US Letter. We must forcibly override to ensure compliance.
  const oldPgSz = xml.match(/<w:pgSz[^>]*\/?>/)?.[0];
  const oldPgMar = xml.match(/<w:pgMar[^>]*\/?>/)?.[0];
  if (oldPgSz) {
    debug.verbose('DOCX', `Original pgSz: ${oldPgSz}`);
    debug.verbose('DOCX', `Replacing with: ${PG_SZ}`);
  }
  if (oldPgMar) {
    debug.verbose('DOCX', `Original pgMar: ${oldPgMar}`);
    debug.verbose('DOCX', `Replacing with: ${PG_MAR}`);
  }
  xml = xml.replace(/<w:pgSz[^>]*\/?>/g, PG_SZ);
  xml = xml.replace(/<w:pgMar[^>]*\/?>/g, PG_MAR);

  // If sectPr exists but has no pgSz/pgMar (edge case), inject them
  if (!xml.includes('<w:pgSz')) {
    xml = xml.replace(/<\/w:sectPr>/g, `${PG_SZ}${PG_MAR}</w:sectPr>`);
  }

  // --- 6. Apply letterhead color and font sizes ---
  // Per SECNAV M-5216.5 App C §2a, the letterhead text should be colored
  // (PMS 288 navy blue or black) with specific font sizes (10pt bold dept/unit,
  // 8pt address). Pandoc drops \fontsize and doesn't convert \textcolor to
  // w:color in the DOCX writer, so we apply these in post-processing.
  const colorHex = getLetterheadColorHex(letterheadColor);
  debug.log('DOCX', `Step 6: Applying letterhead styling (color=#${colorHex})`);
  if (letterheadMode !== 'preprinted') xml = applyLetterheadStyling(xml, colorHex);

  // --- 6+. Fix seal image dimensions ---
  // The DoW/DoD seal PNGs have transparent padding (~8%) around the artwork.
  // At width=1in the visible seal is only ~0.92in. Compensate by scaling to
  // 1.09in (= 1.0 / 0.919) so the printed artwork measures ~1.0in per SECNAV
  // App C ¶1b "1-inch diameter DoD seal". The flat-generator already sets
  // \includegraphics[width=1.09in] but pandoc converts this to EMU using the
  // image's native DPI, which may not produce the correct output size.
  // Force the DOCX extent to exactly 1.09in = 996696 EMU.
  {
    const SEAL_EMU = Math.round(1.09 * 914400); // 996696
    const old914 = xml.match(/<wp:extent cx="914400"/);
    if (old914) {
      xml = xml.replace(
        /<wp:extent cx="914400" cy="914400"\/>/g,
        `<wp:extent cx="${SEAL_EMU}" cy="${SEAL_EMU}"/>`
      );
      xml = xml.replace(
        /<a:ext cx="914400" cy="914400"\/>/g,
        `<a:ext cx="${SEAL_EMU}" cy="${SEAL_EMU}"/>`
      );
      debug.verbose('DOCX', `Seal image scaled: 914400 → ${SEAL_EMU} EMU (1.0in → 1.09in)`);
    }
  }

  // NOTE: 2-column table widths (SSIC, address, signature, dual-sig) are
  // handled by the Lua filter (dondocs.lua Pass 2) which classifies tables
  // by structure and applies correct proportions. Step 2 rescales all widths
  // from pandoc's 7920 to our 9360 twips. No further gridCol fixup needed.

  // --- 6a. Convert leading indent markers to w:ind ---
  // The Lua filter cannot emit OpenXML inline, so \dondocs*indent{Xin} arrives
  // as a run of marker characters at the start of a paragraph. Each macro uses
  // a different character so this pass can tell them apart.
  debug.verbose('DOCX', 'Step 6a: Converting indent markers to w:ind');
  xml = applyIndentMarkers(xml);
  xml = applyMemoAddressIndents(xml);

  // Keep the first acknowledgement together when it fits, including its header.
  // Additional endorsements keep their last two body paragraphs with the signer.
  // Word can split an oversized group; widow control retains two text lines.
  let endorsementTail = false;
  let closingTail = false;
  xml = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (paragraph.includes('w:name="DonDocsClosingTail"')) closingTail = true;
    if (paragraph.includes('w:name="DonDocsSignatureEnd"')) closingTail = false;
    if (paragraph.includes('w:name="DonDocsAckStartFIRST')) endorsementTail = true;
    if (paragraph.includes('w:name="DonDocsAckTail')) endorsementTail = true;
    if (paragraph.includes('w:name="DonDocsAckSignature')) endorsementTail = false;
    if (!endorsementTail && !closingTail) return paragraph;
    const properties = '<w:keepNext/><w:widowControl/>';
    return paragraph.includes('<w:pPr>')
      ? paragraph.replace(/<w:pPr>(<w:pStyle\b[^>]*\/>)?/, (_, style = '') => `<w:pPr>${style}${properties}`)
      : paragraph.replace(/(<w:p(?:\s[^>]*)?>)/, `$1<w:pPr>${properties}</w:pPr>`);
  });

  // --- 6b. Page header and footer ---
  // Three separate things share one mechanism: the classification marking (every
  // page), the repeated subject line (¶7-16, pages 2+) and the page number
  // (¶7-17, pages 2+). Skipped entirely when the document wants none of them,
  // so an unclassified single-page letter keeps the parts-free zip it had.
  const classMarking = getClassificationMarking(classLevel, customClassification);
  const continuationSubject = showSubjectOnContinuation ? extractSubjectFromDocument(xml) : '';
  const wantsPageNumbers = !!pageNumbering && pageNumbering !== 'none';
  // LibreOffice applies a restart on an opening table to the table rather
  // than the page's PAGE field. Anchor it to a nearly zero-height paragraph
  // so continued letterhead documents print their opening number as well.
  if (startingPageNumber && startingPageNumber > 1) {
    xml = xml.replace(/(<w:body>\s*)(?=<w:tbl\b)/,
      '$1<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr></w:p>');
  }
  debug.verbose(
    'DOCX',
    `Step 6b: marking="${classMarking || 'none'}" continuationSubj="${continuationSubject || 'none'}" pageNumbers=${wantsPageNumbers}`,
  );
  if (classMarking || continuationSubject || directiveContinuation || wantsPageNumbers) {
    xml = await applyPageFurniture(zip, xml, {
      marking: classMarking,
      continuationSubject,
      directiveContinuation,
      wantsPageNumbers,
      startPage: Math.max(1, Math.trunc(startingPageNumber || 1)),
      numberFirstPage: docType === 'new_page_endorsement' || pageNumbering === 'xofy',
      pageNumbering,
      fontSizePt: parseInt(fontSize, 10) || 12,
    });
  }

  xml = applyBodyTableLayouts(xml, bodyTables, TARGET_TEXT_WIDTH, docType === 'coordination_page');
  zip.file('word/document.xml', xml);
  debug.verbose('DOCX', `Updated document.xml: ${(xml.length / 1024).toFixed(1)} KB`);

  // --- 7. Apply font family and size to styles.xml ---
  debug.log('DOCX', `Step 7: Applying font defaults (${getDocxFontName(fontFamily)}, ${fontSize})`);
  // Pandoc's DOCX writer often produces minimal/empty docDefaults
  // (e.g. <w:rPrDefault/> and <w:pPrDefault/> as self-closing tags).
  // We replace the entire docDefaults block with properly populated values
  // that set font family, size, and line spacing to match the user's selection.
  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    let stylesXml = await stylesFile.async('string');
    const fontName = getDocxFontName(fontFamily);
    const sizeHp = getFontSizeHalfPoints(fontSize);
    // Auto spacing uses 240ths of a line, independently of the font's size.
    const lineSpacing = 240;

    const newDocDefaults = '<w:docDefaults>'
      + '<w:rPrDefault><w:rPr>'
      + `<w:rFonts w:ascii="${fontName}" w:eastAsia="${fontName}" w:hAnsi="${fontName}" w:cs="${fontName}"/>`
      + `<w:sz w:val="${sizeHp}"/>`
      + `<w:szCs w:val="${sizeHp}"/>`
      + '<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/>'
      + '</w:rPr></w:rPrDefault>'
      + '<w:pPrDefault><w:pPr>'
      + `<w:spacing w:after="0" w:line="${lineSpacing}" w:lineRule="auto"/>`
      + '</w:pPr></w:pPrDefault>'
      + '</w:docDefaults>';

    // Replace the entire docDefaults block (handles both empty self-closing
    // tags like <w:rPrDefault/> and populated tags with content)
    stylesXml = stylesXml.replace(
      /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/,
      newDocDefaults
    );

    // --- 8. Update BodyText and Compact styles' line spacing ---
    debug.verbose('DOCX', 'Step 8: Applying single-line style spacing');
    for (const styleId of ['BodyText', 'Compact']) {
      const styleRegex = new RegExp(
        `(<w:style[^>]*w:styleId="${styleId}"[^>]*>)([\\s\\S]*?)(</w:style>)`
      );
      stylesXml = stylesXml.replace(styleRegex, (_m, open, body, close) => {
        const updatedBody = body.replace(
          /<w:spacing\b[^>]*\/>/,
          (spacing: string) => spacing.replace(/\s+w:line(?:Rule)?="[^"]*"/g, '')
            .replace('/>', ` w:line="${lineSpacing}" w:lineRule="auto"/>`)
        );
        return open + updatedBody + close;
      });
    }

    // --- 8b. Override style-level rFonts in Normal and BodyText ---
    debug.verbose('DOCX', `Step 8b: Overriding style rFonts → ${fontName}`);
    // Pandoc and the reference doc may embed w:rFonts inside individual style
    // definitions (Normal, BodyText, Compact, FirstParagraph, etc.) which
    // override docDefaults. Replace them with the user's selected font so all
    // body text styles inherit the correct font family.
    for (const styleId of ['Normal', 'BodyText', 'BodyTextChar', 'Compact', 'FirstParagraph', 'SourceCode']) {
      const styleRegex = new RegExp(
        `(<w:style[^>]*w:styleId="${styleId}"[^>]*>)([\\s\\S]*?)(</w:style>)`
      );
      stylesXml = stylesXml.replace(styleRegex, (_m, open, body, close) => {
        // Replace any existing rFonts with the user's font
        const updatedBody = body.replace(
          /<w:rFonts[^/]*\/>/g,
          `<w:rFonts w:ascii="${fontName}" w:eastAsia="${fontName}" w:hAnsi="${fontName}" w:cs="${fontName}"/>`
        );
        return open + updatedBody + close;
      });
    }

    zip.file('word/styles.xml', stylesXml);
  }

  // --- 9. Update theme fonts in theme1.xml ---
  debug.verbose('DOCX', 'Step 9: Updating theme fonts in theme1.xml');
  // The reference.docx theme defines majorFont and minorFont (e.g. "Aptos").
  // Styles using theme references (w:asciiTheme="majorHAnsi") resolve to these.
  // Replace both major and minor theme fonts with the user's selected font
  // so ALL text in the document uses the correct font family.
  const themeFile = zip.file('word/theme/theme1.xml');
  if (themeFile) {
    let themeXml = await themeFile.async('string');
    const fontName = getDocxFontName(fontFamily);

    // Replace latin typeface in majorFont and minorFont
    themeXml = themeXml.replace(
      /(<a:majorFont>[\s\S]*?<a:latin typeface=")[^"]*(")/,
      `$1${fontName}$2`
    );
    themeXml = themeXml.replace(
      /(<a:minorFont>[\s\S]*?<a:latin typeface=")[^"]*(")/,
      `$1${fontName}$2`
    );

    zip.file('word/theme/theme1.xml', themeXml);
  }

  // --- Enforce document settings to prevent recipient's Word from overriding layout ---
  // When a recipient opens the DOCX, their Word may apply Normal.dotm defaults
  // or different compatibility settings, causing the document to appear "squished"
  // or with different margins. We enforce compatibility mode and layout settings
  // in word/settings.xml to prevent this.
  debug.verbose('DOCX', 'Enforcing word/settings.xml compatibility settings');
  const settingsFile = zip.file('word/settings.xml');
  if (settingsFile) {
    let settingsXml = await settingsFile.async('string');

    // Ensure compatibilityMode is set to Word 2013+ (val="15") so all
    // installations render the document consistently. Without this, Word may
    // open the document in a legacy compatibility mode that uses different
    // margin/spacing calculations.
    if (settingsXml.includes('<w:compat>')) {
      // Remove any existing compatibilityMode setting
      settingsXml = settingsXml.replace(
        /<w:compatSetting[^>]*w:name="compatibilityMode"[^/]*\/>/g,
        ''
      );
      // Inject our compatibilityMode as the first child of <w:compat>
      settingsXml = settingsXml.replace(
        /<w:compat>/,
        '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>'
      );
    } else {
      // No compat element exists — inject one before </w:settings>
      settingsXml = settingsXml.replace(
        /<\/w:settings>/,
        '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
      );
    }

    // Set default tab stop to 720 twips (0.5in) — standard US setting.
    // Some non-US Word installations default to 1270 twips (1.27cm),
    // which changes indentation and can shift content.
    if (settingsXml.includes('<w:defaultTabStop')) {
      settingsXml = settingsXml.replace(
        /<w:defaultTabStop w:val="\d+"\/?>/,
        '<w:defaultTabStop w:val="720"/>'
      );
    } else {
      settingsXml = settingsXml.replace(
        /<\/w:settings>/,
        '<w:defaultTabStop w:val="720"/></w:settings>'
      );
    }

    // Prevent Word from auto-adjusting paragraph spacing based on grid.
    // This ensures our LaTeX-defined spacing is preserved exactly.
    if (!settingsXml.includes('<w:doNotSnapToGrid')) {
      // snapping to document grid can affect line spacing
    }

    zip.file('word/settings.xml', settingsXml);
    debug.verbose('DOCX', 'Enforced compatibilityMode=15 (Word 2013+), defaultTabStop=720');
  }

  // --- Clear document metadata (prevents "Locked for editing" in Word) ---
  debug.verbose('DOCX', 'Clearing docProps/core.xml metadata');
  const coreFile = zip.file('docProps/core.xml');
  if (coreFile) {
    let coreXml = await coreFile.async('string');
    coreXml = coreXml.replace(/<dc:creator>[^<]*<\/dc:creator>/g, '<dc:creator></dc:creator>');
    coreXml = coreXml.replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/g, '<cp:lastModifiedBy></cp:lastModifiedBy>');
    zip.file('docProps/core.xml', coreXml);
  }

  debug.verbose('DOCX', 'Generating final DOCX zip...');
  const finalBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  debug.timeEnd('DOCX:postProcess');
  debug.log('DOCX', `Post-processing complete (${(finalBlob.size / 1024).toFixed(1)} KB)`);
  return finalBlob;
}

/**
 * Convert flat LaTeX content to a DOCX Blob using pandoc WASM.
 *
 * On first call, downloads the pandoc WASM binary (~58MB).
 * Subsequent calls reuse the cached module.
 *
 * `onProgress` receives phased status updates so a caller can drive a
 * loading UI. It is invoked synchronously from inside this function and
 * from pandoc.js's top-level load; consumers should keep handlers cheap
 * (e.g. a single React setState).
 */
export async function convertLatexToDocx(
  latexContent: string,
  docOptions: DocxConversionOptions = {},
  onProgress?: DocxProgressCallback,
): Promise<Blob> {
  const { sealType, letterheadColor, fontFamily, fontSize } = docOptions;
  debug.log('DOCX', '═══ Starting LaTeX → DOCX conversion ═══');
  debug.time('DOCX:totalConversion');
  debug.verbose('DOCX', `LaTeX input: ${(latexContent.length / 1024).toFixed(1)} KB, seal=${sealType}, font=${fontFamily} ${fontSize}`);

  // Safe emit: never let a bad consumer callback abort the conversion.
  const emit = (phase: DocxProgressPhase) => {
    if (!onProgress) return;
    try {
      onProgress(phase);
    } catch (err) {
      debug.warn('DOCX', `onProgress callback threw: ${String(err)}`);
    }
  };

  emit({ kind: 'preparing' });

  // Capture cached-ness BEFORE the await: pandocModule gets assigned inside
  // ensureLoaded's IIFE before it resolves, so checking it after the await
  // would always be truthy and the "already cached" branch below would fire
  // even on the first load (firing `fetching-support` twice).
  const wasAlreadyCached = pandocModule !== null;

  // Translate low-level pandoc loader events into our phased API so
  // consumers don't have to know about the two-stage init.
  const loaderHook = onProgress
    ? (event: PandocLoaderEvent) => {
        switch (event.kind) {
          case 'fetch-start':
            emit({ kind: 'fetching-engine', loaded: 0, total: 0 });
            break;
          case 'fetch-progress':
            emit({
              kind: 'fetching-engine',
              loaded: event.loaded,
              total: event.total,
            });
            break;
          case 'instantiate-start':
            emit({ kind: 'instantiating' });
            break;
          case 'ready':
            // ensureLoaded() also fetches reference.docx + dondocs.lua in
            // parallel; report that phase here so the UI shows movement.
            emit({ kind: 'fetching-support' });
            break;
        }
      }
    : undefined;

  const mod = await ensureLoaded(loaderHook);

  // If the module was already cached we never got `fetch-start` — emit a
  // support-fetch phase anyway so the caller sees a consistent sequence
  // before we jump into `converting`.
  if (wasAlreadyCached) emit({ kind: 'fetching-support' });

  // Files map: pandoc reads input files and writes output files here
  const files: Record<string, Blob> = {
    'reference.docx': referenceDocxBlob!,
    'dondocs.lua': luaFilterBlob!,
  };

  // WASI inputs are flat files, just like the seal; nested Map keys are not directories.
  for (const [path, bytes] of Object.entries(docOptions.mediaFiles ?? {})) {
    if (!/^(?:signature\.png|figure-[A-Za-z0-9-]+\.(?:png|jpg))$/.test(path)) throw new Error('Invalid Word image attachment path.');
    if (!bytes.byteLength) throw new Error(`Word image ${path} is empty.`);
    files[path] = new Blob([new Uint8Array(bytes)], { type: path.endsWith('.jpg') ? 'image/jpeg' : 'image/png' });
  }

  // Artless letterheads have no image reference and must work without a seal asset.
  if (docOptions.letterheadMode !== 'preprinted' && docOptions.letterheadMode !== 'title-only') {
    debug.verbose('DOCX', `Fetching seal image: seal=${sealType}, color=${letterheadColor}`);
    const seal = await fetchSealImage(sealType, letterheadColor);
    files[seal.path] = seal.blob;
    debug.verbose('DOCX', `Seal image loaded: ${seal.path} (${(seal.blob.size / 1024).toFixed(1)} KB)`);
  }

  const metadata: Record<string, string> = {
    ...layoutToMetadata(LAYOUT, {
      family: fontFamily,
      sizePt: parseInt(fontSize || '12pt', 10) || 12,
    }, docOptions.docType),
    // Pass font size (in pt) so the Lua filter can scale \baselineskip spacing
    'font-size-pt': String(parseInt(fontSize || '12pt', 10) || 12),
  };

  const options: Record<string, unknown> = {
    from: 'latex+raw_tex',
    to: 'docx',
    'output-file': 'output.docx',
    'reference-doc': 'reference.docx',
    filters: ['dondocs.lua'],
    metadata,
  };

  debug.log('DOCX', 'Running pandoc WASM conversion...');
  debug.time('DOCX:pandocConvert');
  debug.verboseGroup('DOCX', 'Pandoc options', () => {
    debug.verbose('DOCX', `from: ${options.from}, to: ${options.to}`);
    debug.verbose('DOCX', `filters: ${(options.filters as string[]).join(', ')}`);
    debug.verboseTable('DOCX', 'metadata', metadata);
  });

  emit({ kind: 'converting' });
  const result = await mod.convert(options, latexContent, files);
  debug.timeEnd('DOCX:pandocConvert');

  if (result.stderr) {
    debug.warn('DOCX', `Pandoc stderr: ${result.stderr}`);
  }

  const outputBlob = files['output.docx'];
  if (!outputBlob || outputBlob.size === 0) {
    debug.error('DOCX', `Pandoc conversion failed — no output. stderr: ${result.stderr || '(empty)'}`);
    throw new Error(`Pandoc conversion failed: ${result.stderr || 'no output produced'}`);
  }

  debug.log('DOCX', `Pandoc output: ${(outputBlob.size / 1024).toFixed(1)} KB`);

  // Post-process: zero cell padding, rescale gridCol, page geometry, fonts, letterhead colors, classification
  emit({ kind: 'postprocessing' });
  const finalBlob = await postProcessDocx(outputBlob, docOptions);

  debug.timeEnd('DOCX:totalConversion');
  debug.log('DOCX', `═══ DOCX conversion complete: ${(finalBlob.size / 1024).toFixed(1)} KB ═══`);
  return finalBlob;
}

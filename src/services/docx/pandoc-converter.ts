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
import { LAYOUT, layoutToMetadata } from './layout-config';
import { debug } from '@/lib/debug';

const BASE_PATH = import.meta.env.BASE_URL || '/';

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

// Cached support files
let referenceDocxBlob: Blob | null = null;
let luaFilterBlob: Blob | null = null;

async function loadPandocModule(): Promise<PandocModule> {
  // pandoc.js is an ES module with top-level await; it loads the WASI shim
  // and the pandoc WASM parts same-origin from /lib/pandoc/ (vendored at
  // build time — air-gap safe, no CDN). It lives in public/ and must NOT go
  // through Vite's transform pipeline.
  // We construct a full absolute URL so the browser loads it directly.
  const moduleUrl = new URL(`${BASE_PATH}lib/pandoc/pandoc.js`, window.location.origin).href;
  debug.log('DOCX', `Loading pandoc WASM module from ${moduleUrl}`);
  debug.time('DOCX:loadPandocModule');
  const mod = await import(/* @vite-ignore */ moduleUrl);
  debug.timeEnd('DOCX:loadPandocModule');
  return mod as PandocModule;
}

async function fetchSupportFile(filename: string): Promise<Blob> {
  const url = `${BASE_PATH}lib/pandoc/${filename}`;
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

// Decode the five predefined XML entities. Order matters: "&amp;" is decoded
// LAST so an input like "&amp;lt;" resolves to the literal "&lt;" rather than
// being double-unescaped into "<".
function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
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

/** Map font family identifier to DOCX font name */
function getDocxFontName(fontFamily: string): string {
  switch (fontFamily) {
    case 'courier': return 'Courier New';
    case 'times':
    default: return 'Times New Roman';
  }
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
 * Ensure the letterhead table is perfectly centered on the page.
 *
 * Fixes two issues:
 * 1. Horizontal centering — forces the 3-column gridCol widths to be
 *    exactly symmetric (sealCol === spacerCol) with total === textWidth.
 *    Rounding from pandoc + rescaling can introduce a few-twip asymmetry.
 * 2. Vertical centering — adds w:vAlign="center" to the center text cell
 *    so the org text block is vertically centered relative to the seal image.
 *
 * Detection: first 3-col table in the document that contains a drawing.
 */
interface LetterheadResult {
  xml: string;
  hasLetterheadSeal: boolean;  // true if a letterhead table with seal image was found
}

function perfectLetterheadCentering(xml: string, textWidthTwips: number): LetterheadResult {
  // Find the first table in the document
  const firstTblMatch = xml.match(/<w:tbl>([\s\S]*?)<\/w:tbl>/);
  if (!firstTblMatch) return { xml, hasLetterheadSeal: false };

  let tblContent = firstTblMatch[1];

  // Verify this is the letterhead table (has a drawing/image)
  if (!tblContent.includes('<w:drawing>') && !tblContent.includes('<wp:inline>')) {
    return { xml, hasLetterheadSeal: false };
  }

  // Check it's a 3-column table
  const gridColMatches = tblContent.match(/<w:gridCol w:w="\d+"\/>/g);
  if (!gridColMatches || gridColMatches.length !== 3) return { xml, hasLetterheadSeal: false };

  // --- Margin extension: per SECNAV App C ¶1b, the seal is 0.5in from the page edge ---
  // The letterhead table must extend 0.5in (720 twips) into each margin so the
  // seal column starts at the 0.5in page position, not the 1in text margin.
  // We achieve this by: (a) negative tblInd of -720 twips, (b) wider gridCols.
  const MARGIN_EXT = 720; // 0.5in in twips

  // --- Horizontal centering: exact symmetric gridCol widths ---
  // Base widths from the text-width proportions, then extend seal+spacer into margins
  const baseSealTwips = Math.round(LAYOUT.letterhead.sealCol * textWidthTwips);
  const baseSpacerTwips = baseSealTwips; // Force exact symmetry
  const centerTwips = textWidthTwips - baseSealTwips - baseSpacerTwips;
  const sealTwips = baseSealTwips + MARGIN_EXT;   // extend left into margin
  const spacerTwips = baseSpacerTwips + MARGIN_EXT; // extend right into margin

  const oldGrid = tblContent.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/);
  if (oldGrid) {
    const newGrid = '<w:tblGrid>'
      + `<w:gridCol w:w="${sealTwips}"/>`
      + `<w:gridCol w:w="${centerTwips}"/>`
      + `<w:gridCol w:w="${spacerTwips}"/>`
      + '</w:tblGrid>';
    tblContent = tblContent.replace(oldGrid[0], newGrid);
    debug.verbose('DOCX', `Letterhead gridCol: seal=${sealTwips}, center=${centerTwips}, spacer=${spacerTwips} (total=${sealTwips + centerTwips + spacerTwips})`);
  }

  // --- Negative table indent: shift table 0.5in left into margin ---
  // Replace existing tblInd or add one. This positions the table's left edge
  // at the 0.5in mark from the page edge (inside the margin area).
  if (tblContent.includes('<w:tblInd')) {
    tblContent = tblContent.replace(
      /<w:tblInd[^>]*\/>/,
      `<w:tblInd w:type="dxa" w:w="-${MARGIN_EXT}"/>`
    );
  } else {
    // Insert tblInd after tblW if present, otherwise after tblStyle
    tblContent = tblContent.replace(
      /(<w:tblW[^>]*\/>)/,
      `$1<w:tblInd w:type="dxa" w:w="-${MARGIN_EXT}"/>`
    );
  }

  // --- Table width: change from percentage to fixed width in twips ---
  // The table is now wider than \textwidth, so percentage-based width (5000 = 100%)
  // would only cover the text area. Use fixed width (dxa) for the full table.
  const totalTwips = sealTwips + centerTwips + spacerTwips;
  tblContent = tblContent.replace(
    /<w:tblW[^>]*\/>/,
    `<w:tblW w:type="dxa" w:w="${totalTwips}"/>`
  );

  // --- Vertical centering: vAlign on center cell ---
  // The letterhead row has 3 cells: seal | org text | spacer.
  // Add w:vAlign="center" to the center (2nd) cell's tcPr so the
  // text block is vertically centered relative to the seal image.
  // tcPr can be self-closing (<w:tcPr />) or have content (<w:tcPr>...</w:tcPr>).
  let cellIndex = 0;
  tblContent = tblContent.replace(
    /<w:tc><w:tcPr\s*\/>/g,
    (match) => {
      cellIndex++;
      if (cellIndex === 2) {
        return '<w:tc><w:tcPr><w:vAlign w:val="center"/></w:tcPr>';
      }
      return match;
    }
  );

  // Apply table content changes
  xml = xml.replace(firstTblMatch[1], tblContent);

  // Note: No vertical spacer paragraph is needed after the letterhead table.
  // The page top margin is reduced to 720 twips (0.5in) so the seal starts at
  // 0.5in from the top edge per SECNAV App C ¶1b. The letterhead table itself
  // is ~1.09in tall (driven by the seal image), which already places the content
  // past the 1.0in mark. The flat-generator emits \vspace{1\baselineskip} after
  // the letterhead, which pandoc converts to a spacing paragraph (~240 twips),
  // providing exactly 1 line of space before the SSIC block.

  return { xml, hasLetterheadSeal: true };
}

/**
 * Everything the DOCX writer needs from the document beyond its LaTeX.
 *
 * An object rather than positional arguments: these are all `formData` fields
 * read at one call site, and the last two arrived only because the Word export
 * had been silently ignoring two settings the PDF honours. Six loose strings
 * was already at the edge of readable; eight would not be.
 */
export interface DocxConversionOptions {
  sealType?: string;
  letterheadColor?: string;
  fontFamily?: string;
  fontSize?: string;
  classLevel?: string;
  customClassification?: string;
  /** Repeat "Subj:" at the top of pages 2+ — SECNAV M-5216.5 ¶7-16. */
  showSubjectOnContinuation?: boolean;
  /** 'none' | 'simple' | 'x-of-y'; anything but 'none' numbers pages 2+ (¶7-17). */
  pageNumbering?: string;
  /**
   * First page's number. Above 1 means this document continues an earlier one's
   * sequence — an endorsement — and Ch 9 Fig 9-2 numbers its opening sheet.
   */
  startingPageNumber?: number;
}

/** Resolve classLevel to the classification marking text (e.g. "SECRET", "CUI"). */
function getClassificationMarking(classLevel?: string, customClassification?: string): string {
  if (!classLevel || classLevel === 'unclassified') return '';
  if (classLevel === 'cui') return 'CUI';
  if (classLevel === 'custom' && customClassification) return customClassification;
  const map: Record<string, string> = {
    confidential: 'CONFIDENTIAL',
    secret: 'SECRET',
    top_secret: 'TOP SECRET',
    top_secret_sci: 'TOP SECRET//SCI',
  };
  return map[classLevel] || '';
}

/** Escape text destined for an XML text node. */
function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A centered bold paragraph — the classification marking's shape. */
function markingParagraph(marking: string): string {
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    + `<w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXmlText(marking)}</w:t></w:r></w:p>`;
}

/**
 * The repeated subject line at the left margin, per SECNAV M-5216.5 ¶7-16.
 *
 * Takes the whole line rather than just the text because the label is not
 * constant: the PDF templates head letters with `Subj:~~` and memoranda and
 * business letters with `SUBJECT:~~`. Hardcoding either one here would make the
 * Word export disagree with the PDF built from the same document. The two
 * spaces match those templates' `~~`.
 */
function continuationSubjectParagraph(line: string, spaceBefore: number): string {
  const spacing = spaceBefore > 0 ? `<w:spacing w:before="${spaceBefore}"/>` : '';
  return `<w:p><w:pPr>${spacing}<w:jc w:val="left"/></w:pPr>`
    + `<w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r></w:p>`;
}

/** Where the header text starts, and where the body does — both from pgMar. */
const HEADER_TOP_TWIPS = 720;
const BODY_TOP_TWIPS = 1440;

/**
 * The height of one single-spaced line, in twips.
 *
 * NOT 240. `w:line="240" w:lineRule="auto"` in the styles is Word's
 * single-spacing *base unit*, not a measurement — the rendered line is driven
 * by the font's ascent, descent and line gap. Times New Roman runs about
 * 1.15 em, so 12pt sets a ~276 twip line. Treating 240 as the line height is
 * what left the subject sitting three-quarters of a line off the body.
 */
function lineTwips(fontSizePt: number): number {
  return Math.round(fontSizePt * 20 * 1.15);
}

/**
 * How far to push the subject down inside the header so the body lands on the
 * second line below it — one clear line between them, per ¶7-16.
 *
 * The body is fixed at `w:top`, so the only lever is where the subject sits:
 * it has to END one line short of the body. With a classification marking
 * above it the subject is already on the header's second line and needs no
 * lead-in; without one it does.
 *
 * The PDF measures this same relationship — subject at 0.661in, body at
 * 1.053in, a 28.2pt gap on a 14.4pt line — so this keeps Word agreeing with
 * it rather than each export drifting to its own spacing.
 */
function subjectSpaceBefore(hasMarking: boolean, fontSizePt: number): number {
  const line = lineTwips(fontSizePt);
  const linesAbove = hasMarking ? 2 : 1; // marking occupies one, subject the next
  // Clamped, not negative: a marking plus the subject plus a clear line wants
  // three line-heights and the header opens only 720 twips above the body, so
  // a classified letter at 11 or 12pt runs short. It degrades to "as much room
  // as there is" rather than overlapping the text.
  return Math.max(0, BODY_TOP_TWIPS - HEADER_TOP_TWIPS - line * (linesAbove + 1));
}

/**
 * A centered PAGE field — ¶7-17: "Center page numbers 1/2 inch from the bottom
 * edge, starting with the number 2." The 1/2 inch is the sectPr's w:footer
 * distance (720 twips), which page geometry already sets; "starting with 2"
 * falls out of this living in the *default* footer while page 1 uses the
 * `first` one.
 */
function pageNumberParagraph(): string {
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    + '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
}

/** An empty paragraph — Word needs a header/footer part to contain at least one. */
const EMPTY_PARAGRAPH = '<w:p/>';

interface HeaderFooterParts {
  /** Page 1. */
  firstHeader: string[];
  firstFooter: string[];
  /** Page 2 onward. */
  defaultHeader: string[];
  defaultFooter: string[];
}

/**
 * Decide what goes on page 1 versus the continuation pages.
 *
 * Page 1 and later pages differ, so the document needs `w:titlePg` and two sets
 * of parts. The classification marking must appear on BOTH — turning on
 * titlePg without giving page 1 its own marked header would silently strip the
 * marking from the first page of every classified letter.
 */
function planHeadersAndFooters(
  marking: string,
  continuationSubject: string,
  wantsPageNumbers: boolean,
  numberFirstPage: boolean,
  fontSizePt: number,
): HeaderFooterParts {
  const marked = marking ? [markingParagraph(marking)] : [];
  const number = wantsPageNumbers ? [pageNumberParagraph()] : [];
  return {
    firstHeader: [...marked],
    // ¶7-17 leaves a letter's first page unnumbered, but an endorsement's
    // opening sheet continues someone else's sequence and Fig 9-2 numbers it.
    // Same split the PDF templates make between their `firstpage` styles.
    firstFooter: [...marked, ...(numberFirstPage ? number : [])],
    defaultHeader: [
      ...marked,
      ...(continuationSubject
        ? [continuationSubjectParagraph(continuationSubject, subjectSpaceBefore(!!marking, fontSizePt))]
        : []),
    ],
    // Marking first, then the number below it — mirrors the PDF, where the
    // marking is \fancyfoot[C] on its own line above \thepage.
    defaultFooter: [...marked, ...number],
  };
}

/**
 * Rebuild a <w:sectPr> with header/footer references and w:titlePg in their
 * schema-required positions.
 *
 * CT_SectPr is a *sequence*, not a bag: the header/footer references come
 * first, and w:titlePg belongs after w:cols and before w:docGrid. Appending
 * everything before `</w:sectPr>` (as the classification-only code used to)
 * happens to survive Word's leniency, but titlePg out of order is the kind of
 * thing that makes Word repair the file on open — so build it properly.
 */
function rebuildSectPr(
  sectPr: string,
  refs: string,
  titlePg: boolean,
  startPage: number,
): string {
  // Strip the wrapper, then re-emit: refs, existing children, titlePg.
  const open = sectPr.match(/^<w:sectPr[^>]*>/)?.[0] ?? '<w:sectPr>';
  const inner = sectPr.slice(open.length, sectPr.lastIndexOf('</w:sectPr>'));

  // w:titlePg sits after w:cols/w:vAlign and before w:docGrid. Nothing here
  // emits docGrid today, so appending it last is in-order; if pandoc ever does,
  // splice ahead of it rather than after.
  const docGrid = inner.match(/<w:docGrid[^>]*\/?>/)?.[0];
  // The Word equivalent of \setcounter{page}{N} — pandoc drops that too, so an
  // endorsement continuing at page 3 would otherwise restart Word at 1.
  const pgNumType = startPage > 1 ? `<w:pgNumType w:start="${startPage}"/>` : '';
  const titleTag = titlePg ? '<w:titlePg/>' : '';
  const tail = `${pgNumType}${titleTag}`;
  const body = docGrid
    ? inner.replace(docGrid, `${tail}${docGrid}`)
    : `${inner}${tail}`;

  return `${open}${refs}${body}</w:sectPr>`;
}

/**
 * Inject the page header and footer parts into the DOCX zip and wire them into
 * content types, relationships and sectPr.
 *
 * Everything here is invisible to pandoc: `\fancyhead` and `\fancyfoot` are not
 * constructs its LaTeX reader understands, so the flat generator's page
 * furniture is dropped on the floor. Before this existed the Word export
 * carried no page numbers at all and no repeated subject line, while the PDF
 * built from the same document had both.
 */
export interface PageFurniture {
  /** Classification marking, or '' for unclassified. Appears on every page. */
  marking: string;
  /**
   * The subject line as it should appear on pages 2+, label included
   * ("Subj:  X" or "SUBJECT:  X"), or '' to omit. Whole line rather than just
   * the text because the label varies by document type.
   */
  continuationSubject: string;
  /** Number pages 2+. */
  wantsPageNumbers: boolean;
  /** First page's number; above 1 also numbers page 1 (Ch 9 Fig 9-2). */
  startPage: number;
  /** Body font size in points — sets the line height the subject spaces against. */
  fontSizePt: number;
}

/**
 * Apply the page header/footer furniture to a pandoc-produced DOCX.
 *
 * Exported for `tests/integration/docx-page-furniture.test.ts`: the DOCX test
 * harness deliberately stops at pandoc and does not run the post-pass, so
 * without this seam the OOXML written here — parts, content types,
 * relationships, sectPr ordering — would ship with no test able to see it.
 * Production reaches it through `postProcessDocx`; the test drives the same
 * function with the same inputs.
 */
export async function applyPageFurniture(
  zip: JSZip,
  xml: string,
  furniture: PageFurniture,
): Promise<string> {
  return injectHeadersAndFooters(
    zip,
    xml,
    planHeadersAndFooters(
      furniture.marking,
      furniture.continuationSubject,
      furniture.wantsPageNumbers,
      furniture.startPage > 1,
      furniture.fontSizePt,
    ),
    furniture.startPage,
  );
}

async function injectHeadersAndFooters(
  zip: JSZip,
  xml: string,
  parts: HeaderFooterParts,
  startPage: number,
): Promise<string> {
  const wrap = (tag: 'hdr' | 'ftr', paragraphs: string[]) =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<w:${tag} ${W_NS}>`
    + (paragraphs.length ? paragraphs.join('') : EMPTY_PARAGRAPH)
    + `</w:${tag}>`;

  // Word resolves an *absent* reference by inheriting the previous section's,
  // so an empty page-1 header must be an explicit empty part rather than a
  // missing one — otherwise page 1 falls back to the default and shows the
  // continuation subject it is not supposed to have.
  const files: Array<{ name: string; tag: 'hdr' | 'ftr'; refTag: string; type: string; rel: string; body: string[] }> = [
    { name: 'header1.xml', tag: 'hdr', refTag: 'headerReference', type: 'first', rel: 'rIdHdrFirst', body: parts.firstHeader },
    { name: 'header2.xml', tag: 'hdr', refTag: 'headerReference', type: 'default', rel: 'rIdHdrDefault', body: parts.defaultHeader },
    { name: 'footer1.xml', tag: 'ftr', refTag: 'footerReference', type: 'first', rel: 'rIdFtrFirst', body: parts.firstFooter },
    { name: 'footer2.xml', tag: 'ftr', refTag: 'footerReference', type: 'default', rel: 'rIdFtrDefault', body: parts.defaultFooter },
  ];

  for (const f of files) {
    zip.file(`word/${f.name}`, wrap(f.tag, f.body));
  }

  // --- Update [Content_Types].xml ---
  const contentTypesFile = zip.file('[Content_Types].xml');
  if (contentTypesFile) {
    let ct = await contentTypesFile.async('string');
    const overrides = files
      .map(f => `<Override PartName="/word/${f.name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${f.tag === 'hdr' ? 'header' : 'footer'}+xml"/>`)
      .join('');
    ct = ct.replace('</Types>', `${overrides}</Types>`);
    zip.file('[Content_Types].xml', ct);
  }

  // --- Update word/_rels/document.xml.rels ---
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    let rels = await relsFile.async('string');
    const relEntries = files
      .map(f => `<Relationship Id="${f.rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${f.tag === 'hdr' ? 'header' : 'footer'}" Target="${f.name}"/>`)
      .join('');
    rels = rels.replace('</Relationships>', `${relEntries}</Relationships>`);
    zip.file('word/_rels/document.xml.rels', rels);
  }

  // --- Wire references and titlePg into sectPr ---
  const refs = files.map(f => `<w:${f.refTag} w:type="${f.type}" r:id="${f.rel}"/>`).join('');
  return xml.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/, (sectPr) => rebuildSectPr(sectPr, refs, true, startPage));
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
  const textOf = (fragment: string) =>
    (fragment.match(/<w:t[^>]*>([^<]*)</g) || [])
      .map(m => m.replace(/^<w:t[^>]*>/, '').replace(/<$/, ''))
      .join('')
      .trim();

  for (const row of xml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || []) {
    const [label, value] = row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
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

/**
 * Apply font color and sizes to the letterhead table (table 0) in the DOCX.
 *
 * Per SECNAV M-5216.5 App C §2a:
 *   Department line: 10pt bold, colored (PMS 288 navy blue or black)
 *   Activity/unit name: 8pt, colored (NOT bold — App C §1d(2))
 *   Other lines (division, address): 8pt, colored
 *
 * Detection: The first <w:tbl> in the document is the letterhead.
 * Bold runs (<w:b/>) get 10pt (20 half-points); non-bold get 8pt (16 half-points).
 * All runs in the letterhead table get the letterhead color.
 */
function applyLetterheadStyling(xml: string, colorHex: string): string {
  // Find the first <w:tbl> in the document using index-based search
  // to correctly handle nested tables (the lazy regex approach can
  // stop at an inner </w:tbl> instead of the outer one).
  const tblOpenTag = '<w:tbl>';
  const tblCloseTag = '</w:tbl>';
  const firstTblStart = xml.indexOf(tblOpenTag);
  if (firstTblStart === -1) return xml;

  // Find the matching </w:tbl> by counting nesting depth
  let depth = 0;
  let searchFrom = firstTblStart;
  let tblEnd = -1;
  while (searchFrom < xml.length) {
    const nextOpen = xml.indexOf(tblOpenTag, searchFrom + (depth === 0 ? tblOpenTag.length : 1));
    const nextClose = xml.indexOf(tblCloseTag, searchFrom + 1);
    if (nextClose === -1) break;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      // Found a nested <w:tbl> before the next </w:tbl>
      depth++;
      searchFrom = nextOpen;
    } else {
      // Found a </w:tbl>
      if (depth === 0) {
        tblEnd = nextClose + tblCloseTag.length;
        break;
      }
      depth--;
      searchFrom = nextClose;
    }
  }
  if (tblEnd === -1) return xml;

  let tblInner = xml.substring(firstTblStart + tblOpenTag.length, tblEnd - tblCloseTag.length);

  // Apply to tables that are a letterhead: either standard (has an image/drawing)
  // or joint (text-only but contains "DEPARTMENT" in the text content).
  const hasDrawing = tblInner.includes('<w:drawing>') || tblInner.includes('<wp:inline>');
  const hasDeptText = tblInner.includes('DEPARTMENT');
  if (!hasDrawing && !hasDeptText) {
    return xml;
  }

  // Joint letterheads (no seal image, text-only) are always black — per SECNAV M-5216.5
  // Ch 7 Fig 7-4, joint letters use plain bond with typed command titles. The joint letter
  // UI has no color picker, so the stored letterheadColor is a stale value from a previous
  // doc type. Override to black for joint letterheads.
  const isJointLetterhead = !hasDrawing && hasDeptText;
  if (isJointLetterhead) {
    colorHex = '000000';
  }

  // Process each run in the letterhead table:
  // - Add color to all runs that have text
  // - Add font size based on bold status: bold=10pt(20hp), non-bold=8pt(16hp)
  debug.verbose('DOCX', `Letterhead detected: ${isJointLetterhead ? 'joint (text-only)' : 'standard (with seal)'}, color=#${colorHex}`);
  let runsStyled = 0;
  tblInner = tblInner.replace(
    /<w:r>([\s\S]*?)<\/w:r>/g,
    (_match, runContent: string) => {
      // Skip runs that don't contain text (e.g., drawing/image runs, line breaks)
      if (!runContent.includes('<w:t')) return `<w:r>${runContent}</w:r>`;

      const isBold = runContent.includes('<w:b') && !runContent.includes('<w:b w:val="0"');
      const sizeHp = isBold ? 20 : 16; // 10pt = 20hp, 8pt = 16hp

      // Build the run properties we need to inject
      const colorProp = `<w:color w:val="${colorHex}"/>`;
      const sizeProp = `<w:sz w:val="${sizeHp}"/><w:szCs w:val="${sizeHp}"/>`;

      if (runContent.includes('<w:rPr>')) {
        // Run already has properties — inject color and size into existing rPr
        runContent = runContent.replace(
          /<w:rPr>([\s\S]*?)<\/w:rPr>/,
          `<w:rPr>$1${colorProp}${sizeProp}</w:rPr>`
        );
      } else {
        // No existing rPr — create one before the text
        runContent = runContent.replace(
          /(<w:t)/,
          `<w:rPr>${colorProp}${sizeProp}</w:rPr>$1`
        );
      }

      runsStyled++;
      return `<w:r>${runContent}</w:r>`;
    }
  );

  debug.verbose('DOCX', `Letterhead styling: ${runsStyled} text runs styled`);

  // Reconstruct the table and replace in the document using exact position
  const styledTable = tblOpenTag + tblInner + tblCloseTag;
  return xml.substring(0, firstTblStart) + styledTable + xml.substring(tblEnd);
}

async function postProcessDocx(
  docxBlob: Blob,
  {
    fontFamily = 'times',
    fontSize = '12pt',
    letterheadColor,
    classLevel,
    customClassification,
    showSubjectOnContinuation,
    pageNumbering,
    startingPageNumber,
  }: DocxConversionOptions = {},
): Promise<Blob> {
  debug.log('DOCX', `Post-processing DOCX (${(docxBlob.size / 1024).toFixed(1)} KB)`);
  debug.time('DOCX:postProcess');
  debug.verbose('DOCX', `Options: font=${fontFamily}, size=${fontSize}, color=${letterheadColor}, class=${classLevel}`);

  const zip = await JSZip.loadAsync(docxBlob);
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
  const TARGET_TEXT_WIDTH = 9360; // 6.5in × 1440 twips/in
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
  const letterheadResult = perfectLetterheadCentering(xml, TARGET_TEXT_WIDTH);
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
        if (/<w:t[ >]/.test(inner)) return _match;
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
  const topMargin = hasLetterheadSeal ? 720 : 1440;
  debug.log('DOCX', `Step 5: Enforcing US Letter page geometry (${topMargin / 1440}in top, 1in sides)${hasLetterheadSeal ? ' — seal detected, 0.5in top' : ''}`);
  const PG_SZ = '<w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>';
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
  xml = applyLetterheadStyling(xml, colorHex);

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

  // --- 6a. Convert leading non-breaking spaces to paragraph indentation ---
  debug.verbose('DOCX', 'Step 6a: Converting nbsp to paragraph indentation');
  // The Lua filter converts \hspace{Xin} to a single Str of non-breaking spaces
  // (U+00A0), but DOCX renders nbsp inconsistently. Replace leading nbsp sequences
  // with proper w:ind w:left for accurate paragraph indentation.
  // Strategy: find every <w:t> that starts with nbsp, walk back to find its
  // containing <w:p>, and inject w:ind w:left into the paragraph's pPr.
  {
    const nbspTRegex = /<w:t(?:\s[^>]*)?>(\u00A0+)/g;
    let nbspMatch: RegExpExecArray | null;
    // Collect matches in reverse order to preserve indices during replacement
    const nbspMatches: { tStart: number; nbspLen: number; fullMatchLen: number }[] = [];
    while ((nbspMatch = nbspTRegex.exec(xml)) !== null) {
      nbspMatches.push({
        tStart: nbspMatch.index,
        nbspLen: nbspMatch[1].length,
        fullMatchLen: nbspMatch[0].length,
      });
    }

    debug.verbose('DOCX', `Found ${nbspMatches.length} nbsp indentation(s) to convert`);
    for (let i = nbspMatches.length - 1; i >= 0; i--) {
      const m = nbspMatches[i];
      const nbspCount = m.nbspLen;
      const twips = Math.round((nbspCount / 6) * 1440);

      // Find the containing <w:p> by searching backwards from the <w:t> position
      const beforeT = xml.substring(0, m.tStart);
      const pStart = beforeT.lastIndexOf('<w:p>');
      const pPrStart = beforeT.lastIndexOf('<w:p><w:pPr>');
      if (pStart === -1) continue;

      // Remove the leading nbsp characters from the <w:t> content
      const nbspEnd = m.tStart + m.fullMatchLen;
      xml = xml.substring(0, nbspEnd - nbspCount) + xml.substring(nbspEnd);

      // Inject w:ind into the paragraph's pPr
      const indEl = `<w:ind w:left="${twips}"/>`;
      if (pPrStart === pStart) {
        // Has <w:pPr> — inject after <w:pPr>
        const pPrTagEnd = pStart + '<w:p><w:pPr>'.length;
        xml = xml.substring(0, pPrTagEnd) + indEl + xml.substring(pPrTagEnd);
      } else {
        // No <w:pPr> — inject one after <w:p>
        const pTagEnd = pStart + '<w:p>'.length;
        xml = xml.substring(0, pTagEnd) + `<w:pPr>${indEl}</w:pPr>` + xml.substring(pTagEnd);
      }
    }
  }

  // --- 6a2. Convert leading em-spaces to first-line indent ---
  // Same as 6a but for em-space (U+2003) markers from \dondocsfirstindent.
  // These become w:ind w:firstLine (first line only) instead of w:left (all lines).
  {
    const emTRegex = /<w:t(?:\s[^>]*)?>(\u2003+)/g;
    let emMatch: RegExpExecArray | null;
    const emMatches: { tStart: number; emLen: number; fullMatchLen: number }[] = [];
    while ((emMatch = emTRegex.exec(xml)) !== null) {
      emMatches.push({
        tStart: emMatch.index,
        emLen: emMatch[1].length,
        fullMatchLen: emMatch[0].length,
      });
    }

    debug.verbose('DOCX', `Found ${emMatches.length} first-line indentation(s) to convert`);
    for (let i = emMatches.length - 1; i >= 0; i--) {
      const m = emMatches[i];
      const emCount = m.emLen;
      const twips = Math.round((emCount / 6) * 1440);

      const beforeT = xml.substring(0, m.tStart);
      const pStart = beforeT.lastIndexOf('<w:p>');
      const pPrStart = beforeT.lastIndexOf('<w:p><w:pPr>');
      if (pStart === -1) continue;

      // Remove the leading em-space characters from the <w:t> content
      const emEnd = m.tStart + m.fullMatchLen;
      xml = xml.substring(0, emEnd - emCount) + xml.substring(emEnd);

      // Inject w:ind w:firstLine into the paragraph's pPr
      const indEl = `<w:ind w:firstLine="${twips}"/>`;
      if (pPrStart === pStart) {
        const pPrTagEnd = pStart + '<w:p><w:pPr>'.length;
        xml = xml.substring(0, pPrTagEnd) + indEl + xml.substring(pPrTagEnd);
      } else {
        const pTagEnd = pStart + '<w:p>'.length;
        xml = xml.substring(0, pTagEnd) + `<w:pPr>${indEl}</w:pPr>` + xml.substring(pTagEnd);
      }
    }
  }

  // --- 6b. Page header and footer ---
  // Three separate things share one mechanism: the classification marking (every
  // page), the repeated subject line (¶7-16, pages 2+) and the page number
  // (¶7-17, pages 2+). Skipped entirely when the document wants none of them,
  // so an unclassified single-page letter keeps the parts-free zip it had.
  const classMarking = getClassificationMarking(classLevel, customClassification);
  const continuationSubject = showSubjectOnContinuation ? extractSubjectFromDocument(xml) : '';
  const wantsPageNumbers = !!pageNumbering && pageNumbering !== 'none';
  debug.verbose(
    'DOCX',
    `Step 6b: marking="${classMarking || 'none'}" continuationSubj="${continuationSubject || 'none'}" pageNumbers=${wantsPageNumbers}`,
  );
  if (classMarking || continuationSubject || wantsPageNumbers) {
    xml = await applyPageFurniture(zip, xml, {
      marking: classMarking,
      continuationSubject,
      wantsPageNumbers,
      startPage: Math.max(1, Math.trunc(startingPageNumber || 1)),
      fontSizePt: parseInt(fontSize, 10) || 12,
    });
  }

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
    const lineSpacing = sizeHp * 10; // half-points × 10 = twips (24 × 10 = 240)

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
    debug.verbose('DOCX', `Step 8: Updating style line spacing (${lineSpacing} twips)`);
    // These styles have hardcoded w:line="240" (12pt single spacing) which
    // overrides docDefaults. When the user selects 10pt or 11pt, we need to
    // update these to match, otherwise line spacing stays at 12pt regardless.
    // We extract each style block first, then replace w:line within it.
    for (const styleId of ['BodyText', 'Compact']) {
      const styleRegex = new RegExp(
        `(<w:style[^>]*w:styleId="${styleId}"[^>]*>)([\\s\\S]*?)(</w:style>)`
      );
      stylesXml = stylesXml.replace(styleRegex, (_m, open, body, close) => {
        const updatedBody = body.replace(
          /w:line="\d+"/,
          `w:line="${lineSpacing}"`
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

  // Add seal image so pandoc can resolve \includegraphics{attachments/...}
  debug.verbose('DOCX', `Fetching seal image: seal=${sealType}, color=${letterheadColor}`);
  const seal = await fetchSealImage(sealType, letterheadColor);
  files[seal.path] = seal.blob;
  debug.verbose('DOCX', `Seal image loaded: ${seal.path} (${(seal.blob.size / 1024).toFixed(1)} KB)`);

  const metadata: Record<string, string> = {
    ...layoutToMetadata(LAYOUT),
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

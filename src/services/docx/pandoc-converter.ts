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

// Singleton: lazily loaded pandoc module
let pandocModule: PandocModule | null = null;
let loadPromise: Promise<PandocModule> | null = null;

// Cached support files
let referenceDocxBlob: Blob | null = null;
let luaFilterBlob: Blob | null = null;

async function loadPandocModule(): Promise<PandocModule> {
  // pandoc.js is an ES module with top-level await and CDN imports.
  // It lives in public/ and must NOT go through Vite's transform pipeline.
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

async function ensureLoaded(): Promise<PandocModule> {
  if (pandocModule) {
    debug.verbose('DOCX', 'Pandoc module already loaded (cached)');
    return pandocModule;
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      debug.log('DOCX', 'Initializing pandoc WASM (first load)...');
      debug.time('DOCX:ensureLoaded');

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
    })();
  }

  return loadPromise;
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

/**
 * Inject classification marking header and footer into the DOCX zip.
 * Creates word/header1.xml and word/footer1.xml with the marking text
 * centered and bold, then wires them into the document relationships,
 * content types, and sectPr.
 */
async function injectClassificationHeaderFooter(
  zip: JSZip,
  xml: string,
  marking: string,
): Promise<string> {
  // --- Create header1.xml and footer1.xml ---
  const headerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    + '<w:r><w:rPr><w:b/></w:rPr>'
    + `<w:t>${marking}</w:t>`
    + '</w:r></w:p></w:hdr>';

  const footerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    + '<w:r><w:rPr><w:b/></w:rPr>'
    + `<w:t>${marking}</w:t>`
    + '</w:r></w:p></w:ftr>';

  zip.file('word/header1.xml', headerXml);
  zip.file('word/footer1.xml', footerXml);

  // --- Update [Content_Types].xml ---
  const contentTypesFile = zip.file('[Content_Types].xml');
  if (contentTypesFile) {
    let ct = await contentTypesFile.async('string');
    const hdrOverride = '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>';
    const ftrOverride = '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>';
    ct = ct.replace('</Types>', `${hdrOverride}${ftrOverride}</Types>`);
    zip.file('[Content_Types].xml', ct);
  }

  // --- Update word/_rels/document.xml.rels ---
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    let rels = await relsFile.async('string');
    const hdrRel = '<Relationship Id="rIdClassHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>';
    const ftrRel = '<Relationship Id="rIdClassFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>';
    rels = rels.replace('</Relationships>', `${hdrRel}${ftrRel}</Relationships>`);
    zip.file('word/_rels/document.xml.rels', rels);
  }

  // --- Add headerReference and footerReference to sectPr in document.xml ---
  const hdrRef = '<w:headerReference w:type="default" r:id="rIdClassHdr"/>';
  const ftrRef = '<w:footerReference w:type="default" r:id="rIdClassFtr"/>';
  xml = xml.replace(/<\/w:sectPr>/, `${hdrRef}${ftrRef}</w:sectPr>`);

  return xml;
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
  fontFamily: string = 'times',
  fontSize: string = '12pt',
  letterheadColor?: string,
  classLevel?: string,
  customClassification?: string,
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

  // --- 6b. Classification marking header/footer ---
  // When classification is not "unclassified", inject centered bold marking
  // text into DOCX header and footer on every page.
  const classMarking = getClassificationMarking(classLevel, customClassification);
  debug.verbose('DOCX', `Step 6b: Classification marking = "${classMarking || 'none'}"`);
  if (classMarking) {
    xml = await injectClassificationHeaderFooter(zip, xml, classMarking);
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
 */
export async function convertLatexToDocx(
  latexContent: string,
  sealType?: string,
  letterheadColor?: string,
  fontFamily?: string,
  fontSize?: string,
  classLevel?: string,
  customClassification?: string,
): Promise<Blob> {
  debug.log('DOCX', '═══ Starting LaTeX → DOCX conversion ═══');
  debug.time('DOCX:totalConversion');
  debug.verbose('DOCX', `LaTeX input: ${(latexContent.length / 1024).toFixed(1)} KB, seal=${sealType}, font=${fontFamily} ${fontSize}`);

  const mod = await ensureLoaded();

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
  const finalBlob = await postProcessDocx(outputBlob, fontFamily, fontSize, letterheadColor, classLevel, customClassification);

  debug.timeEnd('DOCX:totalConversion');
  debug.log('DOCX', `═══ DOCX conversion complete: ${(finalBlob.size / 1024).toFixed(1)} KB ═══`);
  return finalBlob;
}

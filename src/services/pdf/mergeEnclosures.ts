import { PDFDocument, rgb, StandardFonts, PDFPage, PDFName, PDFArray, PDFNumber, PDFRef, PDFRawStream, PDFDict, PDFString, degrees } from 'pdf-lib';
import pako from 'pako';
import { debug } from '@/lib/debug';
import { safeUrl } from '@/lib/url-safety';

export interface EnclosureData {
  number: number;
  title: string;
  data?: ArrayBuffer; // undefined = text-only enclosure (no PDF)
  pageStyle?: 'border' | 'fullpage' | 'fit';
  hasCoverPage?: boolean; // If true, add a cover page before the enclosure content
  coverPageDescription?: string; // Optional description text for the cover page
}

export interface EnclosureError {
  enclosureNumber: number;
  title: string;
  error: string;
  pagesFailed?: number; // Number of pages that failed (if partial failure)
  pagesSucceeded?: number; // Number of pages that succeeded
}

export interface MergeResult {
  pdfBytes: Uint8Array;
  errors: EnclosureError[];
  hasErrors: boolean;
}

export interface ReferenceUrlData {
  letter: string; // e.g., "a", "b", "c"
  url: string;    // The external URL to link to
}

export interface ClassificationInfo {
  level: string; // 'unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'
  marking?: string; // The actual marking text to display (e.g., 'CUI', 'SECRET', 'TOP SECRET//SCI')
}

// Standard letter page dimensions (8.5" x 11" at 72 DPI)
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72; // 1 inch margins

// Track which page each enclosure starts on (enclosure number -> page index)
const enclosurePageMap: Map<number, number> = new Map();

/**
 * Represents a found text position in the PDF
 */
interface TextPosition {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  enclosureNumber: number;
}

/**
 * Represents a found reference link position in the PDF
 */
interface ReferencePosition {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  letter: string;
  url: string;
}

/**
 * Records that an enclosure starts on a given page index.
 */
function recordEnclosurePage(enclosureNumber: number, pageIndex: number): void {
  // Only record the first page for each enclosure
  if (!enclosurePageMap.has(enclosureNumber)) {
    enclosurePageMap.set(enclosureNumber, pageIndex);
    debug.log('Hyperlinks', `Recorded enclosure ${enclosureNumber} -> page index ${pageIndex}`);
  }
}

/**
 * Finds enclosure reference text patterns in the PDF content streams.
 * Looks for patterns like "(1)", "(2)", "(3)" that appear as blue text in the enclosure list.
 *
 * Since SwiftLaTeX doesn't create PDF link annotations for \hyperlink commands,
 * we need to find where the text is rendered and create annotations ourselves.
 */
/**
 * Decompresses a content stream if it's FlateDecode compressed.
 * Returns the decompressed bytes or the original if not compressed.
 */
function decompressContentStream(stream: PDFRawStream): Uint8Array {
  const rawBytes = stream.getContents();
  const dict = stream.dict;

  // Check for Filter entry
  const filter = dict.get(PDFName.of('Filter'));
  if (!filter) {
    // No compression
    return rawBytes;
  }

  const filterName = filter.toString();
  debug.log('Hyperlinks', `Stream filter: ${filterName}`);

  if (filterName === '/FlateDecode') {
    try {
      // Use pako to decompress
      const decompressed = pako.inflate(rawBytes);
      debug.log('Hyperlinks', `Decompressed ${rawBytes.length} -> ${decompressed.length} bytes`);
      return decompressed;
    } catch (err) {
      debug.error('Hyperlinks', 'Decompression failed:', err);
      return rawBytes;
    }
  }

  // Unsupported filter, return raw
  debug.log('Hyperlinks', `Unsupported filter: ${filterName}`);
  return rawBytes;
}

function findEnclosureReferences(pdfDoc: PDFDocument, mainPageCount: number): TextPosition[] {
  const positions: TextPosition[] = [];
  const pages = pdfDoc.getPages();

  debug.log('Hyperlinks', `Scanning ${mainPageCount} main pages for enclosure references`);

  // Only scan the main document pages (before enclosures were added)
  for (let pageIdx = 0; pageIdx < Math.min(mainPageCount, pages.length); pageIdx++) {
    const page = pages[pageIdx];

    try {
      // Access content stream through the page node
      const contentsEntry = page.node.get(PDFName.of('Contents'));
      debug.log('Hyperlinks', `Page ${pageIdx + 1} Contents type: ${contentsEntry?.constructor?.name || 'undefined'}`);

      if (!contentsEntry) {
        debug.log('Hyperlinks', `Page ${pageIdx + 1} has no Contents entry`);
        continue;
      }

      // Get the decompressed content stream bytes
      let contentBytes: Uint8Array | undefined;

      // Resolve the reference to get the actual stream
      const resolvedContents = page.node.lookup(PDFName.of('Contents'));
      debug.log('Hyperlinks', `Page ${pageIdx + 1} resolved Contents type: ${resolvedContents?.constructor?.name || 'undefined'}`);

      if (resolvedContents instanceof PDFRawStream) {
        // Direct stream - decompress if needed
        contentBytes = decompressContentStream(resolvedContents);
      } else if (resolvedContents instanceof PDFArray) {
        // Multiple content streams - decompress and concatenate them
        debug.log('Hyperlinks', `Page ${pageIdx + 1} has ${resolvedContents.size()} content streams`);
        const allBytes: number[] = [];
        for (let i = 0; i < resolvedContents.size(); i++) {
          const ref = resolvedContents.get(i);
          if (ref instanceof PDFRef) {
            const stream = pdfDoc.context.lookup(ref);
            if (stream instanceof PDFRawStream) {
              const bytes = decompressContentStream(stream);
              allBytes.push(...bytes);
            }
          }
        }
        if (allBytes.length > 0) {
          contentBytes = new Uint8Array(allBytes);
        }
      }

      if (!contentBytes) {
        debug.log('Hyperlinks', `Page ${pageIdx + 1} could not get content bytes`);
        continue;
      }

      debug.log('Hyperlinks', `Page ${pageIdx + 1} content stream size: ${contentBytes.length} bytes (decompressed)`);

      // Parse the content stream to find text positions
      const pagePositions = parseContentStreamForEnclosures(contentBytes, pageIdx);
      positions.push(...pagePositions);
    } catch (error) {
      debug.error('Hyperlinks', `Error processing page ${pageIdx + 1}:`, error);
    }
  }

  debug.log('Hyperlinks', `Found ${positions.length} enclosure references in content`);
  return positions;
}

/**
 * Parses a PDF content stream to find text that matches enclosure reference patterns.
 *
 * PDF text rendering uses operators like:
 * - BT: Begin text block
 * - ET: End text block
 * - Tm: Set text matrix (6 values, last 2 are x,y position)
 * - Td/TD: Move text position (relative offset)
 * - Tf: Set font and size
 * - Tj: Show text (string)
 * - TJ: Show text (array with spacing adjustments)
 * - ': Move to next line and show text
 * - ": Set spacing, move to next line, and show text
 */
function parseContentStreamForEnclosures(bytes: Uint8Array, pageIdx: number): TextPosition[] {
  const positions: TextPosition[] = [];
  const content = new TextDecoder('latin1').decode(bytes);

  debug.log('Hyperlinks', `Parsing page ${pageIdx + 1}, content length: ${content.length}`);

  // Track color changes and text positions
  // We're looking for blue text (0 0 1 rg) followed by a digit
  interface ColorRange {
    startPos: number;
    isBlue: boolean;
  }

  // Find all color settings (rg = non-stroke color)
  const colorRanges: ColorRange[] = [];
  // Match patterns like "0 0 1 rg" (blue) or other colors
  const colorRegex = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/g;
  let colorMatch;

  while ((colorMatch = colorRegex.exec(content)) !== null) {
    const r = parseFloat(colorMatch[1]);
    const g = parseFloat(colorMatch[2]);
    const b = parseFloat(colorMatch[3]);
    // Blue is approximately (0, 0, 1) or close to it
    const isBlue = r < 0.2 && g < 0.2 && b > 0.7;
    colorRanges.push({ startPos: colorMatch.index, isBlue });
  }

  debug.log('Hyperlinks', `Found ${colorRanges.length} color changes, ${colorRanges.filter(c => c.isBlue).length} blue`);

  // Track all position-changing operations in sequence
  // We need to handle both absolute (Tm) and relative (Td/TD) positioning
  interface PositionOp {
    type: 'Tm' | 'Td' | 'BT';
    x: number;
    y: number;
    pos: number;
  }
  const positionOps: PositionOp[] = [];

  // Find BT (begin text) operations - resets text position
  const btRegex = /\bBT\b/g;
  let btMatch;
  while ((btMatch = btRegex.exec(content)) !== null) {
    positionOps.push({ type: 'BT', x: 0, y: 0, pos: btMatch.index });
  }

  // Find Tm (text matrix) operations to track positions
  // Format: a b c d e f Tm (e and f are x,y)
  const tmRegex = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/g;
  let tmMatch;

  while ((tmMatch = tmRegex.exec(content)) !== null) {
    positionOps.push({
      type: 'Tm',
      x: parseFloat(tmMatch[5]),
      y: parseFloat(tmMatch[6]),
      pos: tmMatch.index
    });
  }

  // Find Td (text displacement) operations - relative positioning
  // Format: tx ty Td
  const tdRegex = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td\b/g;
  let tdMatch;

  while ((tdMatch = tdRegex.exec(content)) !== null) {
    positionOps.push({
      type: 'Td',
      x: parseFloat(tdMatch[1]),
      y: parseFloat(tdMatch[2]),
      pos: tdMatch.index
    });
  }

  // Find TD (text displacement + set leading) operations - relative positioning
  // Format: tx ty TD
  const tdUpperRegex = /(-?[\d.]+)\s+(-?[\d.]+)\s+TD\b/g;
  let tdUpperMatch;

  while ((tdUpperMatch = tdUpperRegex.exec(content)) !== null) {
    positionOps.push({
      type: 'Td', // Treat same as Td for position tracking
      x: parseFloat(tdUpperMatch[1]),
      y: parseFloat(tdUpperMatch[2]),
      pos: tdUpperMatch.index
    });
  }

  // Sort position operations by their position in the stream
  positionOps.sort((a, b) => a.pos - b.pos);

  debug.log('Hyperlinks', `Found ${positionOps.filter(p => p.type === 'Tm').length} Tm, ${positionOps.filter(p => p.type === 'Td').length} Td/TD operations`);

  // Find Tf (font size) operations
  // Format: /FontName size Tf
  const tfRegex = /\/\w+\s+([\d.]+)\s+Tf/g;
  let tfMatch;
  const fontSizes: { size: number; pos: number }[] = [];

  while ((tfMatch = tfRegex.exec(content)) !== null) {
    fontSizes.push({
      size: parseFloat(tfMatch[1]),
      pos: tfMatch.index
    });
  }

  // Find all text operations - both Tj and TJ
  // Tj: (text) Tj - show text
  // TJ: [(text1) num (text2) ...] TJ - show text with spacing adjustments
  const allTextOps: { text: string; pos: number }[] = [];

  // Match Tj operations: (content) Tj
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  let tjMatch;
  while ((tjMatch = tjRegex.exec(content)) !== null) {
    allTextOps.push({ text: tjMatch[1], pos: tjMatch.index });
  }

  // Match TJ operations - extract text content from the array
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  let tjArrayMatch;
  while ((tjArrayMatch = tjArrayRegex.exec(content)) !== null) {
    // Extract text from the TJ array (strings are in parentheses)
    const arrayContent = tjArrayMatch[1];
    const stringMatches = arrayContent.matchAll(/\(([^)]*)\)/g);
    for (const strMatch of stringMatches) {
      if (strMatch[1]) {
        allTextOps.push({ text: strMatch[1], pos: tjArrayMatch.index });
      }
    }
  }

  debug.log('Hyperlinks', `Found ${allTextOps.length} text operations`);

  // Helper to check if a position is in a blue color range
  function isBlueAtPosition(pos: number): boolean {
    let currentBlue = false;
    for (const range of colorRanges) {
      if (range.startPos > pos) break;
      currentBlue = range.isBlue;
    }
    return currentBlue;
  }

  // Helper to calculate absolute position at a given stream position
  // Handles both Tm (absolute) and Td (relative) operations
  function getPositionAt(pos: number): { x: number; y: number } {
    let currentX = 0;
    let currentY = 0;

    for (const op of positionOps) {
      if (op.pos > pos) break;

      if (op.type === 'BT') {
        // BT resets text matrix to identity (but keeps current position for subsequent Td)
        // In practice, the position is set by the first Tm or Td after BT
        currentX = 0;
        currentY = 0;
      } else if (op.type === 'Tm') {
        // Tm sets absolute position
        currentX = op.x;
        currentY = op.y;
      } else if (op.type === 'Td') {
        // Td adds to current position (relative offset)
        currentX += op.x;
        currentY += op.y;
      }
    }

    return { x: currentX, y: currentY };
  }

  // Helper to find nearest font size
  function getNearestFontSize(pos: number): number {
    let result = 12;
    for (const tf of fontSizes) {
      if (tf.pos > pos) break;
      result = tf.size;
    }
    return result;
  }

  // Track which enclosure numbers we've found (to avoid duplicates)
  const foundEnclosures = new Set<number>();

  // Look for single digit text that appears in blue color context
  for (const textOp of allTextOps) {
    // Check if text is a single digit (1-9)
    const digitMatch = textOp.text.match(/^(\d)$/);
    if (!digitMatch) continue;

    const encNum = parseInt(digitMatch[1], 10);
    if (encNum < 1 || encNum > 9) continue;

    // Check if this digit is rendered in blue
    const isBlue = isBlueAtPosition(textOp.pos);
    if (!isBlue) continue;

    // Skip if we already found this enclosure number
    if (foundEnclosures.has(encNum)) continue;

    // Get position and font size
    const position = getPositionAt(textOp.pos);
    const fontSize = getNearestFontSize(textOp.pos);

    debug.log('Hyperlinks', `Found blue digit ${encNum} at (${position.x}, ${position.y}), fontSize=${fontSize}`);

    foundEnclosures.add(encNum);
    positions.push({
      pageIndex: pageIdx,
      x: position.x,
      y: position.y,
      width: fontSize * 0.6,
      height: fontSize,
      text: String(encNum),
      enclosureNumber: encNum
    });
  }

  debug.log('Hyperlinks', `Page ${pageIdx + 1}: found ${positions.length} enclosure references`);

  // Fix potential x-coordinate misalignment for enclosure 1
  // In military correspondence, enclosure numbers (1), (2), (3) should be vertically aligned
  // Sometimes the first "1" detected might be from a different context (page number, reference, etc.)
  // If enclosure 1's x is significantly different from the others, align it to match
  if (positions.length >= 2) {
    const enc1 = positions.find(p => p.enclosureNumber === 1);
    const otherEncs = positions.filter(p => p.enclosureNumber !== 1);

    if (enc1 && otherEncs.length > 0) {
      // Calculate average x of other enclosures
      const avgX = otherEncs.reduce((sum, p) => sum + p.x, 0) / otherEncs.length;

      // If enclosure 1's x is more than 30 points away from the average, it's probably wrong
      if (Math.abs(enc1.x - avgX) > 30) {
        debug.log('Hyperlinks', `Correcting enclosure 1 x-position: ${enc1.x} -> ${avgX} (was misaligned)`);
        enc1.x = avgX;
      }
    }
  }

  return positions;
}

/**
 * Creates link annotations at the specified text positions.
 * These annotations will link to the corresponding enclosure pages.
 */
function createLinkAnnotations(pdfDoc: PDFDocument, positions: TextPosition[]): void {
  if (positions.length === 0 || enclosurePageMap.size === 0) {
    debug.log('Hyperlinks', 'No positions or enclosure pages to link');
    return;
  }

  const pages = pdfDoc.getPages();
  let createdCount = 0;

  for (const pos of positions) {
    const targetPageIndex = enclosurePageMap.get(pos.enclosureNumber);
    if (targetPageIndex === undefined) {
      debug.log('Hyperlinks', `No target page for enclosure ${pos.enclosureNumber}`);
      continue;
    }

    if (pos.pageIndex >= pages.length || targetPageIndex >= pages.length) {
      debug.log('Hyperlinks', `Page index out of bounds: source=${pos.pageIndex}, target=${targetPageIndex}`);
      continue;
    }

    const sourcePage = pages[pos.pageIndex];
    const targetPage = pages[targetPageIndex];

    // Create the link annotation rectangle
    // Add some padding around the text
    const padding = 2;
    const rect = pdfDoc.context.obj([
      PDFNumber.of(pos.x - padding),
      PDFNumber.of(pos.y - padding),
      PDFNumber.of(pos.x + pos.width + padding * 2),
      PDFNumber.of(pos.y + pos.height + padding)
    ]);

    // Create a GoTo action pointing to the target page
    const action = pdfDoc.context.obj({
      Type: PDFName.of('Action'),
      S: PDFName.of('GoTo'),
      D: pdfDoc.context.obj([
        targetPage.ref,
        PDFName.of('XYZ'),
        PDFNumber.of(0),
        PDFNumber.of(PAGE_HEIGHT),
        PDFNumber.of(0)
      ])
    });

    // Create the link annotation
    const linkAnnotation = pdfDoc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: rect,
      Border: pdfDoc.context.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)]),
      A: action,
      // Invert highlighting on click for visual feedback
      H: PDFName.of('I'),
      // Page reference (required by some viewers)
      P: sourcePage.ref,
      // Flags: Print (4) - annotation should print
      F: PDFNumber.of(4)
    });

    // Get or create the Annots array for the page
    const linkRef = pdfDoc.context.register(linkAnnotation);
    const annots = sourcePage.node.lookup(PDFName.of('Annots'));

    if (annots instanceof PDFArray) {
      annots.push(linkRef);
    } else {
      // Create new Annots array
      const newAnnots = pdfDoc.context.obj([linkRef]);
      sourcePage.node.set(PDFName.of('Annots'), newAnnots);
    }

    createdCount++;
    debug.log('Hyperlinks', `Created link for enclosure ${pos.enclosureNumber} at (${pos.x}, ${pos.y}) -> page ${targetPageIndex + 1}`);
  }

  debug.log('Hyperlinks', `Created ${createdCount} link annotations`);
}

/**
 * Creates named destinations in the PDF's Names/Dests dictionary.
 * This allows LaTeX \hyperlink{enclosureN} commands to find their targets.
 *
 * The LaTeX template uses:
 * - \hyperlink{enclosure1}{...} to create links
 * - \hypertarget{enclosure1}{} to create targets
 *
 * Since SwiftLaTeX can't run \includepdf, the enclosure pages are added
 * by JavaScript. We need to manually create the named destinations that
 * the \hyperlink commands expect to find.
 */
function createNamedDestinations(pdfDoc: PDFDocument): void {
  if (enclosurePageMap.size === 0) {
    debug.log('Hyperlinks', 'No enclosures to create destinations for');
    return;
  }

  const pages = pdfDoc.getPages();
  const context = pdfDoc.context;

  // Build the names array: [name1, dest1, name2, dest2, ...]
  // Names must be sorted lexicographically for PDF spec compliance
  const sortedEntries = Array.from(enclosurePageMap.entries())
    .sort((a, b) => a[0] - b[0]); // Sort by enclosure number

  const namesArray: (PDFString | PDFArray)[] = [];

  for (const [encNum, pageIndex] of sortedEntries) {
    if (pageIndex >= pages.length) {
      debug.log('Hyperlinks', `Skipping enclosure${encNum}: page index ${pageIndex} out of bounds`);
      continue;
    }

    const targetPage = pages[pageIndex];
    const destName = `enclosure${encNum}`;

    // Create the destination array: [pageRef, /XYZ, left, top, zoom]
    // XYZ destination: go to page at position (left, top) with zoom
    // Using 0, PAGE_HEIGHT, 0 means: top of page, no zoom change
    const destArray = context.obj([
      targetPage.ref,
      PDFName.of('XYZ'),
      PDFNumber.of(0),
      PDFNumber.of(PAGE_HEIGHT),
      PDFNumber.of(0)  // null zoom = keep current
    ]);

    namesArray.push(PDFString.of(destName));
    namesArray.push(destArray as PDFArray);

    debug.log('Hyperlinks', `Created named destination '${destName}' -> page ${pageIndex + 1}`);
  }

  if (namesArray.length === 0) {
    debug.log('Hyperlinks', 'No valid destinations to create');
    return;
  }

  // Create the Dests name tree
  // A simple name tree has: { Names: [...] }
  const destsDict = context.obj({
    Names: context.obj(namesArray)
  });

  // Get or create the Names dictionary in the catalog
  const catalog = pdfDoc.catalog;
  const namesDict = catalog.lookup(PDFName.of('Names'));

  if (namesDict instanceof PDFDict) {
    // Names dictionary exists - add or replace Dests entry
    namesDict.set(PDFName.of('Dests'), destsDict);
    debug.log('Hyperlinks', 'Added Dests to existing Names dictionary');
  } else {
    // Create new Names dictionary with Dests
    const newNamesDict = context.obj({
      Dests: destsDict
    });
    catalog.set(PDFName.of('Names'), newNamesDict);
    debug.log('Hyperlinks', 'Created new Names dictionary with Dests');
  }

  debug.log('Hyperlinks', `Created ${sortedEntries.length} named destinations`);
}

/**
 * Finds reference link text patterns in the PDF content streams.
 * Looks for patterns like "reference (a)", "reference (b)" that appear as blue text.
 *
 * The LaTeX template uses \reflink{letter} which produces "reference (letter)" in blue.
 * SwiftLaTeX doesn't create proper URI link annotations, so we need to find the text
 * and create the annotations ourselves.
 */
function findReferenceLinks(pdfDoc: PDFDocument, mainPageCount: number, references: ReferenceUrlData[]): ReferencePosition[] {
  debug.log('Hyperlinks', 'findReferenceLinks called with', references.length, 'references');
  const positions: ReferencePosition[] = [];
  const pages = pdfDoc.getPages();

  if (references.length === 0) {
    debug.log('Hyperlinks', 'No reference URLs to search for');
    return positions;
  }

  // Create a map for quick URL lookup by letter.
  //
  // safeUrl() validates the protocol (allowlist: http, https, mailto)
  // and rejects dangerous schemes like javascript: / data: / file:
  // that the previous "blindly prepend https://" logic was happy to
  // pass through to the PDF /URI annotation. See @/lib/url-safety
  // for the threat model. Issue #17.
  //
  // If safeUrl returns null (unsafe or unparseable), we skip the
  // urlMap entry entirely — the reference still appears in the
  // bibliography, just without a clickable link.
  const urlMap = new Map<string, string>();
  for (const ref of references) {
    const url = safeUrl(ref.url);
    if (!url) {
      debug.log('Hyperlinks', `Reference '${ref.letter}' -> rejected (unsafe or empty URL)`);
      continue;
    }
    debug.log('Hyperlinks', `Reference '${ref.letter}' -> ${url}`);
    urlMap.set(ref.letter.toLowerCase(), url);
  }

  debug.log('Hyperlinks', `Scanning ${mainPageCount} pages for reference links (${references.length} references with URLs)`);

  // Scan main document pages for reference links
  for (let pageIdx = 0; pageIdx < Math.min(mainPageCount, pages.length); pageIdx++) {
    const page = pages[pageIdx];

    try {
      const contentsEntry = page.node.get(PDFName.of('Contents'));
      if (!contentsEntry) continue;

      let contentBytes: Uint8Array | undefined;
      const resolvedContents = page.node.lookup(PDFName.of('Contents'));

      if (resolvedContents instanceof PDFRawStream) {
        contentBytes = decompressContentStream(resolvedContents);
      } else if (resolvedContents instanceof PDFArray) {
        const allBytes: number[] = [];
        for (let i = 0; i < resolvedContents.size(); i++) {
          const ref = resolvedContents.get(i);
          if (ref instanceof PDFRef) {
            const stream = pdfDoc.context.lookup(ref);
            if (stream instanceof PDFRawStream) {
              const bytes = decompressContentStream(stream);
              allBytes.push(...bytes);
            }
          }
        }
        if (allBytes.length > 0) {
          contentBytes = new Uint8Array(allBytes);
        }
      }

      if (!contentBytes) continue;

      // Parse content stream for reference text
      const pagePositions = parseContentStreamForReferences(contentBytes, pageIdx, urlMap);
      positions.push(...pagePositions);
    } catch (error) {
      debug.error('Hyperlinks', `Error processing page ${pageIdx + 1} for references:`, error);
    }
  }

  debug.log('Hyperlinks', `Found ${positions.length} reference links`);
  return positions;
}

/**
 * Parses a PDF content stream to find reference link text patterns.
 * Looks for blue text containing "reference" followed by "(letter)".
 */
function parseContentStreamForReferences(bytes: Uint8Array, pageIdx: number, urlMap: Map<string, string>): ReferencePosition[] {
  debug.log('Hyperlinks', `Parsing page ${pageIdx + 1} content stream (${bytes.length} bytes)`);
  const positions: ReferencePosition[] = [];
  const content = new TextDecoder('latin1').decode(bytes);

  // Track color changes (looking for blue text: 0 0 1 rg)
  interface ColorRange {
    startPos: number;
    isBlue: boolean;
  }
  const colorRanges: ColorRange[] = [];
  const colorRegex = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/g;
  let colorMatch;

  while ((colorMatch = colorRegex.exec(content)) !== null) {
    const r = parseFloat(colorMatch[1]);
    const g = parseFloat(colorMatch[2]);
    const b = parseFloat(colorMatch[3]);
    const isBlue = r < 0.2 && g < 0.2 && b > 0.7;
    colorRanges.push({ startPos: colorMatch.index, isBlue });
  }

  // Track position operations
  interface PositionOp {
    type: 'Tm' | 'Td' | 'BT';
    x: number;
    y: number;
    pos: number;
  }
  const positionOps: PositionOp[] = [];

  // Find BT operations
  const btRegex = /\bBT\b/g;
  let btMatch;
  while ((btMatch = btRegex.exec(content)) !== null) {
    positionOps.push({ type: 'BT', x: 0, y: 0, pos: btMatch.index });
  }

  // Find Tm operations
  const tmRegex = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/g;
  let tmMatch;
  while ((tmMatch = tmRegex.exec(content)) !== null) {
    positionOps.push({
      type: 'Tm',
      x: parseFloat(tmMatch[5]),
      y: parseFloat(tmMatch[6]),
      pos: tmMatch.index
    });
  }

  // Find Td operations
  const tdRegex = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td\b/g;
  let tdMatch;
  while ((tdMatch = tdRegex.exec(content)) !== null) {
    positionOps.push({
      type: 'Td',
      x: parseFloat(tdMatch[1]),
      y: parseFloat(tdMatch[2]),
      pos: tdMatch.index
    });
  }

  // Find TD operations
  const tdUpperRegex = /(-?[\d.]+)\s+(-?[\d.]+)\s+TD\b/g;
  let tdUpperMatch;
  while ((tdUpperMatch = tdUpperRegex.exec(content)) !== null) {
    positionOps.push({
      type: 'Td',
      x: parseFloat(tdUpperMatch[1]),
      y: parseFloat(tdUpperMatch[2]),
      pos: tdUpperMatch.index
    });
  }

  positionOps.sort((a, b) => a.pos - b.pos);

  // Find font sizes
  const tfRegex = /\/\w+\s+([\d.]+)\s+Tf/g;
  let tfMatch;
  const fontSizes: { size: number; pos: number }[] = [];
  while ((tfMatch = tfRegex.exec(content)) !== null) {
    fontSizes.push({ size: parseFloat(tfMatch[1]), pos: tfMatch.index });
  }

  // Helper functions
  function isBlueAtPosition(pos: number): boolean {
    let currentBlue = false;
    for (const range of colorRanges) {
      if (range.startPos > pos) break;
      currentBlue = range.isBlue;
    }
    return currentBlue;
  }

  function getPositionAt(pos: number): { x: number; y: number } {
    let currentX = 0;
    let currentY = 0;
    for (const op of positionOps) {
      if (op.pos > pos) break;
      if (op.type === 'BT') {
        currentX = 0;
        currentY = 0;
      } else if (op.type === 'Tm') {
        currentX = op.x;
        currentY = op.y;
      } else if (op.type === 'Td') {
        currentX += op.x;
        currentY += op.y;
      }
    }
    return { x: currentX, y: currentY };
  }

  function getNearestFontSize(pos: number): number {
    let result = 12;
    for (const tf of fontSizes) {
      if (tf.pos > pos) break;
      result = tf.size;
    }
    return result;
  }

  // Track found reference letters to avoid duplicates
  const foundLetters = new Set<string>();

  // Method 1: Look for blue text containing "reference" or "ref"
  // Then look for nearby "(letter)" patterns
  const allTextOps: { text: string; pos: number }[] = [];

  // Match Tj operations
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  let tjMatch;
  while ((tjMatch = tjRegex.exec(content)) !== null) {
    allTextOps.push({ text: tjMatch[1], pos: tjMatch.index });
  }

  // Match TJ operations
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  let tjArrayMatch;
  while ((tjArrayMatch = tjArrayRegex.exec(content)) !== null) {
    const arrayContent = tjArrayMatch[1];
    const stringMatches = arrayContent.matchAll(/\(([^)]*)\)/g);
    for (const strMatch of stringMatches) {
      if (strMatch[1]) {
        allTextOps.push({ text: strMatch[1], pos: tjArrayMatch.index });
      }
    }
  }

  // Debug: Log all blue text operations to understand what patterns exist
  const blueTextOps = allTextOps.filter(op => isBlueAtPosition(op.pos));
  if (blueTextOps.length > 0) {
    debug.log('Hyperlinks', `Page ${pageIdx + 1}: Found ${blueTextOps.length} blue text operations:`);
    blueTextOps.slice(0, 20).forEach((op, i) => {
      const pos = getPositionAt(op.pos);
      debug.log('Hyperlinks', `  [${i}] "${op.text}" at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
    });
    if (blueTextOps.length > 20) {
      debug.log('Hyperlinks', `  ... and ${blueTextOps.length - 20} more`);
    }
  }

  // Look for blue text that might be a reference letter in parentheses
  // The pattern "reference (a)" could be split across multiple text operations
  // So we look for single letter patterns like "a", "b", etc. in blue near "reference" text
  for (const textOp of allTextOps) {
    // Check for single lowercase letter (reference letter)
    const letterMatch = textOp.text.match(/^([a-z])$/i);
    if (letterMatch) {
      const letter = letterMatch[1].toLowerCase();
      const url = urlMap.get(letter);

      if (url && !foundLetters.has(letter) && isBlueAtPosition(textOp.pos)) {
        const position = getPositionAt(textOp.pos);
        const fontSize = getNearestFontSize(textOp.pos);

        debug.log('Hyperlinks', `Found blue reference letter '${letter}' at (${position.x}, ${position.y}), fontSize=${fontSize}`);

        foundLetters.add(letter);
        // Use a very large clickable area since position parsing can be imprecise
        // The position might be off by 50+ points, so cover the entire likely region
        // Start from left margin and extend well past where "reference (x)" would appear
        const startX = Math.min(position.x, MARGIN); // Use left margin or found position, whichever is smaller
        positions.push({
          pageIndex: pageIdx,
          x: startX,
          y: position.y - fontSize * 0.2, // Slightly lower to catch descenders
          width: 200, // Cover ~3 inches from left margin - should catch any reference text
          height: fontSize * 1.4,
          letter,
          url
        });
      }
    }

    // Also check for full "reference (x)" patterns in case they're in one string
    const refMatch = textOp.text.match(/reference\s*\(([a-z])\)/i);
    if (refMatch) {
      const letter = refMatch[1].toLowerCase();
      const url = urlMap.get(letter);

      if (url && !foundLetters.has(letter) && isBlueAtPosition(textOp.pos)) {
        const position = getPositionAt(textOp.pos);
        const fontSize = getNearestFontSize(textOp.pos);

        debug.log('Hyperlinks', `Found blue 'reference (${letter})' at (${position.x}, ${position.y})`);

        foundLetters.add(letter);
        const startX = Math.min(position.x, MARGIN);
        positions.push({
          pageIndex: pageIdx,
          x: startX,
          y: position.y - fontSize * 0.2,
          width: 200,
          height: fontSize * 1.4,
          letter,
          url
        });
      }
    }

    // Also check if text contains a letter that has a URL (more lenient matching)
    // This handles cases where the letter might be in a longer string
    if (isBlueAtPosition(textOp.pos)) {
      for (const [letter, url] of urlMap.entries()) {
        if (!foundLetters.has(letter) && textOp.text.toLowerCase().includes(letter)) {
          const position = getPositionAt(textOp.pos);
          const fontSize = getNearestFontSize(textOp.pos);

          debug.log('Hyperlinks', `Found blue text containing '${letter}': "${textOp.text}" at (${position.x}, ${position.y})`);

          foundLetters.add(letter);
          const startX = Math.min(position.x, MARGIN);
          positions.push({
            pageIndex: pageIdx,
            x: startX,
            y: position.y - fontSize * 0.2,
            width: 200,
            height: fontSize * 1.4,
            letter,
            url
          });
          break; // Only add once per text operation
        }
      }
    }
  }

  if (positions.length > 0) {
    debug.log('Hyperlinks', `Page ${pageIdx + 1}: found ${positions.length} reference links`);
  }

  return positions;
}

/**
 * Creates URI link annotations for reference hyperlinks.
 * These annotations open external URLs when clicked.
 */
function createUriLinkAnnotations(pdfDoc: PDFDocument, positions: ReferencePosition[]): void {
  if (positions.length === 0) {
    debug.log('Hyperlinks', 'No reference positions to create URI links for');
    return;
  }

  const pages = pdfDoc.getPages();
  let createdCount = 0;

  for (const pos of positions) {
    if (pos.pageIndex >= pages.length) {
      debug.log('Hyperlinks', `Page index ${pos.pageIndex} out of bounds for reference ${pos.letter}`);
      continue;
    }

    const page = pages[pos.pageIndex];

    // Create the link annotation rectangle with padding
    const padding = 2;
    const rectLLX = pos.x - padding;
    const rectLLY = pos.y - padding;
    const rectURX = pos.x + pos.width + padding * 2;
    const rectURY = pos.y + pos.height + padding;

    debug.log('Hyperlinks', `Creating URI rect for '${pos.letter}': [${rectLLX.toFixed(1)}, ${rectLLY.toFixed(1)}, ${rectURX.toFixed(1)}, ${rectURY.toFixed(1)}] (${(rectURX - rectLLX).toFixed(1)} x ${(rectURY - rectLLY).toFixed(1)} points)`);

    const rect = pdfDoc.context.obj([
      PDFNumber.of(rectLLX),
      PDFNumber.of(rectLLY),
      PDFNumber.of(rectURX),
      PDFNumber.of(rectURY)
    ]);

    // Create a URI action for external link
    const action = pdfDoc.context.obj({
      Type: PDFName.of('Action'),
      S: PDFName.of('URI'),
      URI: PDFString.of(pos.url)
    });

    // Create the link annotation
    const linkAnnotation = pdfDoc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: rect,
      Border: pdfDoc.context.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)]),
      A: action,
      H: PDFName.of('I'),
      P: page.ref,
      F: PDFNumber.of(4)
    });

    // Add to page's Annots array
    const linkRef = pdfDoc.context.register(linkAnnotation);
    const annots = page.node.lookup(PDFName.of('Annots'));

    if (annots instanceof PDFArray) {
      annots.push(linkRef);
    } else {
      const newAnnots = pdfDoc.context.obj([linkRef]);
      page.node.set(PDFName.of('Annots'), newAnnots);
    }

    createdCount++;
    debug.log('Hyperlinks', `Created URI link for reference (${pos.letter}) -> ${pos.url}`);
  }

  debug.log('Hyperlinks', `Created ${createdCount} URI link annotations for references`);
}

interface ValidatePdfResult {
  pdf: PDFDocument | null;
  error: string | null;
}

/**
 * Validates a PDF buffer to check if it can be loaded and has valid pages.
 *
 * Returns the loaded PDFDocument on success so callers can reuse it
 * (avoiding a second PDFDocument.load() in addPdfEnclosure — a 5-enclosure
 * doc previously did 11 PDF parses; now it does 6).
 */
async function validatePdf(data: ArrayBuffer, enclosureNumber: number): Promise<ValidatePdfResult> {
  try {
    const pdf = await PDFDocument.load(data, { ignoreEncryption: true });
    const pageCount = pdf.getPageCount();

    if (pageCount === 0) {
      return { pdf: null, error: 'PDF has no pages' };
    }

    // Try to access each page to detect corruption
    for (let i = 0; i < pageCount; i++) {
      const page = pdf.getPage(i);
      // Check if page has contents (required for embedding)
      const contents = page.node.get(PDFName.of('Contents'));
      if (!contents) {
        return { pdf: null, error: `Page ${i + 1} is missing content stream (corrupted or empty page)` };
      }
    }

    return { pdf, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    debug.error('MergeEnclosures', `Enclosure ${enclosureNumber} validation failed:`, message);
    return { pdf: null, error: message };
  }
}

/**
 * Merges enclosure pages into the main document.
 * Handles both PDF enclosures and text-only placeholder pages.
 * Maintains correct enclosure ordering.
 * Returns both the PDF bytes and any errors encountered.
 */
export async function mergeEnclosures(
  mainPdfBytes: Uint8Array,
  enclosures: EnclosureData[],
  classification?: ClassificationInfo,
  includeHyperlinks = false,
  referenceUrls: ReferenceUrlData[] = []
): Promise<MergeResult> {
  debug.log('MergeEnclosures', 'Called with', enclosures.length, 'enclosures, hyperlinks:', includeHyperlinks, 'references:', referenceUrls.length);

  const errors: EnclosureError[] = [];

  // If no enclosures but we have reference hyperlinks to process, still load and modify the PDF
  if (enclosures.length === 0 && (!includeHyperlinks || referenceUrls.length === 0)) {
    return { pdfBytes: mainPdfBytes, errors: [], hasErrors: false };
  }

  // Clear enclosure page map for fresh run
  enclosurePageMap.clear();

  // Load the main document
  const mainPdf = await PDFDocument.load(mainPdfBytes);
  const helveticaBold = await mainPdf.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await mainPdf.embedFont(StandardFonts.Helvetica);

  // Record the number of pages in the main document BEFORE adding enclosures
  const mainPageCount = mainPdf.getPageCount();
  debug.log('MergeEnclosures', `Main document has ${mainPageCount} pages before adding enclosures`);

  // Process each enclosure in order
  for (const enclosure of enclosures) {
    try {
      // Add optional cover/placeholder page before the enclosure content
      if (enclosure.hasCoverPage) {
        addCoverPage(mainPdf, enclosure, helveticaBold, helvetica, classification);
      }

      if (enclosure.data) {
        // Validate PDF before attempting to merge. validatePdf returns the
        // loaded PDFDocument on success so addPdfEnclosure can reuse it
        // instead of parsing the same bytes a second time.
        const { pdf: enclosurePdf, error: validationError } = await validatePdf(enclosure.data, enclosure.number);
        if (validationError || !enclosurePdf) {
          debug.error('MergeEnclosures', `Enclosure ${enclosure.number} "${enclosure.title}" failed validation: ${validationError}`);
          errors.push({
            enclosureNumber: enclosure.number,
            title: enclosure.title,
            error: validationError ?? 'Unknown validation error'
          });
          // Create an error placeholder page
          addPlaceholderPage(mainPdf, enclosure, helveticaBold, helvetica, true, classification, validationError ?? 'Unknown validation error');
          continue;
        }

        // PDF enclosure — pass the already-loaded PDFDocument so we don't
        // re-parse the same bytes.
        const result = await addPdfEnclosure(mainPdf, enclosure, enclosurePdf, helveticaBold, helvetica, classification);
        if (result.error) {
          errors.push(result.error);
        }
      }
      // Note: Text-only enclosures without hasCoverPage just appear in the enclosure list
      // No placeholder page is created unless explicitly requested via hasCoverPage
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      debug.error('MergeEnclosures', `Failed to add enclosure ${enclosure.number}:`, err);
      errors.push({
        enclosureNumber: enclosure.number,
        title: enclosure.title,
        error: errorMessage
      });
      // Create an error placeholder page only if there was supposed to be PDF content
      if (enclosure.data) {
        addPlaceholderPage(mainPdf, enclosure, helveticaBold, helvetica, true, classification, errorMessage);
      }
    }
  }

  // Create named destinations for hyperlinks if enabled
  // The LaTeX template uses \hyperlink{enclosureN} which looks for named destinations
  // We create these destinations pointing to the first page of each enclosure
  if (includeHyperlinks && enclosurePageMap.size > 0) {
    debug.log('MergeEnclosures', 'Creating named destinations for hyperlinks...');
    createNamedDestinations(mainPdf);

    // Also create link annotations as a fallback for viewers that don't support named destinations
    // (This finds blue digit text and creates clickable regions)
    debug.log('MergeEnclosures', 'Creating link annotations as fallback...');
    const positions = findEnclosureReferences(mainPdf, mainPageCount);
    createLinkAnnotations(mainPdf, positions);
  }

  // Create URI link annotations for reference hyperlinks
  // The LaTeX template uses \reflink{letter} which produces "reference (letter)" in blue
  // SwiftLaTeX doesn't create proper URI annotations, so we create them ourselves
  if (includeHyperlinks && referenceUrls.length > 0) {
    debug.log('MergeEnclosures', 'Processing reference hyperlinks...');
    const refPositions = findReferenceLinks(mainPdf, mainPageCount, referenceUrls);
    createUriLinkAnnotations(mainPdf, refPositions);
  }

  // Clear for next use
  enclosurePageMap.clear();

  const pdfBytes = await mainPdf.save();

  if (errors.length > 0) {
    debug.warn('MergeEnclosures', `Completed with ${errors.length} enclosure error(s):`, errors);
  }

  return { pdfBytes, errors, hasErrors: errors.length > 0 };
}

/**
 * Result of adding a PDF enclosure
 */
interface AddEnclosureResult {
  pagesAdded: number;
  pagesFailed: number;
  error?: EnclosureError;
}

/**
 * Adds a PDF enclosure to the document with the specified page style.
 * Handles page-level errors gracefully, continuing with valid pages.
 *
 * Takes a pre-loaded PDFDocument (from validatePdf) to avoid a redundant
 * parse — the previous version was loading every enclosure twice.
 */
async function addPdfEnclosure(
  mainPdf: PDFDocument,
  enclosure: EnclosureData,
  enclosurePdf: PDFDocument,
  helveticaBold: Awaited<ReturnType<typeof mainPdf.embedFont>>,
  helvetica: Awaited<ReturnType<typeof mainPdf.embedFont>>,
  classification?: ClassificationInfo
): Promise<AddEnclosureResult> {
  if (!enclosure.data) return { pagesAdded: 0, pagesFailed: 0 };

  const pageCount = enclosurePdf.getPageCount();
  const style = enclosure.pageStyle || 'border';

  let pagesAdded = 0;
  let pagesFailed = 0;
  const failedPageErrors: string[] = [];

  // Process each page
  for (let i = 0; i < pageCount; i++) {
    try {
      const srcPage = enclosurePdf.getPage(i);
      const { width: srcWidth, height: srcHeight } = srcPage.getSize();

      // ============================================================
      // ROTATION HANDLING
      // ============================================================
      // Problem: PDFs can have rotation metadata (90, 180, 270 degrees).
      // PDF viewers read this and rotate the display automatically.
      // But pdf-lib's embedPage() loses this metadata, so pages that
      // should appear rotated end up sideways or upside down.
      //
      // Solution: Read the rotation, then manually apply it when drawing.
      // We use NEGATIVE rotation because pdf-lib's rotation direction
      // is opposite to what the PDF spec intends.
      // ============================================================
      const rotation = srcPage.getRotation().angle;
      const isRotated90or270 = rotation === 90 || rotation === 270;

      // When a page is rotated 90° or 270°, its visual width/height are swapped.
      // A portrait PDF (612x792) with 90° rotation appears as landscape (792x612).
      // We need these visual dimensions for proper layout calculations.
      const visualWidth = isRotated90or270 ? srcHeight : srcWidth;
      const visualHeight = isRotated90or270 ? srcWidth : srcHeight;

      // Check if page has content
      const contents = srcPage.node.get(PDFName.of('Contents'));
      if (!contents) {
        throw new Error(`Page ${i + 1} has no content stream (empty or malformed page)`);
      }

      const page = mainPdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

      // Record first page for hyperlink navigation
      if (pagesAdded === 0 && !enclosure.hasCoverPage) {
        recordEnclosurePage(enclosure.number, mainPdf.getPageCount() - 1);
      }

      if (classification?.marking) {
        addClassificationMarking(page, classification.marking, helveticaBold, 'top');
      }

      const embeddedPage = await mainPdf.embedPage(srcPage);

      // Calculate layout using VISUAL dimensions (after rotation)
      // This ensures the rotated content is sized correctly for our output page
      const { scale, x, y, drawBorder } = calculatePageLayout(
        visualWidth,
        visualHeight,
        style
      );

      // ============================================================
      // ANCHOR POINT CALCULATION
      // ============================================================
      // pdf-lib rotates content around the anchor point (drawX, drawY).
      // After rotation, the content shifts position. We must offset the
      // anchor so the final rotated content lands at our target (x, y).
      //
      // These offsets were determined by calculating where the bottom-left
      // corner of the content ends up after each rotation amount.
      // ============================================================
      let drawX = x;
      let drawY = y;

      if (rotation === 90) {
        // Applying -90° rotates content clockwise
        // Content's bottom-left shifts down, so place anchor above target
        drawX = x;
        drawY = y + visualHeight * scale;
      } else if (rotation === 180) {
        // Applying -180° flips content
        // Content's bottom-left shifts left and down, anchor at top-right
        drawX = x + visualWidth * scale;
        drawY = y + visualHeight * scale;
      } else if (rotation === 270) {
        // Applying -270° (same as +90°) rotates counter-clockwise
        // Content's bottom-left shifts left, so place anchor to the right
        drawX = x + visualWidth * scale;
        drawY = y;
      }

      // Apply negative rotation to display page upright
      page.drawPage(embeddedPage, {
        x: drawX,
        y: drawY,
        xScale: scale,
        yScale: scale,
        rotate: rotation !== 0 ? degrees(-rotation) : undefined,
      });

      // Border at visual position with visual dimensions
      if (drawBorder) {
        page.drawRectangle({
          x: x,
          y: y,
          width: visualWidth * scale,
          height: visualHeight * scale,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.5,
        });
      }

      // Add enclosure label at bottom right
      addEnclosureLabel(page, enclosure.number, helveticaBold);

      // Add page number for multi-page enclosures (bottom center)
      if (pageCount > 1) {
        addPageNumber(page, i + 1, helveticaBold);
      }

      // Add classification marking at bottom
      if (classification?.marking) {
        addClassificationMarking(page, classification.marking, helveticaBold, 'bottom');
      }

      pagesAdded++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      debug.error('MergeEnclosures', `Failed to add page ${i + 1} of enclosure ${enclosure.number}:`, errorMsg);
      failedPageErrors.push(`Page ${i + 1}: ${errorMsg}`);
      pagesFailed++;
    }
  }

  // If all pages failed, create a placeholder page
  if (pagesAdded === 0 && pagesFailed > 0) {
    const errorMessage = failedPageErrors.join('; ');
    addPlaceholderPage(mainPdf, enclosure, helveticaBold, helvetica, true, classification, errorMessage);

    return {
      pagesAdded: 0,
      pagesFailed,
      error: {
        enclosureNumber: enclosure.number,
        title: enclosure.title,
        error: `All ${pagesFailed} page(s) failed to load: ${errorMessage}`,
        pagesFailed,
        pagesSucceeded: 0
      }
    };
  }

  // If some pages failed, return partial error info
  if (pagesFailed > 0) {
    return {
      pagesAdded,
      pagesFailed,
      error: {
        enclosureNumber: enclosure.number,
        title: enclosure.title,
        error: `${pagesFailed} of ${pageCount} page(s) failed: ${failedPageErrors.join('; ')}`,
        pagesFailed,
        pagesSucceeded: pagesAdded
      }
    };
  }

  return { pagesAdded, pagesFailed: 0 };
}

/**
 * Calculate page layout based on style
 */
function calculatePageLayout(
  srcWidth: number,
  srcHeight: number,
  style: 'border' | 'fullpage' | 'fit'
): { scale: number; x: number; y: number; drawBorder: boolean } {
  switch (style) {
    case 'fullpage': {
      // Scale to fill the entire page (no margins)
      const scaleX = PAGE_WIDTH / srcWidth;
      const scaleY = PAGE_HEIGHT / srcHeight;
      const scale = Math.min(scaleX, scaleY);
      const scaledWidth = srcWidth * scale;
      const scaledHeight = srcHeight * scale;
      return {
        scale,
        x: (PAGE_WIDTH - scaledWidth) / 2,
        y: (PAGE_HEIGHT - scaledHeight) / 2,
        drawBorder: false,
      };
    }

    case 'fit': {
      // Fit within margins (1 inch on all sides, plus space for header)
      const headerSpace = 36; // 0.5 inch for header
      const availWidth = PAGE_WIDTH - 2 * MARGIN;
      const availHeight = PAGE_HEIGHT - 2 * MARGIN - headerSpace;
      const scaleX = availWidth / srcWidth;
      const scaleY = availHeight / srcHeight;
      const scale = Math.min(scaleX, scaleY);
      const scaledWidth = srcWidth * scale;
      const scaledHeight = srcHeight * scale;
      return {
        scale,
        x: (PAGE_WIDTH - scaledWidth) / 2,
        y: MARGIN + (availHeight - scaledHeight) / 2,
        drawBorder: false,
      };
    }

    case 'border':
    default: {
      // 85% scale with border, centered
      const scale = 0.85;
      const scaledWidth = srcWidth * scale;
      const scaledHeight = srcHeight * scale;
      // Adjust vertical position to account for header
      const headerSpace = 36;
      const availHeight = PAGE_HEIGHT - headerSpace - MARGIN;
      return {
        scale,
        x: (PAGE_WIDTH - scaledWidth) / 2,
        y: MARGIN + (availHeight - scaledHeight) / 2,
        drawBorder: true,
      };
    }
  }
}

/**
 * Adds a placeholder page for text-only enclosures or failed PDF loads
 */
function addPlaceholderPage(
  mainPdf: PDFDocument,
  enclosure: EnclosureData,
  helveticaBold: Awaited<ReturnType<typeof mainPdf.embedFont>>,
  helvetica: Awaited<ReturnType<typeof mainPdf.embedFont>>,
  isError = false,
  classification?: ClassificationInfo,
  errorDetails?: string
): void {
  const page = mainPdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Record page for hyperlink navigation
  recordEnclosurePage(enclosure.number, mainPdf.getPageCount() - 1);

  // Add classification marking at top
  if (classification?.marking) {
    addClassificationMarking(page, classification.marking, helveticaBold, 'top');
  }

  // Add title in center
  const titleFontSize = 16;
  const title = enclosure.title;
  const titleWidth = helveticaBold.widthOfTextAtSize(title, titleFontSize);

  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT / 2 + 50,
    size: titleFontSize,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  // Add subtitle
  const subtitleFontSize = 12;
  const subtitle = isError
    ? '(Error loading PDF - document may be corrupted)'
    : '(Physical document attached separately)';
  const subtitleWidth = helvetica.widthOfTextAtSize(subtitle, subtitleFontSize);

  page.drawText(subtitle, {
    x: (PAGE_WIDTH - subtitleWidth) / 2,
    y: PAGE_HEIGHT / 2 - 20,
    size: subtitleFontSize,
    font: helvetica,
    color: isError ? rgb(0.7, 0.2, 0.2) : rgb(0.4, 0.4, 0.4),
  });

  // Add error details if provided (wrapped to fit page width)
  if (errorDetails) {
    const detailFontSize = 9;
    const maxWidth = PAGE_WIDTH - 2 * MARGIN;
    const lineHeight = 12;

    // Simple word wrapping for error message
    const words = errorDetails.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = helvetica.widthOfTextAtSize(testLine, detailFontSize);

      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }

    // Draw error details (max 4 lines to avoid overflow)
    let y = PAGE_HEIGHT / 2 - 50;
    for (const line of lines.slice(0, 4)) {
      const lineWidth = helvetica.widthOfTextAtSize(line, detailFontSize);
      page.drawText(line, {
        x: (PAGE_WIDTH - lineWidth) / 2,
        y,
        size: detailFontSize,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= lineHeight;
    }

    if (lines.length > 4) {
      const truncated = '...';
      const truncWidth = helvetica.widthOfTextAtSize(truncated, detailFontSize);
      page.drawText(truncated, {
        x: (PAGE_WIDTH - truncWidth) / 2,
        y,
        size: detailFontSize,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5),
      });
    }
  }

  // Add enclosure label at bottom right
  addEnclosureLabel(page, enclosure.number, helveticaBold);

  // Add classification marking at bottom
  if (classification?.marking) {
    addClassificationMarking(page, classification.marking, helveticaBold, 'bottom');
  }
}

/**
 * Adds a cover page for an enclosure with title and optional description
 */
function addCoverPage(
  mainPdf: PDFDocument,
  enclosure: EnclosureData,
  helveticaBold: Awaited<ReturnType<typeof mainPdf.embedFont>>,
  helvetica: Awaited<ReturnType<typeof mainPdf.embedFont>>,
  classification?: ClassificationInfo
): void {
  const page = mainPdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Record cover page as the hyperlink target for this enclosure
  recordEnclosurePage(enclosure.number, mainPdf.getPageCount() - 1);

  // Add classification marking at top
  if (classification?.marking) {
    addClassificationMarking(page, classification.marking, helveticaBold, 'top');
  }

  // Add title in center (slightly higher to leave room for description)
  const titleFontSize = 18;
  const title = enclosure.title;
  const titleWidth = helveticaBold.widthOfTextAtSize(title, titleFontSize);

  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT / 2 + 80,
    size: titleFontSize,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  // Add description if provided
  if (enclosure.coverPageDescription) {
    const descFontSize = 12;
    const lineHeight = 16;
    const maxWidth = PAGE_WIDTH - 2 * MARGIN;

    // Simple word wrapping
    const words = enclosure.coverPageDescription.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = helvetica.widthOfTextAtSize(testLine, descFontSize);

      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }

    // Draw each line centered
    let y = PAGE_HEIGHT / 2 + 20;
    for (const line of lines) {
      const lineWidth = helvetica.widthOfTextAtSize(line, descFontSize);
      page.drawText(line, {
        x: (PAGE_WIDTH - lineWidth) / 2,
        y,
        size: descFontSize,
        font: helvetica,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= lineHeight;
    }
  }

  // Add enclosure label at bottom right
  addEnclosureLabel(page, enclosure.number, helveticaBold);

  // Add classification marking at bottom
  if (classification?.marking) {
    addClassificationMarking(page, classification.marking, helveticaBold, 'bottom');
  }
}

/**
 * Adds enclosure label at bottom right of page
 */
function addEnclosureLabel(
  page: PDFPage,
  enclosureNumber: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>
): void {
  const labelText = `Enclosure (${enclosureNumber})`;
  const fontSize = 10;
  const textWidth = font.widthOfTextAtSize(labelText, fontSize);

  page.drawText(labelText, {
    x: PAGE_WIDTH - MARGIN - textWidth, // Right-aligned with 1 inch margin
    y: MARGIN - 18, // Below the 1 inch margin (0.25 inch from bottom margin)
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });
}

/**
 * Adds page number at bottom center of page
 */
function addPageNumber(
  page: PDFPage,
  pageNum: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>
): void {
  const pageNumText = `${pageNum}`;
  const fontSize = 10;
  const textWidth = font.widthOfTextAtSize(pageNumText, fontSize);

  page.drawText(pageNumText, {
    x: (PAGE_WIDTH - textWidth) / 2,
    y: 36, // 0.5 inch from bottom
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });
}

/**
 * Adds classification marking at top or bottom center of page
 */
function addClassificationMarking(
  page: PDFPage,
  marking: string,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  position: 'top' | 'bottom'
): void {
  const fontSize = 12;
  const textWidth = font.widthOfTextAtSize(marking, fontSize);

  const y = position === 'top'
    ? PAGE_HEIGHT - 24  // 1/3 inch from top
    : 18;               // 1/4 inch from bottom

  page.drawText(marking, {
    x: (PAGE_WIDTH - textWidth) / 2,
    y,
    size: fontSize,
    font,
    color: rgb(0, 0, 0), // Always black
  });
}

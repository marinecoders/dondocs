import { PDFDocument, rgb, StandardFonts, PDFPage, PDFName, PDFArray, PDFNumber, PDFRef } from 'pdf-lib';

export interface EnclosureData {
  number: number;
  title: string;
  data?: ArrayBuffer; // undefined = text-only enclosure (no PDF)
  pageStyle?: 'border' | 'fullpage' | 'fit';
  hasCoverPage?: boolean; // If true, add a cover page before the enclosure content
  coverPageDescription?: string; // Optional description text for the cover page
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
 * Records that an enclosure starts on a given page index.
 */
function recordEnclosurePage(enclosureNumber: number, pageIndex: number): void {
  // Only record the first page for each enclosure
  if (!enclosurePageMap.has(enclosureNumber)) {
    enclosurePageMap.set(enclosureNumber, pageIndex);
    console.log(`[hyperlinks] Recorded enclosure ${enclosureNumber} -> page index ${pageIndex}`);
  }
}

/**
 * Finds enclosure reference text patterns in the PDF content streams.
 * Looks for patterns like "(1)", "(2)", "(3)" that appear as blue text in the enclosure list.
 *
 * Since SwiftLaTeX doesn't create PDF link annotations for \hyperlink commands,
 * we need to find where the text is rendered and create annotations ourselves.
 */
function findEnclosureReferences(pdfDoc: PDFDocument, mainPageCount: number): TextPosition[] {
  const positions: TextPosition[] = [];
  const pages = pdfDoc.getPages();

  console.log(`[hyperlinks] Scanning ${mainPageCount} main pages for enclosure references`);

  // Only scan the main document pages (before enclosures were added)
  for (let pageIdx = 0; pageIdx < Math.min(mainPageCount, pages.length); pageIdx++) {
    const page = pages[pageIdx];
    const contentStreamRefs = page.node.Contents();

    if (!contentStreamRefs) continue;

    // Get the raw content stream bytes
    let contentBytes: Uint8Array | undefined;

    if (contentStreamRefs instanceof PDFRef) {
      const stream = pdfDoc.context.lookup(contentStreamRefs);
      if (stream && 'getContents' in stream) {
        contentBytes = (stream as { getContents(): Uint8Array }).getContents();
      }
    } else if (contentStreamRefs instanceof PDFArray) {
      // Multiple content streams - concatenate them
      const allBytes: number[] = [];
      for (let i = 0; i < contentStreamRefs.size(); i++) {
        const ref = contentStreamRefs.get(i);
        if (ref instanceof PDFRef) {
          const stream = pdfDoc.context.lookup(ref);
          if (stream && 'getContents' in stream) {
            const bytes = (stream as { getContents(): Uint8Array }).getContents();
            allBytes.push(...bytes);
          }
        }
      }
      if (allBytes.length > 0) {
        contentBytes = new Uint8Array(allBytes);
      }
    }

    if (!contentBytes) continue;

    // Parse the content stream to find text positions
    const pagePositions = parseContentStreamForEnclosures(contentBytes, pageIdx);
    positions.push(...pagePositions);
  }

  console.log(`[hyperlinks] Found ${positions.length} enclosure references in content`);
  return positions;
}

/**
 * Parses a PDF content stream to find text that matches enclosure reference patterns.
 *
 * PDF text rendering uses operators like:
 * - BT: Begin text block
 * - ET: End text block
 * - Tm: Set text matrix (6 values, last 2 are x,y position)
 * - Td/TD: Move text position
 * - Tf: Set font and size
 * - Tj: Show text (string)
 * - TJ: Show text (array with spacing adjustments)
 * - ': Move to next line and show text
 * - ": Set spacing, move to next line, and show text
 */
function parseContentStreamForEnclosures(bytes: Uint8Array, pageIdx: number): TextPosition[] {
  const positions: TextPosition[] = [];
  const content = new TextDecoder('latin1').decode(bytes);

  console.log(`[hyperlinks] Parsing page ${pageIdx + 1}, content length: ${content.length}`);

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

  console.log(`[hyperlinks] Found ${colorRanges.length} color changes, ${colorRanges.filter(c => c.isBlue).length} blue`);

  // Find Tm (text matrix) operations to track positions
  // Format: a b c d e f Tm (e and f are x,y)
  const tmRegex = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/g;
  let tmMatch;
  const textMatrices: { x: number; y: number; pos: number }[] = [];

  while ((tmMatch = tmRegex.exec(content)) !== null) {
    textMatrices.push({
      x: parseFloat(tmMatch[5]),
      y: parseFloat(tmMatch[6]),
      pos: tmMatch.index
    });
  }

  console.log(`[hyperlinks] Found ${textMatrices.length} text matrix operations`);

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

  console.log(`[hyperlinks] Found ${allTextOps.length} text operations`);

  // Helper to check if a position is in a blue color range
  function isBlueAtPosition(pos: number): boolean {
    let currentBlue = false;
    for (const range of colorRanges) {
      if (range.startPos > pos) break;
      currentBlue = range.isBlue;
    }
    return currentBlue;
  }

  // Helper to find nearest Tm position
  function getNearestTm(pos: number): { x: number; y: number } {
    let result = { x: 0, y: 0 };
    for (const tm of textMatrices) {
      if (tm.pos > pos) break;
      result = { x: tm.x, y: tm.y };
    }
    return result;
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
    const tm = getNearestTm(textOp.pos);
    const fontSize = getNearestFontSize(textOp.pos);

    console.log(`[hyperlinks] Found blue digit ${encNum} at (${tm.x}, ${tm.y}), fontSize=${fontSize}`);

    foundEnclosures.add(encNum);
    positions.push({
      pageIndex: pageIdx,
      x: tm.x,
      y: tm.y,
      width: fontSize * 0.6,
      height: fontSize,
      text: String(encNum),
      enclosureNumber: encNum
    });
  }

  console.log(`[hyperlinks] Page ${pageIdx + 1}: found ${positions.length} enclosure references`);
  return positions;
}

/**
 * Creates link annotations at the specified text positions.
 * These annotations will link to the corresponding enclosure pages.
 */
function createLinkAnnotations(pdfDoc: PDFDocument, positions: TextPosition[]): void {
  if (positions.length === 0 || enclosurePageMap.size === 0) {
    console.log('[hyperlinks] No positions or enclosure pages to link');
    return;
  }

  const pages = pdfDoc.getPages();
  let createdCount = 0;

  for (const pos of positions) {
    const targetPageIndex = enclosurePageMap.get(pos.enclosureNumber);
    if (targetPageIndex === undefined) {
      console.log(`[hyperlinks] No target page for enclosure ${pos.enclosureNumber}`);
      continue;
    }

    if (pos.pageIndex >= pages.length || targetPageIndex >= pages.length) {
      console.log(`[hyperlinks] Page index out of bounds: source=${pos.pageIndex}, target=${targetPageIndex}`);
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
      // No highlighting (optional)
      H: PDFName.of('N')
    });

    // Get or create the Annots array for the page
    const linkRef = pdfDoc.context.register(linkAnnotation);
    let annots = sourcePage.node.lookup(PDFName.of('Annots'));

    if (annots instanceof PDFArray) {
      annots.push(linkRef);
    } else {
      // Create new Annots array
      const newAnnots = pdfDoc.context.obj([linkRef]);
      sourcePage.node.set(PDFName.of('Annots'), newAnnots);
    }

    createdCount++;
    console.log(`[hyperlinks] Created link for enclosure ${pos.enclosureNumber} at (${pos.x}, ${pos.y}) -> page ${targetPageIndex + 1}`);
  }

  console.log(`[hyperlinks] Created ${createdCount} link annotations`);
}

/**
 * Merges enclosure pages into the main document.
 * Handles both PDF enclosures and text-only placeholder pages.
 * Maintains correct enclosure ordering.
 */
export async function mergeEnclosures(
  mainPdfBytes: Uint8Array,
  enclosures: EnclosureData[],
  classification?: ClassificationInfo,
  includeHyperlinks = false
): Promise<Uint8Array> {
  console.log('[mergeEnclosures] Called with', enclosures.length, 'enclosures, hyperlinks:', includeHyperlinks);

  if (enclosures.length === 0) {
    return mainPdfBytes;
  }

  // Clear enclosure page map for fresh run
  enclosurePageMap.clear();

  // Load the main document
  const mainPdf = await PDFDocument.load(mainPdfBytes);
  const helveticaBold = await mainPdf.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await mainPdf.embedFont(StandardFonts.Helvetica);

  // Record the number of pages in the main document BEFORE adding enclosures
  const mainPageCount = mainPdf.getPageCount();
  console.log(`[mergeEnclosures] Main document has ${mainPageCount} pages before adding enclosures`);

  // Process each enclosure in order
  for (const enclosure of enclosures) {
    try {
      // Add optional cover/placeholder page before the enclosure content
      if (enclosure.hasCoverPage) {
        addCoverPage(mainPdf, enclosure, helveticaBold, helvetica, classification);
      }

      if (enclosure.data) {
        // PDF enclosure - load and add pages
        await addPdfEnclosure(mainPdf, enclosure, helveticaBold, helvetica, classification);
      }
      // Note: Text-only enclosures without hasCoverPage just appear in the enclosure list
      // No placeholder page is created unless explicitly requested via hasCoverPage
    } catch (err) {
      console.error(`Failed to add enclosure ${enclosure.number}:`, err);
      // Create an error placeholder page only if there was supposed to be PDF content
      if (enclosure.data) {
        addPlaceholderPage(mainPdf, enclosure, helveticaBold, helvetica, true, classification);
      }
    }
  }

  // Create hyperlink annotations if enabled
  if (includeHyperlinks && enclosurePageMap.size > 0) {
    console.log('[mergeEnclosures] Creating hyperlink annotations...');
    const positions = findEnclosureReferences(mainPdf, mainPageCount);
    createLinkAnnotations(mainPdf, positions);
  }

  // Clear for next use
  enclosurePageMap.clear();

  return mainPdf.save();
}

/**
 * Adds a PDF enclosure to the document with the specified page style
 */
async function addPdfEnclosure(
  mainPdf: PDFDocument,
  enclosure: EnclosureData,
  helveticaBold: Awaited<ReturnType<typeof mainPdf.embedFont>>,
  _helvetica: Awaited<ReturnType<typeof mainPdf.embedFont>>,
  classification?: ClassificationInfo
): Promise<void> {
  if (!enclosure.data) return;

  const enclosurePdf = await PDFDocument.load(enclosure.data);
  const pageCount = enclosurePdf.getPageCount();
  const style = enclosure.pageStyle || 'border';

  // Process each page
  for (let i = 0; i < pageCount; i++) {
    const srcPage = enclosurePdf.getPage(i);
    const { width: srcWidth, height: srcHeight } = srcPage.getSize();

    // Create a new page in the main document
    const page = mainPdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    // Record first page for hyperlink navigation
    // (Skip if there's a cover page - the cover page is the target)
    if (i === 0 && !enclosure.hasCoverPage) {
      recordEnclosurePage(enclosure.number, mainPdf.getPageCount() - 1);
    }

    // Add classification marking at top (before content)
    if (classification?.marking) {
      addClassificationMarking(page, classification.marking, helveticaBold, 'top');
    }

    // Embed the source page
    const embeddedPage = await mainPdf.embedPage(srcPage);

    // Calculate scaling and positioning based on page style
    const { scale, x, y, drawBorder } = calculatePageLayout(
      srcWidth,
      srcHeight,
      style
    );

    // Draw the embedded page with calculated position and scale
    page.drawPage(embeddedPage, {
      x,
      y,
      xScale: scale,
      yScale: scale,
    });

    // Draw border if required
    if (drawBorder) {
      const scaledWidth = srcWidth * scale;
      const scaledHeight = srcHeight * scale;
      page.drawRectangle({
        x: x,
        y: y,
        width: scaledWidth,
        height: scaledHeight,
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
  }
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
 * Adds a placeholder page for text-only enclosures
 */
function addPlaceholderPage(
  mainPdf: PDFDocument,
  enclosure: EnclosureData,
  helveticaBold: Awaited<ReturnType<typeof mainPdf.embedFont>>,
  helvetica: Awaited<ReturnType<typeof mainPdf.embedFont>>,
  isError = false,
  classification?: ClassificationInfo
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
    ? '(Error loading PDF - document attached separately)'
    : '(Physical document attached separately)';
  const subtitleWidth = helvetica.widthOfTextAtSize(subtitle, subtitleFontSize);

  page.drawText(subtitle, {
    x: (PAGE_WIDTH - subtitleWidth) / 2,
    y: PAGE_HEIGHT / 2 - 20,
    size: subtitleFontSize,
    font: helvetica,
    color: rgb(0.4, 0.4, 0.4),
  });

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

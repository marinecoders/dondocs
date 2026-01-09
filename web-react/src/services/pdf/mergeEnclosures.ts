import { PDFDocument, rgb, StandardFonts, PDFPage, PDFName, PDFDict, PDFArray, PDFNumber, PDFString, PDFRef } from 'pdf-lib';

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

// Track which page each enclosure starts on (enclosure number -> page ref)
const enclosurePageMap: Map<number, PDFPage> = new Map();

/**
 * Records that an enclosure starts on a given page.
 */
function recordEnclosurePage(enclosureNumber: number, page: PDFPage): void {
  // Only record the first page for each enclosure
  if (!enclosurePageMap.has(enclosureNumber)) {
    enclosurePageMap.set(enclosureNumber, page);
    console.log(`[hyperlinks] Recorded enclosure ${enclosureNumber} -> page`);
  }
}

/**
 * Updates all hyperlink annotations in the PDF to point to the correct enclosure pages.
 * This finds link annotations created by LaTeX's \hyperlink{enclosureN} and updates
 * their destinations to point to the actual enclosure pages we added.
 */
function updateHyperlinkDestinations(pdfDoc: PDFDocument): void {
  if (enclosurePageMap.size === 0) {
    console.log('[hyperlinks] No enclosure pages recorded');
    return;
  }

  console.log('[hyperlinks] Updating hyperlink destinations for', enclosurePageMap.size, 'enclosures');
  console.log('[hyperlinks] Looking for destinations:', Array.from(enclosurePageMap.keys()).map(n => `enclosure${n}`));

  const pages = pdfDoc.getPages();
  let updatedCount = 0;
  let linkCount = 0;

  // Iterate through all pages to find link annotations
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!annots || !(annots instanceof PDFArray)) continue;

    console.log(`[hyperlinks] Page ${pageIdx + 1} has ${annots.size()} annotations`);

    // Check each annotation
    for (let i = 0; i < annots.size(); i++) {
      const annotRef = annots.get(i);
      if (!(annotRef instanceof PDFRef)) continue;

      const annot = pdfDoc.context.lookup(annotRef);
      if (!(annot instanceof PDFDict)) continue;

      // Check if it's a link annotation
      const subtype = annot.get(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Link') continue;

      linkCount++;

      // Check for /A (action) with /GoTo and /D (destination name)
      const action = annot.get(PDFName.of('A'));
      if (action instanceof PDFDict) {
        const actionType = action.get(PDFName.of('S'));
        const dest = action.get(PDFName.of('D'));
        console.log(`[hyperlinks] Link annotation: action type=${actionType}, dest=${dest}, dest type=${dest?.constructor?.name}`);

        if (actionType && actionType.toString() === '/GoTo') {
          if (dest) {
            const destName = extractDestinationName(dest);
            console.log(`[hyperlinks] Extracted dest name: "${destName}"`);
            if (destName && destName.startsWith('enclosure')) {
              const encNum = parseInt(destName.replace('enclosure', ''), 10);
              const targetPage = enclosurePageMap.get(encNum);
              if (targetPage) {
                // Update the action to point directly to the page
                const newDest = pdfDoc.context.obj([
                  targetPage.ref,
                  PDFName.of('XYZ'),
                  PDFNumber.of(0),
                  PDFNumber.of(PAGE_HEIGHT),
                  PDFNumber.of(0),
                ]);
                action.set(PDFName.of('D'), newDest);
                updatedCount++;
                console.log(`[hyperlinks] Updated link to ${destName}`);
              } else {
                console.log(`[hyperlinks] No page recorded for enclosure ${encNum}`);
              }
            }
          }
        }
      } else {
        console.log(`[hyperlinks] Link annotation has no /A action, checking /Dest`);
      }

      // Also check for direct /Dest on the annotation
      const directDest = annot.get(PDFName.of('Dest'));
      if (directDest) {
        const destName = extractDestinationName(directDest);
        console.log(`[hyperlinks] Direct dest: "${destName}"`);
        if (destName && destName.startsWith('enclosure')) {
          const encNum = parseInt(destName.replace('enclosure', ''), 10);
          const targetPage = enclosurePageMap.get(encNum);
          if (targetPage) {
            // Update the destination to point directly to the page
            const newDest = pdfDoc.context.obj([
              targetPage.ref,
              PDFName.of('XYZ'),
              PDFNumber.of(0),
              PDFNumber.of(PAGE_HEIGHT),
              PDFNumber.of(0),
            ]);
            annot.set(PDFName.of('Dest'), newDest);
            updatedCount++;
            console.log(`[hyperlinks] Updated direct dest to ${destName}`);
          }
        }
      }
    }
  }

  console.log(`[hyperlinks] Found ${linkCount} link annotations, updated ${updatedCount}`);

  // Clear for next use
  enclosurePageMap.clear();
}

/**
 * Extracts the destination name from various PDF destination formats.
 */
function extractDestinationName(dest: unknown): string | null {
  if (dest instanceof PDFString) {
    return dest.decodeText();
  }
  if (dest instanceof PDFName) {
    return dest.decodeText();
  }
  if (typeof dest === 'object' && dest !== null && 'toString' in dest) {
    const str = dest.toString();
    // Handle formats like (enclosure1) or /enclosure1
    if (str.startsWith('(') && str.endsWith(')')) {
      return str.slice(1, -1);
    }
    if (str.startsWith('/')) {
      return str.slice(1);
    }
    return str;
  }
  return null;
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
  _includeHyperlinks = false
): Promise<Uint8Array> {
  console.log('[mergeEnclosures] Called with', enclosures.length, 'enclosures');

  if (enclosures.length === 0) {
    return mainPdfBytes;
  }

  // Load the main document
  const mainPdf = await PDFDocument.load(mainPdfBytes);
  const helveticaBold = await mainPdf.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await mainPdf.embedFont(StandardFonts.Helvetica);

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

  // Update hyperlink destinations to point to the enclosure pages we just added
  updateHyperlinkDestinations(mainPdf);

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
      recordEnclosurePage(enclosure.number, page);
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
  recordEnclosurePage(enclosure.number, page);

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
  recordEnclosurePage(enclosure.number, page);

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

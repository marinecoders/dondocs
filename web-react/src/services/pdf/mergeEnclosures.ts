import { PDFDocument, rgb, StandardFonts, PDFPage, PDFName, PDFDict, PDFNumber } from 'pdf-lib';

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

/**
 * Collects all named destinations to add during merging.
 * We batch them up and add them all at once at the end to avoid
 * issues with the PDF structure.
 */
const pendingDestinations: Map<string, PDFPage> = new Map();

/**
 * Queues a named destination to be added to the PDF.
 * Call finalizeNamedDestinations() after all pages are added.
 */
function addNamedDestination(
  _pdfDoc: PDFDocument,
  page: PDFPage,
  name: string
): void {
  pendingDestinations.set(name, page);
}

/**
 * Adds all queued named destinations to the PDF.
 * This should be called once after all enclosure pages are added.
 *
 * Named destinations allow \hyperlink{name} in LaTeX to jump to specific pages.
 * We use the /Dests dictionary in the catalog (simpler than name trees).
 */
function finalizeNamedDestinations(pdfDoc: PDFDocument): void {
  if (pendingDestinations.size === 0) {
    console.log('[hyperlinks] No destinations to add');
    return;
  }

  console.log('[hyperlinks] Adding', pendingDestinations.size, 'named destinations');

  const catalog = pdfDoc.catalog;

  // Use /Dests dictionary directly in catalog (simpler, more compatible)
  // This is the "old style" named destinations that hyperref understands
  let destsDict = catalog.lookup(PDFName.of('Dests'));
  if (!destsDict || !(destsDict instanceof PDFDict)) {
    console.log('[hyperlinks] Creating new /Dests dictionary');
    destsDict = pdfDoc.context.obj({});
    catalog.set(PDFName.of('Dests'), destsDict);
  } else {
    console.log('[hyperlinks] Found existing /Dests dictionary');
  }

  // Add each destination
  for (const [name, page] of pendingDestinations) {
    console.log('[hyperlinks] Adding destination:', name, '-> page ref:', page.ref.toString());

    // Create destination array: [pageRef /XYZ left top zoom]
    const destArray = pdfDoc.context.obj([
      page.ref,
      PDFName.of('XYZ'),
      PDFNumber.of(0),
      PDFNumber.of(PAGE_HEIGHT),
      PDFNumber.of(0), // 0 = inherit zoom
    ]);

    // Add to Dests dict with the name as key
    (destsDict as PDFDict).set(PDFName.of(name), destArray);
  }

  console.log('[hyperlinks] Destinations added successfully');

  // Clear for next use
  pendingDestinations.clear();
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
  console.log('[mergeEnclosures] Called with', enclosures.length, 'enclosures, includeHyperlinks:', includeHyperlinks);

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
        addCoverPage(mainPdf, enclosure, helveticaBold, helvetica, classification, includeHyperlinks);
      }

      if (enclosure.data) {
        // PDF enclosure - load and add pages
        await addPdfEnclosure(mainPdf, enclosure, helveticaBold, helvetica, classification, includeHyperlinks);
      }
      // Note: Text-only enclosures without hasCoverPage just appear in the enclosure list
      // No placeholder page is created unless explicitly requested via hasCoverPage
    } catch (err) {
      console.error(`Failed to add enclosure ${enclosure.number}:`, err);
      // Create an error placeholder page only if there was supposed to be PDF content
      if (enclosure.data) {
        addPlaceholderPage(mainPdf, enclosure, helveticaBold, helvetica, true, classification, includeHyperlinks);
      }
    }
  }

  // Finalize all named destinations for hyperlinks
  if (includeHyperlinks) {
    finalizeNamedDestinations(mainPdf);
  }

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
  classification?: ClassificationInfo,
  includeHyperlinks = false
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

    // Add named destination on first page for hyperlink navigation (only if hyperlinks enabled)
    // (Skip if there's a cover page - the cover page has the destination)
    if (includeHyperlinks && i === 0 && !enclosure.hasCoverPage) {
      addNamedDestination(mainPdf, page, `enclosure${enclosure.number}`);
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
  classification?: ClassificationInfo,
  includeHyperlinks = false
): void {
  const page = mainPdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Add named destination for hyperlink navigation (only if hyperlinks enabled)
  if (includeHyperlinks) {
    addNamedDestination(mainPdf, page, `enclosure${enclosure.number}`);
  }

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
  classification?: ClassificationInfo,
  includeHyperlinks = false
): void {
  const page = mainPdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Add named destination for hyperlink navigation (cover page is the target, only if hyperlinks enabled)
  if (includeHyperlinks) {
    addNamedDestination(mainPdf, page, `enclosure${enclosure.number}`);
  }

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

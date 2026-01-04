import { PDFDocument, rgb, StandardFonts, PDFPage } from 'pdf-lib';

export interface EnclosureData {
  number: number;
  title: string;
  data?: ArrayBuffer; // undefined = text-only enclosure (no PDF)
  pageStyle?: 'border' | 'fullpage' | 'fit';
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
 * Merges enclosure pages into the main document.
 * Handles both PDF enclosures and text-only placeholder pages.
 * Maintains correct enclosure ordering.
 */
export async function mergeEnclosures(
  mainPdfBytes: Uint8Array,
  enclosures: EnclosureData[],
  classification?: ClassificationInfo
): Promise<Uint8Array> {
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
      if (enclosure.data) {
        // PDF enclosure - load and add pages
        await addPdfEnclosure(mainPdf, enclosure, helveticaBold, classification);
      } else {
        // Text-only enclosure - create placeholder page
        addPlaceholderPage(mainPdf, enclosure, helveticaBold, helvetica, false, classification);
      }
    } catch (err) {
      console.error(`Failed to add enclosure ${enclosure.number}:`, err);
      // Create a placeholder page on error
      addPlaceholderPage(mainPdf, enclosure, helveticaBold, helvetica, true, classification);
    }
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

  // Determine color based on classification level
  let color = rgb(0, 0, 0); // Default black
  const upperMarking = marking.toUpperCase();
  if (upperMarking.includes('TOP SECRET')) {
    color = rgb(1, 0.5, 0); // Orange
  } else if (upperMarking.includes('SECRET')) {
    color = rgb(1, 0, 0); // Red
  } else if (upperMarking.includes('CONFIDENTIAL')) {
    color = rgb(0, 0, 1); // Blue
  } else if (upperMarking.includes('CUI')) {
    color = rgb(0.5, 0, 0.5); // Purple
  }

  const y = position === 'top'
    ? PAGE_HEIGHT - 24  // 1/3 inch from top
    : 18;               // 1/4 inch from bottom

  page.drawText(marking, {
    x: (PAGE_WIDTH - textWidth) / 2,
    y,
    size: fontSize,
    font,
    color,
  });
}

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// NAVMC 10274 - Administrative Action
// This generator loads the official form templates and overlays text

// Yellow highlight color for placeholders
const HIGHLIGHT_COLOR = rgb(1, 0.92, 0.23); // Bright yellow
const BLACK = rgb(0, 0, 0);

/**
 * Draw text with placeholder highlighting
 * Placeholders like {{NAME}} get a yellow background
 */
function drawTextWithHighlights(
  page: ReturnType<typeof PDFDocument.prototype.getPage>,
  text: string,
  x: number,
  y: number,
  font: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>,
  fontSize: number
) {
  // Split text into segments (plain text and placeholders)
  const segments: { text: string; isPlaceholder: boolean }[] = [];
  let lastIndex = 0;
  let match;

  // Create regex fresh each time to avoid lastIndex issues
  const regex = /\{\{([A-Za-z0-9_]+)\}\}/g;
  while ((match = regex.exec(text)) !== null) {
    // Add plain text before placeholder
    if (match.index > lastIndex) {
      segments.push({ text: text.substring(lastIndex, match.index), isPlaceholder: false });
    }
    // Add placeholder
    segments.push({ text: match[0], isPlaceholder: true });
    lastIndex = regex.lastIndex;
  }
  // Add remaining plain text
  if (lastIndex < text.length) {
    segments.push({ text: text.substring(lastIndex), isPlaceholder: false });
  }

  // Draw each segment
  let currentX = x;
  for (const segment of segments) {
    const width = font.widthOfTextAtSize(segment.text, fontSize);

    if (segment.isPlaceholder) {
      // Draw yellow background rectangle
      page.drawRectangle({
        x: currentX - 1,
        y: y - 3,
        width: width + 2,
        height: fontSize + 4,
        color: HIGHLIGHT_COLOR,
      });
    }

    // Draw the text
    page.drawText(segment.text, {
      x: currentX,
      y,
      size: fontSize,
      font,
      color: BLACK,
    });

    currentX += width;
  }
}

/**
 * Draw text centered within a box with placeholder highlighting
 */
function drawTextCentered(
  page: ReturnType<typeof PDFDocument.prototype.getPage>,
  text: string,
  boxLeft: number,
  boxWidth: number,
  y: number,
  font: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>,
  fontSize: number
) {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const centeredX = boxLeft + (boxWidth - textWidth) / 2;
  drawTextWithHighlights(page, text, centeredX, y, font, fontSize);
}

export interface Navmc10274Data {
  // Field 1: Action Number
  actionNo: string;
  // Field 2: SSIC/File Number
  ssicFileNo: string;
  // Field 3: Date
  date: string;
  // Field 4: From (Grade, Name, EDIPI, MOS or CO, Pers. O., etc.)
  from: string;
  // Field 5: Organization and Station
  orgStation: string;
  // Field 6: Via (As required)
  via: string;
  // Field 7: To
  to: string;
  // Field 8: Nature of Action/Subject
  natureOfAction: string;
  // Field 9: Copy To (As required)
  copyTo: string;
  // Field 10: Reference or Authority (if applicable)
  references: string;
  // Field 11: Enclosures (if any)
  enclosures: string;
  // Field 12: Supplemental Information
  supplementalInfo: string;
  // Field 13: Proposed/Recommended Action
  proposedAction: string;
}

import { calculateTextPosition, type BoxBoundary } from './extractFormFields';

// =============================================================================
// SMART BOX POSITIONING SYSTEM
// =============================================================================
// Define box boundaries (measured from bottom-left of page in points)
// Text positions are calculated automatically with consistent padding
//
// To add a new form:
// 1. If the PDF has form fields: use extractFormFieldBoundaries() to auto-generate
// 2. If no form fields: measure boxes manually or add form fields to the template
// =============================================================================

// Consistent padding from box edges (in points)
const BOX_PADDING = { left: 3, top: 3 };
const FONT_SIZE = 10;

// Box boundaries: { left, top, width, height }
// Defined using tools/box-editor.html - visual PDF box editor
const PAGE2_BOXES: Record<string, BoxBoundary> = {
  actionNo:        { name: 'actionNo', left: 406, top: 728, width: 79, height: 18 },  // 1
  ssicFileNo:      { name: 'ssicFileNo', left: 487, top: 728, width: 97, height: 18 },  // 2
  date:            { name: 'date', left: 406, top: 701, width: 178, height: 16 },  // 3 - centered
  from:            { name: 'from', left: 29, top: 674, width: 276, height: 25 },  // 4
  orgStation:      { name: 'orgStation', left: 309, top: 674, width: 274, height: 61 },  // 5
  via:             { name: 'via', left: 29, top: 638, width: 276, height: 25 },  // 6
  to:              { name: 'to', left: 65, top: 601, width: 265, height: 77 },  // 7
  natureOfAction:  { name: 'natureOfAction', left: 353, top: 602, width: 230, height: 42 },  // 8
  copyTo:          { name: 'copyTo', left: 353, top: 547, width: 230, height: 32 },  // 9
  references:      { name: 'references', left: 30, top: 500, width: 275, height: 75 },  // 10
  enclosures:      { name: 'enclosures', left: 309, top: 500, width: 274, height: 75 },  // 11
  supplementalInfo:{ name: 'supplementalInfo', left: 30, top: 410, width: 553, height: 355 },  // 12
};

// Calculate text position from box boundaries using shared utility
function getFieldPosition(boxName: keyof typeof PAGE2_BOXES) {
  return calculateTextPosition(PAGE2_BOXES[boxName], BOX_PADDING, FONT_SIZE);
}

// Pre-calculated field positions (maxWidth = box width - padding*2)
const PAGE2_FIELDS = {
  actionNo: getFieldPosition('actionNo'),
  ssicFileNo: getFieldPosition('ssicFileNo'),
  date: {
    ...getFieldPosition('date'),
    boxLeft: PAGE2_BOXES.date.left,
    boxWidth: PAGE2_BOXES.date.width
  },  // centered
  from: { ...getFieldPosition('from'), maxWidth: 269 },           // 275 - 6
  orgStation: { ...getFieldPosition('orgStation'), maxWidth: 264, lineHeight: 12 }, // 270 - 6
  via: { ...getFieldPosition('via'), maxWidth: 269 },             // 275 - 6
  to: { ...getFieldPosition('to'), maxWidth: 259, lineHeight: 12 },  // 265 - 6
  natureOfAction: { ...getFieldPosition('natureOfAction'), maxWidth: 219, lineHeight: 12 }, // 225 - 6
  copyTo: { ...getFieldPosition('copyTo'), maxWidth: 219 },       // 225 - 6
  references: { ...getFieldPosition('references'), maxWidth: 269, lineHeight: 12 },  // 275 - 6
  enclosures: { ...getFieldPosition('enclosures'), maxWidth: 264, lineHeight: 12 },  // 270 - 6

  // Field 12: Supplemental Information (large text area)
  supplementalInfo: {
    ...getFieldPosition('supplementalInfo'),
    maxWidth: 544,       // 550 - 6
    lineHeight: 12,
    maxLines: 29,        // ~355 height / 12 lineHeight
  },
};

// Page 3 box boundaries (continuation page)
// Defined using tools/box-editor.html
const PAGE3_BOXES: Record<string, BoxBoundary> = {
  supplementalInfo: { name: 'supplementalInfo', left: 31, top: 725, width: 550, height: 686 },  // 1
};

function getPage3FieldPosition(boxName: keyof typeof PAGE3_BOXES) {
  return calculateTextPosition(PAGE3_BOXES[boxName], BOX_PADDING, FONT_SIZE);
}

// Field coordinates for Page 3 (continuation)
const PAGE3_FIELDS = {
  supplementalInfo: {
    ...getPage3FieldPosition('supplementalInfo'),
    maxWidth: 544,       // 550 - 6
    lineHeight: 12,
    maxLines: 57,        // ~686 height / 12 lineHeight
  },
};

/**
 * Wrap text to fit within a max width
 */
function wrapText(
  text: string,
  maxWidth: number,
  font: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>,
  fontSize: number
): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    const words = paragraph.split(' ');
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);

      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * Draw multi-line text on a page with placeholder highlighting
 */
function drawMultilineText(
  page: ReturnType<typeof PDFDocument.prototype.getPage>,
  lines: string[],
  x: number,
  startY: number,
  lineHeight: number,
  font: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>,
  fontSize: number,
  maxLines?: number
): { linesDrawn: number; remainingLines: string[] } {
  const linesToDraw = maxLines ? lines.slice(0, maxLines) : lines;
  let y = startY;

  for (const line of linesToDraw) {
    drawTextWithHighlights(page, line, x, y, font, fontSize);
    y -= lineHeight;
  }

  return {
    linesDrawn: linesToDraw.length,
    remainingLines: maxLines ? lines.slice(maxLines) : [],
  };
}

export interface Navmc10274Options {
  includeCoverPage?: boolean;  // Include Privacy Act cover page (default: false)
}

/**
 * Generate a filled NAVMC 10274 form
 * @param data - Form data to fill in
 * @param page1Bytes - Template page 1 (Privacy Act) - only included if options.includeCoverPage is true
 * @param page2Bytes - Template page 2 (Main form)
 * @param page3Bytes - Template page 3 (Continuation) - only if content overflows
 * @param options - Generation options
 */
export async function generateNavmc10274Pdf(
  data: Navmc10274Data,
  page1Bytes: ArrayBuffer | Uint8Array,
  page2Bytes: ArrayBuffer | Uint8Array,
  page3Bytes: ArrayBuffer | Uint8Array,
  options: Navmc10274Options = {}
): Promise<Uint8Array> {
  const { includeCoverPage = false } = options;

  // Create a new document
  const pdfDoc = await PDFDocument.create();

  // Optionally include page 1 (Privacy Act cover page)
  if (includeCoverPage) {
    const pdfPage1 = await PDFDocument.load(page1Bytes);
    const [copiedPage1] = await pdfDoc.copyPages(pdfPage1, [0]);
    pdfDoc.addPage(copiedPage1);
  }

  // Load and add page 2 (main form)
  const pdfPage2 = await PDFDocument.load(page2Bytes);
  const [copiedPage2] = await pdfDoc.copyPages(pdfPage2, [0]);
  pdfDoc.addPage(copiedPage2);

  // Get reference to page 2 (index depends on whether cover page is included)
  const page2Index = includeCoverPage ? 1 : 0;
  const page2 = pdfDoc.getPage(page2Index);

  // Embed font - Use Times Roman to match official government forms
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  // Track if we need page 3 for overflow
  let needsPage3 = false;
  let remainingSupplementalLines: string[] = [];

  // Fill Page 2 fields (with placeholder highlighting)

  // Field 1: Action No
  if (data.actionNo) {
    drawTextWithHighlights(page2, data.actionNo, PAGE2_FIELDS.actionNo.x, PAGE2_FIELDS.actionNo.y, font, FONT_SIZE);
  }

  // Field 2: SSIC/File No
  if (data.ssicFileNo) {
    drawTextWithHighlights(page2, data.ssicFileNo, PAGE2_FIELDS.ssicFileNo.x, PAGE2_FIELDS.ssicFileNo.y, font, FONT_SIZE);
  }

  // Field 3: Date (centered)
  if (data.date) {
    drawTextCentered(page2, data.date, PAGE2_FIELDS.date.boxLeft, PAGE2_FIELDS.date.boxWidth, PAGE2_FIELDS.date.y, font, FONT_SIZE);
  }

  // Field 4: From
  if (data.from) {
    const lines = wrapText(data.from, PAGE2_FIELDS.from.maxWidth, font, FONT_SIZE);
    drawMultilineText(page2, lines, PAGE2_FIELDS.from.x, PAGE2_FIELDS.from.y, 12, font, FONT_SIZE);
  }

  // Field 5: Organization and Station
  if (data.orgStation) {
    const lines = wrapText(data.orgStation, PAGE2_FIELDS.orgStation.maxWidth, font, FONT_SIZE);
    drawMultilineText(page2, lines, PAGE2_FIELDS.orgStation.x, PAGE2_FIELDS.orgStation.y, 12, font, FONT_SIZE);
  }

  // Field 6: Via
  if (data.via) {
    const lines = wrapText(data.via, PAGE2_FIELDS.via.maxWidth, font, FONT_SIZE);
    drawMultilineText(page2, lines, PAGE2_FIELDS.via.x, PAGE2_FIELDS.via.y, 12, font, FONT_SIZE);
  }

  // Field 7: To
  if (data.to) {
    const lines = wrapText(data.to, PAGE2_FIELDS.to.maxWidth, font, FONT_SIZE);
    drawMultilineText(page2, lines, PAGE2_FIELDS.to.x, PAGE2_FIELDS.to.y, 12, font, FONT_SIZE);
  }

  // Field 8: Nature of Action/Subject
  if (data.natureOfAction) {
    const lines = wrapText(data.natureOfAction, PAGE2_FIELDS.natureOfAction.maxWidth, font, FONT_SIZE);
    drawMultilineText(page2, lines, PAGE2_FIELDS.natureOfAction.x, PAGE2_FIELDS.natureOfAction.y, 12, font, FONT_SIZE);
  }

  // Field 9: Copy To
  if (data.copyTo) {
    const lines = wrapText(data.copyTo, PAGE2_FIELDS.copyTo.maxWidth, font, FONT_SIZE);
    drawMultilineText(page2, lines, PAGE2_FIELDS.copyTo.x, PAGE2_FIELDS.copyTo.y, 12, font, FONT_SIZE);
  }

  // Field 10: References
  if (data.references) {
    const lines = wrapText(data.references, PAGE2_FIELDS.references.maxWidth, font, FONT_SIZE);
    drawMultilineText(page2, lines, PAGE2_FIELDS.references.x, PAGE2_FIELDS.references.y, PAGE2_FIELDS.references.lineHeight, font, FONT_SIZE);
  }

  // Field 11: Enclosures
  if (data.enclosures) {
    const lines = wrapText(data.enclosures, PAGE2_FIELDS.enclosures.maxWidth, font, FONT_SIZE);
    drawMultilineText(page2, lines, PAGE2_FIELDS.enclosures.x, PAGE2_FIELDS.enclosures.y, PAGE2_FIELDS.enclosures.lineHeight, font, FONT_SIZE);
  }

  // Field 12: Supplemental Information (may span pages)
  if (data.supplementalInfo) {
    const allLines = wrapText(data.supplementalInfo, PAGE2_FIELDS.supplementalInfo.maxWidth, font, FONT_SIZE);

    // Draw on page 2
    const { remainingLines } = drawMultilineText(
      page2,
      allLines,
      PAGE2_FIELDS.supplementalInfo.x,
      PAGE2_FIELDS.supplementalInfo.y,
      PAGE2_FIELDS.supplementalInfo.lineHeight,
      font,
      FONT_SIZE,
      PAGE2_FIELDS.supplementalInfo.maxLines
    );

    // Track if we need page 3
    if (remainingLines.length > 0) {
      needsPage3 = true;
      remainingSupplementalLines = remainingLines;
    }
  }

  // Only add page 3 if content overflows
  if (needsPage3) {
    const pdfPage3 = await PDFDocument.load(page3Bytes);
    const [copiedPage3] = await pdfDoc.copyPages(pdfPage3, [0]);
    pdfDoc.addPage(copiedPage3);

    // Page 3 index depends on whether cover page is included
    const page3Index = includeCoverPage ? 2 : 1;
    const page3 = pdfDoc.getPage(page3Index);

    // Draw remaining supplemental info on page 3
    drawMultilineText(
      page3,
      remainingSupplementalLines,
      PAGE3_FIELDS.supplementalInfo.x,
      PAGE3_FIELDS.supplementalInfo.y,
      PAGE3_FIELDS.supplementalInfo.lineHeight,
      font,
      FONT_SIZE,
      PAGE3_FIELDS.supplementalInfo.maxLines
    );
  }

  return pdfDoc.save();
}

/**
 * Load the NAVMC 10274 template pages from the public folder
 */
export async function loadNavmc10274Templates(): Promise<{
  page1: ArrayBuffer;
  page2: ArrayBuffer;
  page3: ArrayBuffer;
}> {
  const baseUrl = '/templates/NAVMC10274 - Administrative Action';
  const [page1, page2, page3] = await Promise.all([
    fetch(`${baseUrl}/page1.pdf`).then(r => r.arrayBuffer()),
    fetch(`${baseUrl}/page2.pdf`).then(r => r.arrayBuffer()),
    fetch(`${baseUrl}/page3.pdf`).then(r => r.arrayBuffer()),
  ]);

  return { page1, page2, page3 };
}

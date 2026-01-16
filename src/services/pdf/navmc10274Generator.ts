import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// NAVMC 10274 - Administrative Action
// This generator loads the official form templates and overlays text

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

// Field coordinates for Page 2 (measured from bottom-left in points)
// Letter size: 612 x 792 points
const PAGE2_FIELDS = {
  // Row 1: Action No, SSIC/File No
  actionNo: { x: 433, y: 714 },
  ssicFileNo: { x: 521, y: 714 },

  // Row 2: Date
  date: { x: 457, y: 698 },

  // Field 4: From
  from: { x: 32, y: 660, maxWidth: 280 },

  // Field 5: Organization and Station
  orgStation: { x: 320, y: 660, maxWidth: 265 },

  // Field 6: Via
  via: { x: 32, y: 615, maxWidth: 550 },

  // Field 7: To (has a bracket structure)
  to: { x: 70, y: 569, maxWidth: 210 },

  // Field 8: Nature of Action/Subject
  natureOfAction: { x: 368, y: 582, maxWidth: 217 },

  // Field 9: Copy To
  copyTo: { x: 344, y: 551, maxWidth: 241 },

  // Field 10: Reference or Authority
  references: { x: 32, y: 493, maxWidth: 265, lineHeight: 12 },

  // Field 11: Enclosures
  enclosures: { x: 320, y: 445, maxWidth: 265, lineHeight: 12 },

  // Field 12: Supplemental Information (large text area)
  supplementalInfo: {
    x: 32,
    y: 391,
    maxWidth: 560,
    lineHeight: 12,
    maxLines: 27, // Lines that fit on page 2
  },
};

// Field coordinates for Page 3 (continuation)
const PAGE3_FIELDS = {
  supplementalInfo: {
    x: 32,
    y: 699,
    maxWidth: 560,
    lineHeight: 12,
    maxLines: 49, // More lines available on page 3
  },
};

const FONT_SIZE = 10;

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
 * Draw multi-line text on a page
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
  const BLACK = rgb(0, 0, 0);
  const linesToDraw = maxLines ? lines.slice(0, maxLines) : lines;
  let y = startY;

  for (const line of linesToDraw) {
    page.drawText(line, {
      x,
      y,
      size: fontSize,
      font,
      color: BLACK,
    });
    y -= lineHeight;
  }

  return {
    linesDrawn: linesToDraw.length,
    remainingLines: maxLines ? lines.slice(maxLines) : [],
  };
}

/**
 * Generate a filled NAVMC 10274 form
 * @param data - Form data to fill in
 * @param page1Bytes - Template page 1 (Privacy Act)
 * @param page2Bytes - Template page 2 (Main form)
 * @param page3Bytes - Template page 3 (Continuation)
 */
export async function generateNavmc10274Pdf(
  data: Navmc10274Data,
  page1Bytes: ArrayBuffer | Uint8Array,
  page2Bytes: ArrayBuffer | Uint8Array,
  page3Bytes: ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
  // Load all three template pages
  const [pdfPage1, pdfPage2, pdfPage3] = await Promise.all([
    PDFDocument.load(page1Bytes),
    PDFDocument.load(page2Bytes),
    PDFDocument.load(page3Bytes),
  ]);

  // Create a new document and copy all pages
  const pdfDoc = await PDFDocument.create();
  
  const [copiedPage1] = await pdfDoc.copyPages(pdfPage1, [0]);
  const [copiedPage2] = await pdfDoc.copyPages(pdfPage2, [0]);
  const [copiedPage3] = await pdfDoc.copyPages(pdfPage3, [0]);
  
  pdfDoc.addPage(copiedPage1);
  pdfDoc.addPage(copiedPage2);
  pdfDoc.addPage(copiedPage3);

  // Get references to the pages
  const page2 = pdfDoc.getPage(1); // Main form
  const page3 = pdfDoc.getPage(2); // Continuation

  // Embed font
  const font = await pdfDoc.embedFont(StandardFonts.Courier);
  const BLACK = rgb(0, 0, 0);

  // Fill Page 2 fields
  
  // Field 1: Action No
  if (data.actionNo) {
    page2.drawText(data.actionNo, {
      x: PAGE2_FIELDS.actionNo.x,
      y: PAGE2_FIELDS.actionNo.y,
      size: FONT_SIZE,
      font,
      color: BLACK,
    });
  }

  // Field 2: SSIC/File No
  if (data.ssicFileNo) {
    page2.drawText(data.ssicFileNo, {
      x: PAGE2_FIELDS.ssicFileNo.x,
      y: PAGE2_FIELDS.ssicFileNo.y,
      size: FONT_SIZE,
      font,
      color: BLACK,
    });
  }

  // Field 3: Date
  if (data.date) {
    page2.drawText(data.date, {
      x: PAGE2_FIELDS.date.x,
      y: PAGE2_FIELDS.date.y,
      size: FONT_SIZE,
      font,
      color: BLACK,
    });
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

    // Continue on page 3 if needed
    if (remainingLines.length > 0) {
      drawMultilineText(
        page3,
        remainingLines,
        PAGE3_FIELDS.supplementalInfo.x,
        PAGE3_FIELDS.supplementalInfo.y,
        PAGE3_FIELDS.supplementalInfo.lineHeight,
        font,
        FONT_SIZE,
        PAGE3_FIELDS.supplementalInfo.maxLines
      );
    }
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
  const [page1, page2, page3] = await Promise.all([
    fetch('/templates/NAVMC10274_page1.pdf').then(r => r.arrayBuffer()),
    fetch('/templates/NAVMC10274_page2.pdf').then(r => r.arrayBuffer()),
    fetch('/templates/NAVMC10274_page3.pdf').then(r => r.arrayBuffer()),
  ]);

  return { page1, page2, page3 };
}

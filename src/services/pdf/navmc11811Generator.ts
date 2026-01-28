import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// NAVMC 118(11) - Administrative Remarks (Page 11 / 6105)
// This generator loads the official form template and overlays text

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

export interface Navmc11811Data {
  // Marine identification
  lastName: string;
  firstName: string;
  middleName: string;
  edipi: string;

  // The main 6105 entry content (left column)
  remarksText: string;
  // Right column entry content
  remarksTextRight?: string;

  // Entry date (appears at end of entry)
  entryDate: string;

  // Box 11 - SRB (Service Record Book) page number, 5 chars max
  box11: string;

  // Signature info (for the counseling signature line)
  signatureName?: string;
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
// Defined using tools/box-editor.html
const PAGE_BOXES: Record<string, BoxBoundary> = {
  name:            { name: 'name', left: 35, top: 141, width: 395, height: 19 },  // 1 - left aligned
  edipi:           { name: 'edipi', left: 434, top: 141, width: 142, height: 19 },  // 2 - centered
  box11:           { name: 'box11', left: 336, top: 90, width: 51, height: 16 },  // 3 - centered
  remarks:         { name: 'remarks', left: 35, top: 558, width: 261, height: 400 },  // 4
  remarksRight:    { name: 'remarksRight', left: 315, top: 558, width: 261, height: 400 },  // 5
};

// Calculate text position from box boundaries using shared utility
function getFieldPosition(boxName: keyof typeof PAGE_BOXES) {
  return calculateTextPosition(PAGE_BOXES[boxName], BOX_PADDING, FONT_SIZE);
}

// Pre-calculated field positions
const FIELDS = {
  name: getFieldPosition('name'),
  // EDIPI and Box11 need box info for centering
  edipi: {
    ...getFieldPosition('edipi'),
    boxLeft: PAGE_BOXES.edipi.left,
    boxWidth: PAGE_BOXES.edipi.width
  },
  box11: {
    ...getFieldPosition('box11'),
    boxLeft: PAGE_BOXES.box11.left,
    boxWidth: PAGE_BOXES.box11.width
  },

  // Remarks boxes with additional properties
  remarks: {
    ...getFieldPosition('remarks'),
    lineHeight: 11,
    maxLines: 40,
  },
  remarksRight: {
    ...getFieldPosition('remarksRight'),
    lineHeight: 11,
    maxLines: 40,
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
 * Generate a filled NAVMC 118(11) form
 * @param data - Form data to fill in
 * @param templatePdfBytes - The template PDF as ArrayBuffer/Uint8Array (load from /templates/NAVMC118_template.pdf)
 */
export async function generateNavmc11811Pdf(
  data: Navmc11811Data,
  templatePdfBytes: ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
  // Load the template PDF
  const pdfDoc = await PDFDocument.load(templatePdfBytes);
  const page = pdfDoc.getPage(0);

  // Embed fonts - Use Times Roman to match official government forms
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const FONT_SIZE = 10;

  // Fill in NAME field (left-aligned, with placeholder highlighting)
  const fullName = [data.lastName, data.firstName, data.middleName]
    .filter(Boolean)
    .join(', ');

  if (fullName) {
    drawTextWithHighlights(page, fullName.toUpperCase(), FIELDS.name.x, FIELDS.name.y, font, FONT_SIZE);
  }

  // Fill in EDIPI field (centered, with placeholder highlighting)
  if (data.edipi) {
    drawTextCentered(page, data.edipi, FIELDS.edipi.boxLeft, FIELDS.edipi.boxWidth, FIELDS.edipi.y, font, FONT_SIZE);
  }

  // Fill in Box 11 field (centered, with placeholder highlighting)
  if (data.box11) {
    drawTextCentered(page, data.box11.toUpperCase(), FIELDS.box11.boxLeft, FIELDS.box11.boxWidth, FIELDS.box11.y, font, FONT_SIZE);
  }

  // Fill in left remarks area (with placeholder highlighting)
  if (data.remarksText) {
    const lines = wrapText(data.remarksText, FIELDS.remarks.maxWidth, font, FONT_SIZE);
    let y = FIELDS.remarks.y;

    for (let i = 0; i < Math.min(lines.length, FIELDS.remarks.maxLines); i++) {
      drawTextWithHighlights(page, lines[i], FIELDS.remarks.x, y, font, FONT_SIZE);
      y -= FIELDS.remarks.lineHeight;
    }

    // Add date at the end of the entry (2 lines below last text)
    if (data.entryDate) {
      y -= FIELDS.remarks.lineHeight; // Extra space
      drawTextWithHighlights(page, data.entryDate, FIELDS.remarks.x, y, font, FONT_SIZE);
    }
  }

  // Fill in right remarks area (continuation) (with placeholder highlighting)
  if (data.remarksTextRight) {
    const lines = wrapText(data.remarksTextRight, FIELDS.remarksRight.maxWidth, font, FONT_SIZE);
    let y = FIELDS.remarksRight.y;

    for (let i = 0; i < Math.min(lines.length, FIELDS.remarksRight.maxLines); i++) {
      drawTextWithHighlights(page, lines[i], FIELDS.remarksRight.x, y, font, FONT_SIZE);
      y -= FIELDS.remarksRight.lineHeight;
    }
  }

  return pdfDoc.save();
}

/**
 * Load the NAVMC 118(11) template from the public folder
 */
export async function loadNavmc11811Template(): Promise<ArrayBuffer> {
  const response = await fetch('/templates/NAVMC11811 - Administrative Remarks/page1.pdf');
  if (!response.ok) {
    throw new Error('Failed to load NAVMC 118(11) template');
  }
  return response.arrayBuffer();
}

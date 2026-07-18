import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { wrapTextForForm } from './textWrap';

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

  // Signature blocks appended to the end of the 6105 entry, in signing order.
  // A Page 11 counseling entry is authenticated by the counselor and the
  // counseled Marine (MCO 1610.7 / IRAM); the form's three pre-printed
  // "(Signature)" cells at the top are for standing entries (Art 137, SBP), not
  // this one, so these blocks close the entry text itself. Each block's optional
  // statement ("I have been counseled…") prints above its signing space; `style`
  // selects typed name / scanned image / empty CAC field, as on the AA form.
  signatureBlocks: FormSignatureBlock[];
}

import { calculateTextPosition, type BoxBoundary } from './extractFormFields';
import { addSignatureFieldToPage } from './signatureFieldCore';
import { base64ToUint8Array } from '@/lib/encoding';
import { isDigital, isImage } from '@/types/signature';
import type { FormSignatureBlock } from '@/types/signature';
import type { PDFDocument as PDFDocumentType, PDFImage, PDFPage } from 'pdf-lib';

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

// `wrapText` was a duplicate copy of the same helper in navmc10274Generator;
// both are now shared via `./textWrap.ts` (`wrapTextForForm`). The new
// implementation fixes issue #24 — wrapped sub-paragraphs preserve their
// SECNAV-style hanging indent on continuation lines.
const wrapText = wrapTextForForm;

// Signing-gap geometry (mirrors the AA form): a mark sits 8pt above the name
// baseline, up to 180pt wide and two blank lines tall.
const SIG_ABOVE = 8;
const SIG_FIELD_W = 180;
const SIG_FIELD_H = 20;

/** Decode a base64 (data-URL or raw) image to a pdf-lib image, or null. */
async function embedSignatureImage(
  pdfDoc: PDFDocumentType,
  dataUrl: string
): Promise<PDFImage | null> {
  try {
    const comma = dataUrl.indexOf(',');
    const header = comma >= 0 ? dataUrl.slice(0, comma) : '';
    const bytes = base64ToUint8Array(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    return /jpe?g/i.test(header) ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
  } catch {
    return null;
  }
}

/**
 * Draw the signature blocks that close a 6105 entry into a remarks column,
 * starting below `startY`. Each block prints its statement (if any), leaves two
 * blank signing lines, then the typed name — placing a CAC field or a scanned
 * image in the gap above the name per the block's style. Returns nothing; the
 * column is capped by its own height like the entry text above it.
 */
async function appendSignatureBlocks(
  pdfDoc: PDFDocumentType,
  page: PDFPage,
  font: Parameters<typeof drawTextWithHighlights>[4],
  fontSize: number,
  blocks: FormSignatureBlock[],
  col: { x: number; maxWidth: number; lineHeight: number },
  startY: number,
  seq: { n: number }
): Promise<void> {
  let y = startY;
  for (const block of blocks) {
    const name = (block.name ?? '').trim();
    const statement = (block.statement ?? '').trim();
    if (!name && !statement) continue;
    y -= col.lineHeight; // paragraph gap before the block
    if (statement) {
      for (const line of wrapText(statement, col.maxWidth, font, fontSize)) {
        drawTextWithHighlights(page, line, col.x, y, font, fontSize);
        y -= col.lineHeight;
      }
    }
    y -= 2 * col.lineHeight; // the two blank signing lines
    if (!name) continue;
    if (isDigital(block)) {
      const bottom = y + SIG_ABOVE;
      addSignatureFieldToPage(
        pdfDoc,
        page,
        [col.x, bottom, col.x + SIG_FIELD_W, bottom + SIG_FIELD_H],
        `Signature_${seq.n++}`
      );
    } else if (isImage(block) && block.image) {
      const img = await embedSignatureImage(pdfDoc, block.image);
      if (img) {
        const boxH = 2 * col.lineHeight;
        const scale = Math.min(SIG_FIELD_W / img.width, boxH / img.height);
        page.drawImage(img, {
          x: col.x,
          y: y + SIG_ABOVE,
          width: img.width * scale,
          height: img.height * scale,
        });
      }
    }
    drawTextWithHighlights(page, name, col.x, y, font, fontSize);
    y -= col.lineHeight;
  }
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
  let leftEndY = FIELDS.remarks.y;
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
      y -= FIELDS.remarks.lineHeight;
    }
    leftEndY = y;
  }

  // Fill in right remarks area (continuation) (with placeholder highlighting)
  let rightEndY = FIELDS.remarksRight.y;
  const hasRight = !!data.remarksTextRight;
  if (data.remarksTextRight) {
    const lines = wrapText(data.remarksTextRight, FIELDS.remarksRight.maxWidth, font, FONT_SIZE);
    let y = FIELDS.remarksRight.y;

    for (let i = 0; i < Math.min(lines.length, FIELDS.remarksRight.maxLines); i++) {
      drawTextWithHighlights(page, lines[i], FIELDS.remarksRight.x, y, font, FONT_SIZE);
      y -= FIELDS.remarksRight.lineHeight;
    }
    rightEndY = y;
  }

  // Close the entry with its signature blocks — in the column the entry ends in
  // (the right column when the entry spilled into it, else the left).
  const sigBlocks = data.signatureBlocks ?? [];
  if (sigBlocks.length > 0) {
    const col = hasRight ? FIELDS.remarksRight : FIELDS.remarks;
    const startY = hasRight ? rightEndY : leftEndY;
    await appendSignatureBlocks(pdfDoc, page, font, FONT_SIZE, sigBlocks, col, startY, { n: 1 });
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

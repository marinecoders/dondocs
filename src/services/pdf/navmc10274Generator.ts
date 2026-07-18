import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { wrapTextForForm } from './textWrap';

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
  // Proposed/Recommended Action — the printed form has no box for it (its
  // fields run 1-12), so it renders as a labeled closing paragraph inside
  // block 12. It used to be collected by the UI and silently dropped here.
  proposedAction: string;
  // Signature blocks at the end of block 12, in signing order. The form's
  // caption mandates the first ("type name of originator and sign 3 lines
  // below text"); counseling actions commonly add the counseled Marine's
  // acknowledgement and sometimes a witness — an optional statement renders as
  // a paragraph above each block's signing space.
  signatureBlocks?: Array<{ statement?: string; name?: string; style?: SignatureStyle; image?: string }>;
}

import { calculateTextPosition, type BoxBoundary } from './extractFormFields';
import { addSignatureFieldToPage } from './signatureFieldCore';
import { base64ToUint8Array } from '@/lib/encoding';
import type { SignatureStyle } from '@/types/signature';
import type { PDFImage, PDFPage } from 'pdf-lib';

// A digital signature field sits in the signing gap ABOVE the typed name: 8pt
// above the name's baseline (clearing its ascenders — a 2pt gap clipped them in
// testing) and 20pt tall, within the two blank lines the compose reserves.
const SIG_FIELD_ABOVE = 8;
const SIG_FIELD_HEIGHT = 20;
const SIG_FIELD_WIDTH = 180;

/** Rect for a signature field above a name drawn at (textX, block-start y minus
 *  nameLineInPage line-heights). */
function signatureFieldRect(
  textX: number,
  blockStartY: number,
  nameLineInPage: number,
  lineHeight: number
): [number, number, number, number] {
  const nameBaselineY = blockStartY - nameLineInPage * lineHeight;
  const bottom = nameBaselineY + SIG_FIELD_ABOVE;
  return [textX, bottom, textX + SIG_FIELD_WIDTH, bottom + SIG_FIELD_HEIGHT];
}

// A scanned signature fills the same signing gap as a digital field but can be
// taller — it uses the two blank signing lines above the name.
const SIG_IMAGE_MAX_WIDTH = SIG_FIELD_WIDTH;

/** Decode a base64 data URL to a pdf-lib image, or null if it can't be read
 *  (a bad upload must never abort the whole export). */
async function embedSignatureImage(
  pdfDoc: PDFDocument,
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

/** Draw a scanned signature into the signing gap above a name, scaled to fit
 *  the two blank lines and never wider than the field width; bottom-left
 *  anchored at the field rect so it sits where a CAC field would. */
function drawSignatureImage(
  page: PDFPage,
  image: PDFImage,
  textX: number,
  blockStartY: number,
  nameLineInPage: number,
  lineHeight: number
): void {
  const [x, y] = signatureFieldRect(textX, blockStartY, nameLineInPage, lineHeight);
  const boxHeight = 2 * lineHeight; // the two blank signing lines
  const scale = Math.min(SIG_IMAGE_MAX_WIDTH / image.width, boxHeight / image.height);
  page.drawImage(image, {
    x,
    y,
    width: image.width * scale,
    height: image.height * scale,
  });
}

/** A signature block's lines, pre-wrapped: optional statement paragraph, then
 *  the typed name. The block is atomic for pagination. */
export interface ComposedBlockTwelve {
  lines: string[];
  /** [start, end] line spans (inclusive) that pagination must not split — one
   *  per signature block: its statement, signing space, and name move as one.
   *  `nameLineIndex` is where the typed name landed (null for a statement-only
   *  block); `style`/`image` say what (if anything) goes in the signing gap. */
  groups: Array<{
    start: number;
    end: number;
    nameLineIndex: number | null;
    style: SignatureStyle;
    image?: string;
  }>;
}

/** Where a signature mark goes in the signing gap: which page, the name's line
 *  index within that page's block-12 stream (the mark sits above it), and what
 *  to draw there — a CAC field ('digital') or a scanned image ('image'). Typed
 *  blocks produce no placement. */
export interface SignatureFieldPlacement {
  page: 'main' | 'continuation';
  nameLineInPage: number;
  style: 'image' | 'digital';
  image?: string;
}

/**
 * Block 12's contents in order: the supplemental text, the proposed action as
 * a labeled closing paragraph, then the signature blocks in signing order.
 *
 * Each name sits on the THIRD line below whatever precedes it — the form's own
 * caption is the spec: "type name of originator and sign 3 lines below text".
 * The two blank lines above each name are that signer's signing space. (The
 * naval letter's fourth-line convention from Ch 7 ¶14 does not apply here; the
 * form overrides it.) A block's optional statement ("Acknowledged:", "I have
 * witnessed…") renders as a paragraph directly above its signing space, which
 * is how counseling actions carry the Marine's acknowledgement and a witness
 * below the originator. Exported for tests.
 */
export function composeBlockTwelveLines(parts: {
  supplementalInfo: string[];
  proposedAction: string[];
  signatureBlocks: Array<{ statement: string[]; name: string; style?: SignatureStyle; image?: string }>;
}): ComposedBlockTwelve {
  const lines: string[] = [...parts.supplementalInfo];
  if (parts.proposedAction.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(...parts.proposedAction);
  }
  const groups: ComposedBlockTwelve['groups'] = [];
  for (const block of parts.signatureBlocks) {
    const name = block.name.trim();
    if (!name && block.statement.length === 0) continue;
    let start: number;
    let nameLineIndex: number | null = null;
    if (block.statement.length > 0) {
      // The blank before the statement is paragraph separation (outside the
      // group); the statement, the signing gap, and the name are the block.
      if (lines.length > 0) lines.push('');
      start = lines.length;
      lines.push(...block.statement);
      if (name) {
        lines.push('', '');
        nameLineIndex = lines.length;
        lines.push(name);
      }
    } else {
      // No statement: the signing-gap blanks themselves open the block — they
      // ARE the signing space, so pagination must carry them with the name.
      start = lines.length;
      if (lines.length > 0) lines.push('', '');
      nameLineIndex = lines.length;
      lines.push(name);
    }
    groups.push({
      start,
      end: lines.length - 1,
      nameLineIndex,
      style: block.style ?? 'typed',
      image: block.image,
    });
  }
  return { lines, groups };
}

/**
 * Split block 12 across the form page and the continuation page without ever
 * splitting a signature block: a typed name orphaned at the top of page 3 with
 * its signing space left on page 2 cannot be signed. When the naive split
 * lands inside a group, the whole group moves to the continuation page.
 * Exported for tests.
 */
export function paginateBlockTwelve(
  composed: ComposedBlockTwelve,
  pageCapacity: number
): {
  pageLines: string[];
  continuationLines: string[];
  fieldPlacements: SignatureFieldPlacement[];
} {
  const { lines, groups } = composed;

  // Blocks with a name and a signing mark (a CAC field, or an image with data)
  // → a placement, computed once we know each name's final page and its line
  // index within that page's stream.
  const placementsFor = (split: number, continuationStart: number): SignatureFieldPlacement[] =>
    groups
      .filter(
        (g) =>
          g.nameLineIndex !== null &&
          (g.style === 'digital' || (g.style === 'image' && !!g.image))
      )
      .map((g) => {
        const idx = g.nameLineIndex as number;
        const mark = { style: g.style as 'image' | 'digital', image: g.image };
        return idx < split
          ? { page: 'main' as const, nameLineInPage: idx, ...mark }
          : { page: 'continuation' as const, nameLineInPage: idx - continuationStart, ...mark };
      });

  if (lines.length <= pageCapacity) {
    // Everything on the main page: split past the end, continuation empty.
    return { pageLines: lines, continuationLines: [], fieldPlacements: placementsFor(lines.length, 0) };
  }
  let split = pageCapacity;
  for (const group of groups) {
    // The split index is the first line of the continuation page; a group is
    // torn when it starts before the split and ends at or past it.
    if (group.start < split && group.end >= split) {
      split = group.start;
      break;
    }
  }
  // Blank separators at the boundary belong to neither page — but a blank
  // inside a group is a signing gap, not a separator, and must survive the
  // trim or the name loses its signing space.
  const inGroup = (index: number) => groups.some((g) => index >= g.start && index <= g.end);
  const pageLines = lines.slice(0, split);
  while (
    pageLines.length > 0 &&
    pageLines[pageLines.length - 1] === '' &&
    !inGroup(pageLines.length - 1)
  ) {
    pageLines.pop();
  }
  const continuationLines = lines.slice(split);
  let continuationStart = split;
  while (
    continuationLines.length > 0 &&
    continuationLines[0] === '' &&
    !inGroup(continuationStart)
  ) {
    continuationLines.shift();
    continuationStart++;
  }
  return { pageLines, continuationLines, fieldPlacements: placementsFor(split, continuationStart) };
}

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

// `wrapText` previously lived here as an inline helper; it's now extracted
// to `./textWrap.ts` (`wrapTextForForm`) and shared with navmc11811Generator.
// The new implementation also fixes issue #24 — continuation lines of a
// wrapped sub-paragraph now hang at the SECNAV-correct position instead of
// dropping back to the box's left margin.
const wrapText = wrapTextForForm;

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
  // Unique AcroForm field names across all signature fields in this document.
  let sigFieldSeq = 1;

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

  // Field 12: Supplemental Information (may span pages). One line stream
  // carries the text, the proposed action, and the signature blocks, so
  // pagination moves them to the continuation page together — and a signature
  // block moves whole (paginateBlockTwelve), never leaving a typed name
  // stranded without its signing space.
  const blockTwelve = composeBlockTwelveLines({
    supplementalInfo: data.supplementalInfo
      ? wrapText(data.supplementalInfo, PAGE2_FIELDS.supplementalInfo.maxWidth, font, FONT_SIZE)
      : [],
    proposedAction: data.proposedAction
      ? wrapText(
          `Proposed/recommended action: ${data.proposedAction}`,
          PAGE2_FIELDS.supplementalInfo.maxWidth,
          font,
          FONT_SIZE
        )
      : [],
    signatureBlocks: (data.signatureBlocks ?? []).map((block) => ({
      statement: block.statement?.trim()
        ? wrapText(block.statement.trim(), PAGE2_FIELDS.supplementalInfo.maxWidth, font, FONT_SIZE)
        : [],
      name: (block.name ?? '').trim(),
      style: block.style,
      image: block.image,
    })),
  });

  // Place a signing mark (CAC field or scanned image) in the gap above a name.
  const placeSignatureMark = async (
    page: PDFPage,
    p: SignatureFieldPlacement,
    box: { x: number; y: number; lineHeight: number }
  ): Promise<void> => {
    if (p.style === 'digital') {
      addSignatureFieldToPage(
        pdfDoc,
        page,
        signatureFieldRect(box.x, box.y, p.nameLineInPage, box.lineHeight),
        `Signature_${sigFieldSeq++}`
      );
    } else if (p.style === 'image' && p.image) {
      const img = await embedSignatureImage(pdfDoc, p.image);
      if (img) drawSignatureImage(page, img, box.x, box.y, p.nameLineInPage, box.lineHeight);
    }
  };
  // Continuation-page field placements are held until page 3 is created below.
  let continuationFieldPlacements: SignatureFieldPlacement[] = [];
  if (blockTwelve.lines.length > 0) {
    const { pageLines, continuationLines, fieldPlacements } = paginateBlockTwelve(
      blockTwelve,
      PAGE2_FIELDS.supplementalInfo.maxLines
    );
    drawMultilineText(
      page2,
      pageLines,
      PAGE2_FIELDS.supplementalInfo.x,
      PAGE2_FIELDS.supplementalInfo.y,
      PAGE2_FIELDS.supplementalInfo.lineHeight,
      font,
      FONT_SIZE,
      PAGE2_FIELDS.supplementalInfo.maxLines
    );
    // Signing marks whose name landed on the main page.
    for (const p of fieldPlacements.filter((f) => f.page === 'main')) {
      await placeSignatureMark(page2, p, PAGE2_FIELDS.supplementalInfo);
    }
    continuationFieldPlacements = fieldPlacements.filter((f) => f.page === 'continuation');
    if (continuationLines.length > 0) {
      needsPage3 = true;
      remainingSupplementalLines = continuationLines;
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
    // Signing marks for blocks that overflowed onto page 3.
    for (const p of continuationFieldPlacements) {
      await placeSignatureMark(page3, p, PAGE3_FIELDS.supplementalInfo);
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
  const baseUrl = '/templates/NAVMC10274 - Administrative Action';
  const [page1, page2, page3] = await Promise.all([
    fetch(`${baseUrl}/page1.pdf`).then(r => r.arrayBuffer()),
    fetch(`${baseUrl}/page2.pdf`).then(r => r.arrayBuffer()),
    fetch(`${baseUrl}/page3.pdf`).then(r => r.arrayBuffer()),
  ]);

  return { page1, page2, page3 };
}

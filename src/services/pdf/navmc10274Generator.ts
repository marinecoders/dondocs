import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import type { NavmcForm10274Data } from '@/stores/formStore';

// Page dimensions (Letter size)
const PAGE_WIDTH = 612; // 8.5 inches = 612pt
const PAGE_HEIGHT = 792; // 11 inches = 792pt

// Form positioning from HTML: margin-left: 6.0955pt, width: 558pt
const FORM_LEFT = 27; // Centered on page: (612 - 558) / 2
const FORM_WIDTH = 558;
const FORM_TOP = PAGE_HEIGHT - 45; // Top margin (adjusted for MCO text above)

// Border and colors
const BORDER_WIDTH = 0.5; // Thinner lines for cleaner look
const BLACK = rgb(0, 0, 0);

// Row heights from HTML (in points)
const TITLE_HEIGHT = 28;
const ACTION_ROW_HEIGHT = 27;
const DATE_ROW_HEIGHT = 26;
const FROM_ROW_HEIGHT = 36;
const VIA_ROW_HEIGHT = 36;
const TO_ROW_HEIGHT = 54 + 45; // TO spans 2 rows (54 + 45 = 99pt)
const REF_ROW_HEIGHT = 91;
const SUPP_INFO_HEIGHT = 331; // Reduced from 368 to avoid footer overlap
const PROC_LABEL_HEIGHT = 18;

// Column widths from HTML
const FROM_COL_WIDTH = 378; // Left column for FROM (spans down to include date area)
const ACTION_NO_WIDTH = 81;
const SSIC_WIDTH = 99;
const DATE_WIDTH = 180; // ACTION_NO + SSIC = 180

const FIELD4_WIDTH = 280; // FROM field
const FIELD5_WIDTH = 278; // ORG/STATION

const TO_COL_WIDTH = 324; // TO field (left side)
const NAT_COL_WIDTH = 234; // NATURE OF ACTION + COPY TO (right side)

const REF_WIDTH = 280;
const ENCL_WIDTH = 278;

// Footer positioning
const FOOTER_Y = 45; // Y position for footer area

/**
 * Draw page header (MCO reference above form)
 */
function drawPageHeader(page: PDFPage, font: PDFFont) {
  // MCO 5216.19A in top right, above the form border
  const mcoText = 'MCO 5216.19A';
  const mcoWidth = font.widthOfTextAtSize(mcoText, 9);
  page.drawText(mcoText, {
    x: FORM_LEFT + FORM_WIDTH - mcoWidth,
    y: FORM_TOP + 8,
    size: 9,
    font,
    color: BLACK,
  });
}

/**
 * Draw page footer (form number, official use notice, page number)
 */
function drawPageFooter(
  page: PDFPage, 
  font: PDFFont, 
  fontBold: PDFFont, 
  pageNum: number, 
  totalPages: number
) {
  const footerY = FOOTER_Y;
  
  // Left side: Form number and edition notice
  page.drawText('NAVMC 10274 (REV. 07-20) (EF)', {
    x: FORM_LEFT,
    y: footerY,
    size: 8,
    font: fontBold,
    color: BLACK,
  });
  page.drawText('Previous editions will not be used', {
    x: FORM_LEFT,
    y: footerY - 10,
    size: 7,
    font,
    color: BLACK,
  });
  
  // Center: FOR OFFICIAL USE ONLY notice
  const officialText = 'FOR OFFICIAL USE ONLY';
  const officialWidth = fontBold.widthOfTextAtSize(officialText, 8);
  const centerX = PAGE_WIDTH / 2;
  page.drawText(officialText, {
    x: centerX - officialWidth / 2,
    y: footerY,
    size: 8,
    font: fontBold,
    color: BLACK,
  });
  
  const privacyText = 'PRIVACY SENSITIVE - Any misuse or unauthorized';
  const privacyWidth = font.widthOfTextAtSize(privacyText, 7);
  page.drawText(privacyText, {
    x: centerX - privacyWidth / 2,
    y: footerY - 10,
    size: 7,
    font,
    color: BLACK,
  });
  
  const disclosureText = 'disclosure can result in both civil and criminal penalties.';
  const disclosureWidth = font.widthOfTextAtSize(disclosureText, 7);
  page.drawText(disclosureText, {
    x: centerX - disclosureWidth / 2,
    y: footerY - 18,
    size: 7,
    font,
    color: BLACK,
  });
  
  // Right side: Page number
  const pageText = `Page ${pageNum} of ${totalPages}`;
  const pageWidth = font.widthOfTextAtSize(pageText, 9);
  page.drawText(pageText, {
    x: FORM_LEFT + FORM_WIDTH - pageWidth,
    y: footerY,
    size: 9,
    font,
    color: BLACK,
  });
  
  // AEM Designer text (smaller, below page number)
  const aemText = 'AEM Designer 6.5';
  const aemWidth = font.widthOfTextAtSize(aemText, 7);
  page.drawText(aemText, {
    x: FORM_LEFT + FORM_WIDTH - aemWidth,
    y: footerY - 10,
    size: 7,
    font,
    color: BLACK,
  });
}

/**
 * Draw a cell with border and optional text
 */
function drawCell(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  options?: {
    topBorder?: boolean;
    bottomBorder?: boolean;
    leftBorder?: boolean;
    rightBorder?: boolean;
  }
) {
  const { topBorder = true, bottomBorder = true, leftBorder = true, rightBorder = true } = options || {};

  if (topBorder) {
    page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: BORDER_WIDTH, color: BLACK });
  }
  if (bottomBorder) {
    page.drawLine({ start: { x, y: y - height }, end: { x: x + width, y: y - height }, thickness: BORDER_WIDTH, color: BLACK });
  }
  if (leftBorder) {
    page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: BORDER_WIDTH, color: BLACK });
  }
  if (rightBorder) {
    page.drawLine({ start: { x: x + width, y }, end: { x: x + width, y: y - height }, thickness: BORDER_WIDTH, color: BLACK });
  }
}

/**
 * Draw label text (Arial 8pt)
 */
function drawLabel(page: PDFPage, font: PDFFont, text: string, x: number, y: number) {
  page.drawText(text, { x: x + 2, y: y - 10, size: 8, font, color: BLACK });
}

/**
 * Draw value text with wrapping
 */
function drawValue(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  fontSize: number = 9,
  startOffset: number = 20
): void {
  if (!text) return;

  const lineHeight = fontSize + 2;
  const lines = wrapText(text, maxWidth - 6, font, fontSize);
  let currentY = y - startOffset;

  for (const line of lines) {
    if (currentY < y - maxHeight + 4) break;
    page.drawText(line, { x: x + 3, y: currentY, size: fontSize, font, color: BLACK });
    currentY -= lineHeight;
  }
}

/**
 * Wrap text to fit within width
 */
function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
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
 * Generates a pixel-perfect NAVMC 10274 PDF (pages 2-3)
 */
export async function generateNavmc10274Pdf(data: NavmcForm10274Data): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  const arial = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const arialBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const times = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  const totalPages = 3; // Total pages in the form (page 1 is separate, we generate pages 2 and 3)

  // ==================== PAGE 1 (Form Page - Page 2 of 3) ====================
  const page1 = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  // Draw header (MCO 5216.19A)
  drawPageHeader(page1, arial);
  
  let y = FORM_TOP;

  // ----- TITLE ROW: "ADMINISTRATIVE ACTION (5216)" - height: 28pt -----
  drawCell(page1, FORM_LEFT, y, FORM_WIDTH, TITLE_HEIGHT);
  const titleText = 'ADMINISTRATIVE ACTION (5216)';
  const titleWidth = arialBold.widthOfTextAtSize(titleText, 10);
  page1.drawText(titleText, {
    x: FORM_LEFT + (FORM_WIDTH - titleWidth) / 2,
    y: y - 14, // Flush to top of box
    size: 10,
    font: arialBold,
    color: BLACK,
  });
  y -= TITLE_HEIGHT;

  // ----- ROW 2: FROM (left, rowspan 2) | ACTION NO (top-right) | SSIC (top-right) -----
  // FROM cell: 378pt wide, spans 2 rows (27 + 26 = 53pt)
  const fromCellHeight = ACTION_ROW_HEIGHT + DATE_ROW_HEIGHT;
  drawCell(page1, FORM_LEFT, y, FROM_COL_WIDTH, fromCellHeight);
  drawLabel(page1, arial, '4.  FROM (Grade, Name, EDIPI, MOS or CO, Pers. O., etc.)', FORM_LEFT, y);
  drawValue(page1, times, data.from, FORM_LEFT, y, FROM_COL_WIDTH, fromCellHeight, 9, 20);

  // ACTION NO cell: 81pt wide, 27pt tall
  const actionX = FORM_LEFT + FROM_COL_WIDTH;
  drawCell(page1, actionX, y, ACTION_NO_WIDTH, ACTION_ROW_HEIGHT);
  drawLabel(page1, arial, '1.  ACTION NO.', actionX, y);
  if (data.actionNo) {
    page1.drawText(data.actionNo, { x: actionX + 3, y: y - ACTION_ROW_HEIGHT + 5, size: 9, font: times, color: BLACK });
  }

  // SSIC cell: 99pt wide, 27pt tall
  const ssicX = actionX + ACTION_NO_WIDTH;
  drawCell(page1, ssicX, y, SSIC_WIDTH, ACTION_ROW_HEIGHT);
  drawLabel(page1, arial, '2.  SSIC/FILE NO.', ssicX, y);
  if (data.ssicFileNo) {
    page1.drawText(data.ssicFileNo, { x: ssicX + 3, y: y - ACTION_ROW_HEIGHT + 5, size: 9, font: times, color: BLACK });
  }
  y -= ACTION_ROW_HEIGHT;

  // DATE cell: 180pt wide (colspan 2), 26pt tall
  drawCell(page1, actionX, y, DATE_WIDTH, DATE_ROW_HEIGHT);
  drawLabel(page1, arial, '3.  DATE', actionX, y);
  if (data.date) {
    page1.drawText(data.date, { x: actionX + 3, y: y - DATE_ROW_HEIGHT + 5, size: 9, font: times, color: BLACK });
  }
  y -= DATE_ROW_HEIGHT;

  // ----- ROW 3: FROM (280pt) | ORG/STATION (278pt, rowspan 2) -----
  // Actually FROM and VIA are stacked on left, ORG/STATION spans both on right
  const orgStationHeight = FROM_ROW_HEIGHT + VIA_ROW_HEIGHT;

  // FROM field 4: 280pt wide, 36pt tall
  drawCell(page1, FORM_LEFT, y, FIELD4_WIDTH, FROM_ROW_HEIGHT);
  // Label already at top, this is continuation - skip label, just draw value area

  // ORG/STATION field 5: 278pt wide, spans 2 rows (72pt)
  const orgX = FORM_LEFT + FIELD4_WIDTH;
  drawCell(page1, orgX, y, FIELD5_WIDTH, orgStationHeight);
  drawLabel(page1, arial, '5.  ORGANIZATION AND STATION (Complete address)', orgX, y);
  drawValue(page1, times, data.orgStation, orgX, y, FIELD5_WIDTH, orgStationHeight, 9, 20);
  y -= FROM_ROW_HEIGHT;

  // VIA field 6: 280pt wide, 36pt tall
  drawCell(page1, FORM_LEFT, y, FIELD4_WIDTH, VIA_ROW_HEIGHT, { rightBorder: false });
  drawLabel(page1, arial, '6.  VIA (As required)', FORM_LEFT, y);
  drawValue(page1, times, data.via, FORM_LEFT, y, FIELD4_WIDTH, VIA_ROW_HEIGHT, 9, 20);
  y -= VIA_ROW_HEIGHT;

  // ----- ROW 4-5: TO (324pt, rowspan 2) | NATURE OF ACTION (234pt) / COPY TO (234pt) -----
  const natHeight = 54;
  const copyHeight = 45;

  // TO field 7: 324pt wide, 99pt tall (rowspan 2)
  drawCell(page1, FORM_LEFT, y, TO_COL_WIDTH, TO_ROW_HEIGHT);
  page1.drawText('7.', { x: FORM_LEFT + 3, y: y - 12, size: 8, font: arial, color: BLACK });
  page1.drawText('TO:', { x: FORM_LEFT + 11, y: y - (TO_ROW_HEIGHT / 2) - 4, size: 8, font: arial, color: BLACK }); // Vertically centered
  // Draw TO value
  if (data.to) {
    const toLines = wrapText(data.to, TO_COL_WIDTH - 50, times, 10);
    let toY = y - 45;
    for (const line of toLines) {
      if (toY < y - TO_ROW_HEIGHT + 10) break;
      page1.drawText(line, { x: FORM_LEFT + 35, y: toY, size: 10, font: times, color: BLACK });
      toY -= 12;
    }
  }

  // NATURE OF ACTION field 8: 234pt wide, 54pt tall
  const natX = FORM_LEFT + TO_COL_WIDTH;
  drawCell(page1, natX, y, NAT_COL_WIDTH, natHeight);
  drawLabel(page1, arial, '8.  NATURE OF ACTION/SUBJECT', natX, y);
  drawValue(page1, times, data.natureOfAction, natX, y, NAT_COL_WIDTH, natHeight, 9, 20);

  // COPY TO field 9: 234pt wide, 45pt tall
  drawCell(page1, natX, y - natHeight, NAT_COL_WIDTH, copyHeight);
  drawLabel(page1, arial, '9.  COPY TO (As required)', natX, y - natHeight);
  drawValue(page1, times, data.copyTo, natX, y - natHeight, NAT_COL_WIDTH, copyHeight, 9, 20);
  y -= TO_ROW_HEIGHT;

  // ----- ROW 6: REFERENCE (280pt) | ENCLOSURES (278pt) - height: 91pt -----
  // REFERENCE field 10
  drawCell(page1, FORM_LEFT, y, REF_WIDTH, REF_ROW_HEIGHT);
  drawLabel(page1, arial, '10.  REFERENCE OR AUTHORITY (if applicable)', FORM_LEFT, y);
  drawValue(page1, times, data.references, FORM_LEFT, y, REF_WIDTH, REF_ROW_HEIGHT, 9, 20);

  // ENCLOSURES field 11
  const enclX = FORM_LEFT + REF_WIDTH;
  drawCell(page1, enclX, y, ENCL_WIDTH, REF_ROW_HEIGHT);
  drawLabel(page1, arial, '11.  ENCLOSURES (if any)', enclX, y);
  drawValue(page1, times, data.enclosures, enclX, y, ENCL_WIDTH, REF_ROW_HEIGHT, 9, 20);
  y -= REF_ROW_HEIGHT;

  // ----- ROW 7: SUPPLEMENTAL INFORMATION - full width, height: 368pt -----
  drawCell(page1, FORM_LEFT, y, FORM_WIDTH, SUPP_INFO_HEIGHT);
  drawLabel(page1, arial, '12.  SUPPLEMENTAL INFORMATION (Reduce to minimum wording - type name of originator and sign 3 lines below text)', FORM_LEFT, y);
  drawValue(page1, times, data.supplementalInfo, FORM_LEFT, y, FORM_WIDTH, SUPP_INFO_HEIGHT, 10, 20);
  y -= SUPP_INFO_HEIGHT;

  // ----- ROW 8: PROCESSING ACTION label - full width, height: 18pt -----
  drawCell(page1, FORM_LEFT, y, FORM_WIDTH, PROC_LABEL_HEIGHT);
  const procText = '13.  PROCESSING ACTION.  (Complete processing action in item 12 or on reverse.  Endorse by rubber stamp where practicable.)';
  page1.drawText(procText, {
    x: FORM_LEFT + 48,
    y: y - PROC_LABEL_HEIGHT + 5,
    size: 8,
    font: arial,
    color: BLACK,
  });

  // Draw footer for page 1 (Page 2 of 3)
  drawPageFooter(page1, arial, arialBold, 2, totalPages);

  // ==================== PAGE 2 (Continuation Page - Page 3 of 3) ====================
  const page2 = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  // Draw header (MCO 5216.19A)
  drawPageHeader(page2, arial);
  
  y = FORM_TOP;

  // Title row with border box
  drawCell(page2, FORM_LEFT, y, FORM_WIDTH, TITLE_HEIGHT);
  const title2Text = 'ADMINISTRATIVE ACTION (5216)';
  const title2Width = arialBold.widthOfTextAtSize(title2Text, 10);
  page2.drawText(title2Text, {
    x: FORM_LEFT + (FORM_WIDTH - title2Width) / 2,
    y: y - 14,
    size: 10,
    font: arialBold,
    color: BLACK,
  });
  y -= TITLE_HEIGHT;

  // Processing Action continuation area - large box for the rest of the page
  const procActHeight = y - FOOTER_Y - 10; // From below title to above footer
  drawCell(page2, FORM_LEFT, y, FORM_WIDTH, procActHeight);

  // Draw proposed action text
  if (data.proposedAction) {
    const procLines = wrapText(data.proposedAction, FORM_WIDTH - 10, times, 10);
    let procY = y - 14;
    for (const line of procLines) {
      if (procY < y - procActHeight + 10) break;
      page2.drawText(line, { x: FORM_LEFT + 5, y: procY, size: 10, font: times, color: BLACK });
      procY -= 12;
    }
  }

  // Draw footer for page 2 (Page 3 of 3)
  drawPageFooter(page2, arial, arialBold, 3, totalPages);

  return pdfDoc.save();
}

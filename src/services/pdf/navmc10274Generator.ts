import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { NavmcForm10274Data } from '@/stores/formStore';

const MARGIN_LEFT = 36; // 0.5 inch
const MARGIN_RIGHT = 36;
const MARGIN_TOP = 36;
const PAGE_WIDTH = 612; // Letter size
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

/**
 * Wraps text to fit within a given width
 */
function wrapText(text: string, maxWidth: number, font: any, fontSize: number): string[] {
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
 * Generates a NAVMC 10274 PDF from form data
 */
export async function generateNavmc10274Pdf(data: NavmcForm10274Data): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN_TOP;

  const black = rgb(0, 0, 0);
  const labelSize = 8;
  const valueSize = 10;
  const titleSize = 12;
  const lineHeight = 12;

  // Helper to draw a box with label and value
  const drawBox = (
    x: number,
    boxY: number,
    width: number,
    height: number,
    label: string,
    value: string,
    multiLine = false
  ) => {
    // Draw box border
    page.drawRectangle({
      x,
      y: boxY - height,
      width,
      height,
      borderColor: black,
      borderWidth: 0.5,
    });

    // Draw label
    page.drawText(label, {
      x: x + 2,
      y: boxY - labelSize - 2,
      size: labelSize,
      font: helvetica,
      color: black,
    });

    // Draw value
    if (multiLine && value) {
      const lines = wrapText(value, width - 6, timesRoman, valueSize);
      let textY = boxY - labelSize - lineHeight - 2;
      for (const line of lines) {
        if (textY < boxY - height + 4) break;
        page.drawText(line, {
          x: x + 3,
          y: textY,
          size: valueSize,
          font: timesRoman,
          color: black,
        });
        textY -= lineHeight;
      }
    } else if (value) {
      page.drawText(value, {
        x: x + 3,
        y: boxY - labelSize - lineHeight - 2,
        size: valueSize,
        font: timesRoman,
        color: black,
      });
    }
  };

  // ===== HEADER: MCO Reference =====
  page.drawText('MCO 5216.19A', {
    x: PAGE_WIDTH - MARGIN_RIGHT - 70,
    y: y,
    size: 8,
    font: helvetica,
    color: black,
  });

  y -= 20;

  // ===== TITLE =====
  const title = 'ADMINISTRATIVE ACTION (5216)';
  const titleWidth = timesBold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y,
    size: titleSize,
    font: timesBold,
    color: black,
  });

  // Draw title box
  page.drawRectangle({
    x: MARGIN_LEFT,
    y: y - 6,
    width: CONTENT_WIDTH,
    height: 22,
    borderColor: black,
    borderWidth: 0.5,
  });

  y -= 30;

  // ===== ROW 1: Action No, SSIC/File No, Date =====
  const row1Height = 28;
  const col1Width = 100;
  const col2Width = 120;
  const col3Width = CONTENT_WIDTH - col1Width - col2Width;

  drawBox(MARGIN_LEFT, y, col1Width, row1Height, '1. ACTION NO.', data.actionNo);
  drawBox(MARGIN_LEFT + col1Width, y, col2Width, row1Height, '2. SSIC/FILE NO.', data.ssicFileNo);
  drawBox(MARGIN_LEFT + col1Width + col2Width, y, col3Width, row1Height, '3. DATE', data.date);

  y -= row1Height;

  // ===== ROW 2: From, Org/Station =====
  const row2Height = 42;
  const halfWidth = CONTENT_WIDTH / 2;

  drawBox(MARGIN_LEFT, y, halfWidth, row2Height, '4. FROM', data.from, true);
  drawBox(MARGIN_LEFT + halfWidth, y, halfWidth, row2Height, '6. ORGANIZATION/STATION', data.orgStation, true);

  y -= row2Height;

  // ===== ROW 3: Via =====
  const row3Height = 28;
  drawBox(MARGIN_LEFT, y, CONTENT_WIDTH, row3Height, '5. VIA', data.via);

  y -= row3Height;

  // ===== ROW 4: To =====
  const row4Height = 50;
  drawBox(MARGIN_LEFT, y, CONTENT_WIDTH, row4Height, '7. TO', data.to, true);

  y -= row4Height;

  // ===== ROW 5: Nature of Action =====
  const row5Height = 42;
  drawBox(MARGIN_LEFT, y, CONTENT_WIDTH, row5Height, '8. NATURE OF ACTION', data.natureOfAction, true);

  y -= row5Height;

  // ===== ROW 6: Copy To, Ref/Auth, Encl =====
  const row6Height = 42;
  const col6_1Width = CONTENT_WIDTH * 0.3;
  const col6_2Width = CONTENT_WIDTH * 0.4;
  const col6_3Width = CONTENT_WIDTH * 0.3;

  drawBox(MARGIN_LEFT, y, col6_1Width, row6Height, '9. COPY TO', data.copyTo, true);
  drawBox(MARGIN_LEFT + col6_1Width, y, col6_2Width, row6Height, '10. REF/AUTH', data.references, true);
  drawBox(MARGIN_LEFT + col6_1Width + col6_2Width, y, col6_3Width, row6Height, '11. ENCL', data.enclosures, true);

  y -= row6Height;

  // ===== ROW 7: Supplemental Information (main content area) =====
  const suppInfoHeight = 280;

  page.drawRectangle({
    x: MARGIN_LEFT,
    y: y - suppInfoHeight,
    width: CONTENT_WIDTH,
    height: suppInfoHeight,
    borderColor: black,
    borderWidth: 0.5,
  });

  page.drawText('12. SUPPLEMENTAL INFORMATION', {
    x: MARGIN_LEFT + 2,
    y: y - labelSize - 2,
    size: labelSize,
    font: helvetica,
    color: black,
  });

  // Draw supplemental info text with wrapping
  if (data.supplementalInfo) {
    const lines = wrapText(data.supplementalInfo, CONTENT_WIDTH - 10, timesRoman, valueSize);
    let textY = y - labelSize - lineHeight - 4;
    for (const line of lines) {
      if (textY < y - suppInfoHeight + 10) {
        // Would need new page - for now, truncate
        page.drawText('...', {
          x: MARGIN_LEFT + 3,
          y: textY,
          size: valueSize,
          font: timesRoman,
          color: black,
        });
        break;
      }
      page.drawText(line, {
        x: MARGIN_LEFT + 3,
        y: textY,
        size: valueSize,
        font: timesRoman,
        color: black,
      });
      textY -= lineHeight;
    }
  }

  y -= suppInfoHeight;

  // ===== ROW 8: Proposed/Recommended Action =====
  const row8Height = 60;
  drawBox(MARGIN_LEFT, y, CONTENT_WIDTH, row8Height, '13. PROPOSED/RECOMMENDED ACTION', data.proposedAction, true);

  y -= row8Height;

  // ===== FOOTER: Form identification =====
  y = MARGIN_TOP + 20;

  page.drawText('NAVMC 10274 (REV. 07-20)', {
    x: MARGIN_LEFT,
    y,
    size: 8,
    font: helveticaBold,
    color: black,
  });

  page.drawText('FOR OFFICIAL USE ONLY', {
    x: (PAGE_WIDTH - helveticaBold.widthOfTextAtSize('FOR OFFICIAL USE ONLY', 8)) / 2,
    y,
    size: 8,
    font: helveticaBold,
    color: black,
  });

  // Privacy notice (smaller text)
  page.drawText('PRIVACY SENSITIVE - Any misuse or unauthorized disclosure can result in civil and criminal penalties.', {
    x: (PAGE_WIDTH - helvetica.widthOfTextAtSize('PRIVACY SENSITIVE - Any misuse or unauthorized disclosure can result in civil and criminal penalties.', 6)) / 2,
    y: y - 10,
    size: 6,
    font: helvetica,
    color: black,
  });

  return pdfDoc.save();
}

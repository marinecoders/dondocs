import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// NAVMC 118(11) - Administrative Remarks (Page 11 / 6105)
// This generator loads the official form template and overlays text

export interface Navmc11811Data {
  // Marine identification
  lastName: string;
  firstName: string;
  middleName: string;
  edipi: string;
  
  // The main 6105 entry content
  remarksText: string;
  
  // Entry date (appears at end of entry)
  entryDate: string;
  
  // Signature info (for the counseling signature line)
  signatureName?: string;
}

// Field coordinates (measured from bottom-left in points)
// These are approximate - adjust as needed after testing
const FIELDS = {
  // NAME field at bottom left
  name: { x: 120, y: 62, maxWidth: 350 },
  
  // EDIPI field at bottom right
  edipi: { x: 520, y: 62, maxWidth: 80 },
  
  // Main remarks area
  remarks: {
    x: 36,
    y: 645,  // Start from top of remarks box
    maxWidth: 540,
    lineHeight: 12,
    maxLines: 42,  // Approximate lines that fit
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
  
  // Embed fonts
  const font = await pdfDoc.embedFont(StandardFonts.Courier);
  const BLACK = rgb(0, 0, 0);
  const FONT_SIZE = 10;

  // Fill in NAME field
  const fullName = [data.lastName, data.firstName, data.middleName]
    .filter(Boolean)
    .join(', ');
  
  if (fullName) {
    page.drawText(fullName.toUpperCase(), {
      x: FIELDS.name.x,
      y: FIELDS.name.y,
      size: FONT_SIZE,
      font,
      color: BLACK,
    });
  }

  // Fill in EDIPI field
  if (data.edipi) {
    page.drawText(data.edipi, {
      x: FIELDS.edipi.x,
      y: FIELDS.edipi.y,
      size: FONT_SIZE,
      font,
      color: BLACK,
    });
  }

  // Fill in remarks area
  if (data.remarksText) {
    const lines = wrapText(data.remarksText, FIELDS.remarks.maxWidth, font, FONT_SIZE);
    let y = FIELDS.remarks.y;
    
    for (let i = 0; i < Math.min(lines.length, FIELDS.remarks.maxLines); i++) {
      page.drawText(lines[i], {
        x: FIELDS.remarks.x,
        y,
        size: FONT_SIZE,
        font,
        color: BLACK,
      });
      y -= FIELDS.remarks.lineHeight;
    }

    // Add date at the end of the entry (2 lines below last text)
    if (data.entryDate) {
      y -= FIELDS.remarks.lineHeight; // Extra space
      page.drawText(data.entryDate, {
        x: FIELDS.remarks.x,
        y,
        size: FONT_SIZE,
        font,
        color: BLACK,
      });
    }
  }

  return pdfDoc.save();
}

/**
 * Load the NAVMC 118(11) template from the public folder
 */
export async function loadNavmc11811Template(): Promise<ArrayBuffer> {
  const response = await fetch('/templates/NAVMC118_template.pdf');
  if (!response.ok) {
    throw new Error('Failed to load NAVMC 118(11) template');
  }
  return response.arrayBuffer();
}

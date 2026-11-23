import { StandardFonts, type PDFDocument } from 'pdf-lib';
import type { DocumentFontFamily } from '../fonts';

type PdfFontStyle = 'regular' | 'bold';

const standardFonts = {
  times: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold },
  courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold },
  helvetica: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold },
} satisfies Record<DocumentFontFamily | 'helvetica', Record<PdfFontStyle, StandardFonts>>;

export function embedPdfFont(pdf: PDFDocument, family: keyof typeof standardFonts, style: PdfFontStyle = 'regular') {
  return pdf.embedFont(standardFonts[family][style]);
}

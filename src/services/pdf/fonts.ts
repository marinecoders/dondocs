import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';
import type { DocumentFontFamily } from '../fonts';
import { loadLocalOfficeFonts } from '../officeFonts';

type PdfFontStyle = 'regular' | 'bold';

const standardFonts = {
  times: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold },
  courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold },
  helvetica: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold },
} satisfies Record<DocumentFontFamily | 'helvetica', Record<PdfFontStyle, StandardFonts>>;

const installedFontCoverage = new WeakMap<PDFFont, ReadonlySet<number>>();

export async function embedPdfFont(pdf: PDFDocument, family: keyof typeof standardFonts, style: PdfFontStyle = 'regular') {
  if (family !== 'helvetica') {
    const source = await loadLocalOfficeFonts();
    if (source) {
      const { default: fontkit } = await import('@pdf-lib/fontkit');
      pdf.registerFontkit(fontkit);
      const font = await pdf.embedFont(source.readFace(family, style), { subset: true });
      installedFontCoverage.set(font, new Set(font.getCharacterSet()));
      return font;
    }
  }
  return pdf.embedFont(standardFonts[family][style]);
}

/** pdf-lib checks standard fonts itself. Custom fonts otherwise silently use a missing glyph. */
export function assertInstalledFontText(font: PDFFont, text: string): void {
  const coverage = installedFontCoverage.get(font);
  if (!coverage) return;
  for (const character of text) {
    const codepoint = character.codePointAt(0)!;
    if (!coverage.has(codepoint) && !'\r\n\t'.includes(character)) {
      throw new Error(`The selected PDF font cannot print U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}.`);
    }
  }
}

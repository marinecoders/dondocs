import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts } from 'pdf-lib';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';

const url = 'https://example.mil/reference';

async function referencePdf(rectangle: 'direct' | 'indirect' | 'invalid' | 'separate'): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontName = page.node.newFontDictionary('F', font.ref);
  // A literal text operand matches the engine's reference marker encoding.
  const content = pdf.context.flateStream(`BT ${fontName} 12 Tf 0 0 1 rg 1 0 0 1 72 700 Tm (a) Tj ET`);
  page.node.set(PDFName.of('Contents'), pdf.context.register(content));
  const coordinates = rectangle === 'separate' ? [72, 400, 150, 415] : [72, 698, 150, 715];
  const rect = pdf.context.obj(coordinates.map(value => rectangle === 'indirect'
    ? pdf.context.register(PDFNumber.of(value)) : PDFNumber.of(value)));
  if (rectangle === 'invalid') rect.set(0, PDFString.of('invalid'));
  const annotation = pdf.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: rect,
    A: { S: 'URI', URI: PDFString.of(url) },
  });
  page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(annotation)]));
  return pdf.save();
}

describe('reference link annotations', () => {
  it.each(['direct', 'indirect'] as const)('preserves an existing %s rectangle without adding a wider fallback', async rectangle => {
    const result = await mergeEnclosures(await referencePdf(rectangle), [], undefined, true, [{ letter: 'a', url }]);
    const pdf = await PDFDocument.load(result.pdfBytes);
    const annotations = pdf.getPage(0).node.Annots()!;
    expect(annotations.size()).toBe(1);
    const annotation = annotations.lookup(0, PDFDict);
    const bounds = annotation.lookup(PDFName.of('Rect'), PDFArray);
    expect(Array.from({ length: bounds.size() }, (_, i) => bounds.lookup(i, PDFNumber).asNumber())).toEqual([72, 698, 150, 715]);
  });

  it.each(['invalid', 'separate'] as const)('still creates a fallback when an existing rectangle is %s', async rectangle => {
    const result = await mergeEnclosures(await referencePdf(rectangle), [], undefined, true, [{ letter: 'a', url }]);
    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getPage(0).node.Annots()!.size()).toBe(2);
  });
});

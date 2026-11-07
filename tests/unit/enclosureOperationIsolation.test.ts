import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString } from 'pdf-lib';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';

async function pdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();document.addPage().drawText('Valid enclosure content');return document.save();
}
async function destinations(bytes: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(bytes);
  const names = document.catalog.lookup(PDFName.of('Names'), PDFDict);
  const dests = names?.lookup(PDFName.of('Dests'), PDFDict)?.lookup(PDFName.of('Names'), PDFArray);
  return dests ? Array.from({ length: dests.size() / 2 }, (_, i) => (dests.get(i * 2) as PDFString).decodeText()) : [];
}
it('keeps named enclosure destinations owned by each concurrent assembly', async () => {
  const bytes = await pdf();
  const enclosure = (number: number) => ({ number, title: `Enclosure ${number}`, data: new Uint8Array(bytes).buffer });
  const [first, second] = await Promise.all([
    mergeEnclosures(bytes, [enclosure(1), enclosure(2)], undefined, true),
    mergeEnclosures(bytes, [enclosure(1)], undefined, true),
  ]);
  expect(await destinations(first.pdfBytes)).toEqual(['enclosure1', 'enclosure2']);
  expect(await destinations(second.pdfBytes)).toEqual(['enclosure1']);
});

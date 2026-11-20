import { expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { captureVolumePdfDestinations, restoreVolumePdfLinks } from '@/services/pdf/volumePackageLinks';

async function source() {
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([612, 792]), second = pdf.addPage([612, 792]);
  pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ Dests: { Names: [
    PDFString.of('volume.node.target'), [second.ref, PDFName.of('XYZ'), 72, 650, null],
  ] } }));
  first.node.set(PDFName.of('Annots'), pdf.context.obj([
    { Type: 'Annot', Subtype: 'Link', Rect: [72, 600, 170, 620], Dest: PDFString.of('volume.node.target') },
    { Type: 'Annot', Subtype: 'Link', Rect: [72, 570, 170, 590], A: { S: 'URI', URI: PDFString.of('https://example.test/source') } },
  ]));
  return pdf;
}

it('restores each captured target after page copying without rewriting external links', async () => {
  const original = await source(), destinations = captureVolumePdfDestinations(original);
  const output = await PDFDocument.create();
  output.addPage([612, 792]);
  for (const page of await output.copyPages(original, [0, 1])) output.addPage(page);
  restoreVolumePdfLinks(output, destinations, 1, 2);
  const annotations = output.getPage(1).node.Annots()!;
  const internal = annotations.lookup(0, PDFDict).lookup(PDFName.of('Dest'), PDFArray);
  expect(internal.get(0)).toBe(output.getPage(2).ref);
  expect(internal.lookup(1)).toBe(PDFName.of('XYZ'));
  const external = annotations.lookup(1, PDFDict).lookup(PDFName.of('A'), PDFDict);
  expect(external.lookup(PDFName.of('S'))).toBe(PDFName.of('URI'));
  expect(external.lookup(PDFName.of('URI'), PDFString).decodeText()).toBe('https://example.test/source');
});

it('rejects named targets whose destination is outside the original page tree', async () => {
  const pdf = await source();
  const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('Dests'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
  names.set(1, pdf.context.obj([pdf.context.register(pdf.context.obj({ Type: 'Page' })), PDFName.of('XYZ'), 72, 650, null]));
  expect(() => captureVolumePdfDestinations(pdf)).toThrow('unresolved internal page link');
});

it('rejects missing targets and destinations that would escape a captured member boundary', async () => {
  const pdf = await source(), destinations = captureVolumePdfDestinations(pdf);
  expect(() => restoreVolumePdfLinks(pdf, new Map(), 0, 2)).toThrow('unresolved internal page link');
  expect(() => restoreVolumePdfLinks(pdf, destinations, 0, 1)).toThrow('unresolved internal page link');
});

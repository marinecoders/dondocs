import { PDFArray, PDFHexString, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';

/** SwiftLaTeX writes named destinations at page 1. Resolve publication anchors
 * from their page annotations before signing or appending enclosures. */
export async function resolvePublicationDestinations(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const anchors = new Map<string, PDFArray>();
  for (const page of pdf.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    for (let i = annotations.size() - 1; i >= 0; i--) {
      const annotation = annotations.lookup(i);
      if (!(annotation instanceof PDFDict)) continue;
      const name = annotation.lookup(PDFName.of('NM'));
      if (!(name instanceof PDFString) || !name.decodeText().startsWith('itype.')) continue;
      const rect = annotation.lookup(PDFName.of('Rect'), PDFArray);
      const x = rect.lookup(0, PDFNumber).asNumber();
      const y = rect.lookup(3, PDFNumber).asNumber();
      anchors.set(name.decodeText(), pdf.context.obj([page.ref, PDFName.of('XYZ'), x, y, null]));
      annotations.remove(i);
    }
  }
  if (!anchors.size) return bytes;
  let names = pdf.catalog.lookup(PDFName.of('Names'));
  if (!(names instanceof PDFDict)) {
    names = pdf.context.obj({});
    pdf.catalog.set(PDFName.of('Names'), names);
  }
  const entries = new Map<string, import('pdf-lib').PDFObject>();
  const visit = (node: PDFDict) => {
    const values = node.lookup(PDFName.of('Names'));
    if (values instanceof PDFArray) {
      for (let i = 0; i < values.size(); i += 2) {
        const name = values.lookup(i);
        if (name instanceof PDFString || name instanceof PDFHexString) entries.set(name.decodeText(), values.get(i + 1));
      }
    }
    const children = node.lookup(PDFName.of('Kids'));
    if (children instanceof PDFArray) for (let i = 0; i < children.size(); i++) visit(children.lookup(i, PDFDict));
  };
  const destinations = (names as PDFDict).lookup(PDFName.of('Dests'));
  if (destinations instanceof PDFDict) visit(destinations);
  for (const [name, destination] of anchors) entries.set(name, destination);
  const sorted = [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  (names as PDFDict).set(PDFName.of('Dests'), pdf.context.obj({ Names: sorted.flatMap(([name, destination]) => [PDFString.of(name), destination]) }));
  return pdf.save();
}

export function appendPublicationOutline(pdf: PDFDocument, title: string, pageIndex: number): void {
  let root = pdf.catalog.lookup(PDFName.of('Outlines'));
  if (!(root instanceof PDFDict)) {
    root = pdf.context.obj({ Type: 'Outlines', Count: 0 });
    pdf.catalog.set(PDFName.of('Outlines'), pdf.context.register(root));
  }
  const outline = root as PDFDict;
  const parent = pdf.catalog.get(PDFName.of('Outlines'))!;
  const last = outline.get(PDFName.of('Last'));
  const entry = pdf.context.obj({
    Title: PDFHexString.fromText(title), Parent: parent,
    Dest: [pdf.getPage(pageIndex).ref, PDFName.of('Fit')], ...(last ? { Prev: last } : {}),
  });
  const ref = pdf.context.register(entry);
  if (last) pdf.context.lookup(last, PDFDict).set(PDFName.of('Next'), ref);
  else outline.set(PDFName.of('First'), ref);
  outline.set(PDFName.of('Last'), ref);
  const count = outline.lookup(PDFName.of('Count'));
  outline.set(PDFName.of('Count'), PDFNumber.of((count instanceof PDFNumber ? count.asNumber() : 0) + 1));
}

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
  const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict);
  const destinations = names.lookup(PDFName.of('Dests'), PDFDict);
  const visit = (node: PDFDict) => {
    const entries = node.lookup(PDFName.of('Names'));
    if (entries instanceof PDFArray) {
      for (let i = 0; i < entries.size(); i += 2) {
        const name = entries.lookup(i);
        if (!(name instanceof PDFString)) continue;
        const destination = anchors.get(name.decodeText());
        if (destination) entries.set(i + 1, destination);
      }
    }
    const children = node.lookup(PDFName.of('Kids'));
    if (children instanceof PDFArray) for (let i = 0; i < children.size(); i++) visit(children.lookup(i, PDFDict));
  };
  visit(destinations);
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

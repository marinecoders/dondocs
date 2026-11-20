import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';

type VolumeDestination = { page: number; x: number; y: number };
const LINK_ERROR = 'A captured volume has an unresolved internal page link. Regenerate its PDF before assembling the package.';

/** Capture the canonical renderer's destinations before PDF page copying drops
 * their document-level name tree. Keep only primitive coordinates and indices. */
export function captureVolumePdfDestinations(source: PDFDocument): ReadonlyMap<string, VolumeDestination> {
  const result = new Map<string, VolumeDestination>();
  const names = source.catalog.lookup(PDFName.of('Names'));
  const destinations = names instanceof PDFDict ? names.lookup(PDFName.of('Dests')) : undefined;
  const entries = destinations instanceof PDFDict ? destinations.lookup(PDFName.of('Names')) : undefined;
  if (!(entries instanceof PDFArray)) return result;
  const pages = new Map(source.getPages().map((page, index) => [page.ref.toString(), index]));
  for (let index = 0; index < entries.size(); index += 2) {
    const name = entries.lookup(index);
    if (!(name instanceof PDFString || name instanceof PDFHexString)) continue;
    const id = name.decodeText();
    if (!id.startsWith('volume.')) continue;
    const destination = entries.lookup(index + 1);
    if (!(destination instanceof PDFArray) || destination.size() !== 5) throw new Error(LINK_ERROR);
    const ref = destination.get(0), mode = destination.lookup(1), x = destination.lookup(2), y = destination.lookup(3);
    const page = ref instanceof PDFRef ? pages.get(ref.toString()) : undefined;
    if (page === undefined || mode !== PDFName.of('XYZ') || !(x instanceof PDFNumber) || !(y instanceof PDFNumber)
      || !Number.isFinite(x.asNumber()) || !Number.isFinite(y.asNumber())) throw new Error(LINK_ERROR);
    result.set(id, { page, x: x.asNumber(), y: y.asNumber() });
  }
  return result;
}

/** Resolve links after all package/front-matter copying, using each member's
 * own destination map so identical IDs in different volumes cannot collide. */
export function restoreVolumePdfLinks(pdf: PDFDocument, destinations: ReadonlyMap<string, VolumeDestination>, firstPage: number, pageCount: number): void {
  if (firstPage < 0 || firstPage + pageCount > pdf.getPageCount()) throw new Error(LINK_ERROR);
  for (let pageIndex = firstPage; pageIndex < firstPage + pageCount; pageIndex++) {
    for (const ref of pdf.getPage(pageIndex).node.Annots()?.asArray() ?? []) {
      const annotation = pdf.context.lookup(ref);
      if (!(annotation instanceof PDFDict)) continue;
      const action = annotation.lookup(PDFName.of('A'));
      const owner = action instanceof PDFDict && action.lookup(PDFName.of('S')) === PDFName.of('GoTo') ? action : annotation;
      const key = PDFName.of(owner === annotation ? 'Dest' : 'D');
      const value = owner.lookup(key);
      if (!(value instanceof PDFString || value instanceof PDFHexString || value instanceof PDFName)) continue;
      const id = value.decodeText();
      if (!id.startsWith('volume.')) continue;
      const destination = destinations.get(id);
      if (!destination || destination.page >= pageCount) throw new Error(LINK_ERROR);
      owner.set(key, pdf.context.obj([pdf.getPage(firstPage + destination.page).ref, PDFName.of('XYZ'), destination.x, destination.y, null]));
    }
  }
}

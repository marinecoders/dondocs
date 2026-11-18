import { PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import { packageOutputDestinationSchema, type PackageOutputDestination } from './packageAssemblyModel';
import { appendPublicationOutline } from '@/services/pdf/publicationDestinations';
import type { PackageBoundary, PackageRevision } from './actionPackages';

/** Bookmarks refer to the pages actually copied, independently of printed numbering. */
export function addPackageOutputNavigation(pdf: PDFDocument, revision: PackageRevision, boundaries: readonly PackageBoundary[]): PackageOutputDestination[] {
  const destinations = boundaries.map(boundary => {
    const member = revision.members.find(member => member.id === boundary.memberId);
    if (!member || boundary.startPage < 1 || boundary.pageCount < 1 || boundary.startPage + boundary.pageCount - 1 > pdf.getPageCount())
      throw new Error('A package destination is outside its captured document.');
    return packageOutputDestinationSchema.parse({ ...boundary, label: member.label });
  });
  if (new Set(destinations.map(item => item.memberId)).size !== destinations.length)
    throw new Error('A package member has duplicate PDF destinations.');
  const labels = pdf.context.obj([]), labeledPages = new Set<number>();
  for (const item of destinations) {
    appendPublicationOutline(pdf, item.label, item.startPage - 1);
    if (labeledPages.has(item.startPage)) continue;
    labeledPages.add(item.startPage);
    const numeric = item.numbering === 'continuation' && /^[1-9]\d*$/.test(item.firstPageLabel);
    labels.push(PDFNumber.of(item.startPage - 1));
    labels.push(pdf.context.obj(numeric ? { S: PDFName.of('D'), St: Number(item.firstPageLabel) }
      : { S: PDFName.of('D'), St: 1, P: PDFHexString.fromText(`${item.firstPageLabel} - `) }));
  }
  if (labels.size()) pdf.catalog.set(PDFName.of('PageLabels'), pdf.context.obj({ Nums: labels }));
  return destinations;
}

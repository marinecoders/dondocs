import { PDFDocument, PDFFont, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import type { PackageBoundary, PackageRevision } from './actionPackages';
import { defaultPackageAssemblySettings } from './packageAssemblyModel';

function lines(text: string, font: PDFFont, size: number, width: number): string[] {
  const result: string[] = []; let line = '';
  for (const character of text) {
    const next = line + character;
    if (font.widthOfTextAtSize(next, size) > width && line) { result.push(line.trimEnd()); line = character.trimStart(); }
    else line = next;
  }
  if (line) result.push(line.trimEnd());
  return result.length ? result : [''];
}

/** First measure every row from actual member lengths, then emit the front matter and final linked destinations. */
export async function addPackageFrontMatter(body: PDFDocument, revision: PackageRevision, packageName: string,
  capturedBoundaries: readonly PackageBoundary[]): Promise<{ pdf: PDFDocument; boundaries: PackageBoundary[]; frontMatterPages: number }> {
  const settings = revision.assembly ?? defaultPackageAssemblySettings();
  if (!settings.cover && !settings.contents) return { pdf: body, boundaries: structuredClone([...capturedBoundaries]), frontMatterPages: 0 };
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let title: string[], rows: Array<{ lines: string[]; boundary: PackageBoundary }>;
  try {
    title = lines(packageName, bold, 20, 500);
    rows = capturedBoundaries.map(boundary => ({ boundary, lines: lines(revision.members.find(member => member.id === boundary.memberId)!.label, font, 11, 420) }));
  } catch { throw new Error('A cover or contents label contains characters unsupported by the current PDF font. Rename that label or turn off cover and contents; captured files stay unchanged.'); }
  const plans: typeof rows[] = []; let current: typeof rows = [], used = 0;
  if (settings.contents) for (const row of rows) {
    const height = row.lines.length * 15 + 32;
    if (used + height > 620 && current.length) { plans.push(current); current = []; used = 0; }
    current.push(row); used += height;
  }
  if (settings.contents && current.length) plans.push(current);
  const frontMatterPages = Number(settings.cover) + plans.length;
  const boundaries = capturedBoundaries.map(boundary => ({ ...boundary, startPage: boundary.startPage + frontMatterPages }));
  if (settings.cover) {
    const page = pdf.addPage([612, 792]);
    title.forEach((line, index) => page.drawText(line, { x: 54, y: 660 - index * 27, size: 20, font: bold }));
    page.drawText('Package cover', { x: 54, y: 710, size: 11, font });
    page.drawText(`${capturedBoundaries.length} captured ${capturedBoundaries.length === 1 ? 'document' : 'documents'} | ${settings.profile} assembly`, { x: 54, y: 570 - title.length * 27, size: 11, font });
    page.drawText('Cover and contents use physical PDF positions. Document numbering stays with each member.', { x: 54, y: 70, size: 9, font });
  }
  const links: Array<{ page: import('pdf-lib').PDFPage; rect: number[]; target: number }> = [];
  for (const [index, plan] of plans.entries()) {
    const page = pdf.addPage([612, 792]);
    page.drawText(plans.length > 1 ? `Contents ${index + 1} of ${plans.length}` : 'Contents', { x: 48, y: 730, size: 18, font: bold });
    page.drawText('Document', { x: 48, y: 703, size: 10, font });
    page.drawText('PDF page', { x: 492, y: 703, size: 9, font });
    page.drawText('Printed start', { x: 454, y: 690, size: 8, font });
    let y = 675;
    for (const row of plan) {
      const boundary = boundaries.find(item => item.memberId === row.boundary.memberId)!;
      row.lines.forEach((line, i) => page.drawText(line, { x: 48, y: y - i * 15, size: 11, font }));
      page.drawText(String(boundary.startPage), { x: 492, y, size: 11, font: bold });
      const printed = lines(boundary.firstPageLabel, font, 8, 104).slice(0, 2);
      printed.forEach((line, i) => page.drawText(line, { x: 454, y: y - row.lines.length * 15 - i * 10, size: 8, font }));
      const height = row.lines.length * 15 + 32;
      links.push({ page, rect: [46, y - height + 5, 558, y + 13], target: boundary.startPage });
      y -= height;
    }
    page.drawText('Select a document to open its captured PDF pages.', { x: 48, y: 35, size: 9, font });
  }
  for (const page of await pdf.copyPages(body, body.getPageIndices())) pdf.addPage(page);
  for (const link of links) {
    const annotation = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: link.rect, Border: [0, 0, 0],
      Contents: PDFString.of('Open captured document'), Dest: [pdf.getPage(link.target - 1).ref, PDFName.of('Fit')] }));
    link.page.node.addAnnot(annotation);
  }
  return { pdf, boundaries, frontMatterPages };
}

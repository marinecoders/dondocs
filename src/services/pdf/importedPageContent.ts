import { PDFArray, PDFDict, type PDFDocument, PDFName, type PDFObject, PDFRef, PDFStream } from 'pdf-lib';
import { PDF_RESOURCE_LIMITS } from './validatePdfResources';

const visualPageEntries = new Set([
  'Type', 'Parent', 'Resources', 'Contents', 'Group', 'MediaBox', 'CropBox',
  'BleedBox', 'TrimBox', 'ArtBox', 'Rotate', 'UserUnit',
].map(PDFName.of));
const inheritedEntries = ['Resources', 'MediaBox', 'CropBox', 'Rotate'].map(PDFName.of);
const excludedTypes = new Set([
  'Action', 'Annot', 'Catalog', 'Page', 'Pages', 'Filespec', 'EmbeddedFile',
].map(PDFName.of));
const actionKinds = new Set([
  'GoTo', 'GoToR', 'GoToE', 'GoTo3DView', 'Launch', 'Thread', 'URI', 'Sound',
  'Movie', 'Hide', 'Named', 'SubmitForm', 'ResetForm', 'ImportData', 'JavaScript',
  'SetOCGState', 'Rendition', 'Trans',
].map(PDFName.of));
const excludedKeys = ['AA', 'OpenAction', 'AF', 'EmbeddedFiles', 'RichMediaContent', 'RichMediaSettings'].map(PDFName.of);
const unsafeContent = 'This PDF contains unsupported interactive page resources. Print a flattened PDF in your PDF application and attach that copy.';

/**
 * Keep the visual page graph of a freshly parsed upload. The source byte buffer
 * is retained elsewhere. pdf-lib can copy objects reachable through page
 * entries even when it only draws an embedded page, so trim before either kind
 * of assembly. The page-tree parent is used for inheritance and excluded by
 * the copier itself.
 */
export function retainImportedPageContent(pdf: PDFDocument, signal?: AbortSignal): void {
  const visited = new Set<PDFObject>();
  const visit = (input: PDFObject, depth: number): void => {
    signal?.throwIfAborted();
    const value = input instanceof PDFRef ? pdf.context.lookup(input) : input;
    if (!value) throw new Error('A referenced PDF page resource is missing. Export a readable copy and attach it again.');
    if (visited.has(value)) return;
    if (depth > PDF_RESOURCE_LIMITS.depth || visited.size >= PDF_RESOURCE_LIMITS.resources) {
      throw new Error('PDF page resources are too complex. Split this PDF and try again.');
    }
    visited.add(value);
    if (value instanceof PDFStream) {
      visit(value.dict, depth + 1);
    } else if (value instanceof PDFDict) {
      const type = value.lookup(PDFName.of('Type'));
      const kind = value.lookup(PDFName.of('S'));
      if ((type instanceof PDFName && excludedTypes.has(type))
        || (kind instanceof PDFName && actionKinds.has(kind))
        || excludedKeys.some(key => value.has(key))) throw new Error(unsafeContent);
      for (const [, child] of value.entries()) visit(child, depth + 1);
    } else if (value instanceof PDFArray) {
      for (const child of value.asArray()) visit(child, depth + 1);
    }
  };

  for (const { node } of pdf.getPages()) {
    signal?.throwIfAborted();
    for (const [key, value] of node.entries()) {
      if (!visualPageEntries.has(key)) node.delete(key);
      else if (key !== PDFName.Parent) visit(value, 0);
    }
    for (const key of inheritedEntries) {
      if (node.has(key)) continue;
      const inherited = node.getInheritableAttribute(key);
      if (inherited) visit(inherited, 0);
    }
  }
}

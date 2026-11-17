import { isWord, wordXml, xmlChildren, WORD_IMPORT_LIMITS, WORD_NAMESPACES } from './archive';

type View = 'before' | 'after';
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** Paragraph views deliberately skip foreign objects and incompatible revision
 * branches. Their Word text must not then be suppressed as already inventoried.
 * Fail before import instead of guessing among alternate renderings or splitting
 * hidden runs into an incomplete source inventory. Each nested Word paragraph
 * has its own views, including ordinary text boxes and header/footer fields. */
function assertCompleteInlineInventory(root: Element): void {
  const walk = (element: Element, inParagraph = false, skipped = false, before = true, after = true): void => {
    if (isWord(element, 'p')) {
      inParagraph = true;skipped = false;before = true;after = true;
    } else if (inParagraph) {
      if (!WORD_NAMESPACES.has(element.namespaceURI ?? '') || ['pPr', 'rPr', 'drawing', 'pict'].some(name => isWord(element, name))) skipped = true;
      if (isWord(element, 'ins') || isWord(element, 'moveTo')) before = false;
      if (isWord(element, 'del') || isWord(element, 'moveFrom')) after = false;
    }
    const children = xmlChildren(element);
    const wordText = isWord(element, 't') || isWord(element, 'delText');
    const text = wordText || !children.length ? element.textContent ?? '' : '';
    if (inParagraph && (skipped || !before && !after) && (wordText ? text.length : text.trim().length)) {
      throw new Error('This Word document contains unsupported inline text that cannot be completely inventoried. Flatten the unsupported object or resolve its overlapping revisions in a copy, then import again. Nothing has been imported.');
    }
    for (const child of children) walk(child, inParagraph, skipped, before, after);
  };
  walk(root);
}

/** The original includes comments, discarded revisions and document metadata.
 * Inventory all package-owned XML text and attributes before native shortening;
 * none of these editable values authenticates a reviewer or a return. */
export function retainedWordText(archive: ReadonlyMap<string, Uint8Array>, paragraphText: (paragraph: Element, view: View) => string) {
  const types = wordXml(archive.get('[Content_Types].xml'), 'content types');
  const extensions = new Set(['xml', 'rels']), parts = new Set<string>();
  for (const element of xmlChildren(types.documentElement)) {
    if (element.namespaceURI !== CONTENT_TYPES) continue;
    const type = element.getAttribute('ContentType')?.toLowerCase() ?? '';
    if (!['application/xml', 'text/xml'].includes(type) && !type.endsWith('+xml')) continue;
    if (element.localName === 'Default') extensions.add(element.getAttribute('Extension')?.toLowerCase() ?? '');
    if (element.localName === 'Override') {
      const uri = new URL(element.getAttribute('PartName') ?? '', 'https://word.invalid/');
      if (uri.origin !== 'https://word.invalid' || uri.search || uri.hash) throw new Error('Invalid package-owned XML part.');
      parts.add(decodeURIComponent(uri.pathname).slice(1));
    }
  }
  const values: string[] = [], markings: string[] = [], attributes = new Set<string>();
  let characters = 0;
  const retain = (text: string, header = false) => {
    if (!text.trim()) return;
    characters += text.length + (values.length ? 1 : 0);
    if (characters > WORD_IMPORT_LIMITS.text) throw new Error('This Word file exceeds the retained source-text limit, including its original metadata.');
    values.push(text);
    if (header) markings.push(text);
  };
  for (const [path, bytes] of archive) {
    if (!extensions.has(path.split('.').at(-1)?.toLowerCase() ?? '') && !parts.has(path)) continue;
    const document = wordXml(bytes, path);
    assertCompleteInlineInventory(document.documentElement);
    const header = isWord(document.documentElement, 'hdr') || isWord(document.documentElement, 'ftr');
    for (const element of Array.from(document.getElementsByTagName('*'))) {
      if (isWord(element, 'p')) {
        const before = paragraphText(element, 'before'), after = paragraphText(element, 'after');
        retain(before, header);
        if (after !== before) retain(after, header);
      } else if (!xmlChildren(element).length) {
        let parent = element.parentElement ?? element.parentNode as Element | null;
        while (parent?.nodeType === 1 && !isWord(parent, 'p')) parent = parent.parentNode as Element | null;
        // Paragraph views already join split runs without inventing newlines.
        if (parent?.nodeType !== 1 || !isWord(element, 't') && !isWord(element, 'delText')) retain(element.textContent ?? '', header);
      }
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/' || attribute.name === 'xmlns') continue;
        const value = attribute.value;
        if (attributes.has(value)) continue;
        retain(value, header);attributes.add(value);
      }
    }
  }
  return { text: values.join('\n'), markings: markings.join('\n') };
}

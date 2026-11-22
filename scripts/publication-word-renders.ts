import { DOMParser } from '@xmldom/xmldom';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export type PublicationWordRenderer = 'microsoft-word' | 'libreoffice';
export interface PublicationPageSize { width: number; height: number }
const navigationHeadings = new Set(['TABLE OF CONTENTS', 'LIST OF ILLUSTRATIONS', 'LIST OF TABLES']);
interface ContentsRow { section: string; label: string }
interface ContentsEntry extends ContentsRow { format: 'roman' | 'decimal' }
const contentsKey = ({ section, label }: ContentsRow): string => JSON.stringify([section, label]);
const contentsRow = /^(.+?)(?:\.\s*){3,}(.*?)\s*$/u;
const decimalLabel = /^[1-9][0-9]*$/;
const romanLabel = /^m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;

const elements = (parent: Document | Element, name: string): Element[] => Array.from(parent.getElementsByTagName(name));
// A narrow printed model-number column may wrap MODEL-WIDE after its hyphen.
const normalize = (value: string): string => value.normalize('NFKC').replace(/-\s+/gu, '-').replace(/\s+/gu, ' ').trim();

function containsMarker(text: string, marker: string): boolean {
  let offset = text.indexOf(marker);
  while (offset !== -1) {
    const before = text.slice(Math.max(0, offset - 2), offset);
    const after = text.slice(offset + marker.length, offset + marker.length + 2);
    if ((!/^[\p{L}\p{N}_]/u.test(marker) || !/[\p{L}\p{N}_]$/u.test(before))
      && (!/[\p{L}\p{N}_]$/u.test(marker) || !/^[\p{L}\p{N}_]/u.test(after))) return true;
    offset = text.indexOf(marker, offset + 1);
  }
  return false;
}

function parseXml(source: string): Document {
  const errors: string[] = [];
  const document = new DOMParser({ errorHandler: { warning: () => {}, error: message => errors.push(message), fatalError: message => errors.push(message) } }).parseFromString(source, 'application/xml');
  if (!document?.documentElement || errors.length) throw new Error('The publication layout XML is malformed.');
  return document;
}

/** Read every section's geometry, including the square SL-3 inventory sheets. */
export function publicationWordPageSizes(documentXml: string): PublicationPageSize[] {
  const document = parseXml(documentXml);
  const sizes = Array.from(document.getElementsByTagNameNS(WORD_NS, 'pgSz'), page => ({
    width: Number(page.getAttributeNS(WORD_NS, 'w')) / 20,
    height: Number(page.getAttributeNS(WORD_NS, 'h')) / 20,
  }));
  if (!sizes.length || sizes.some(size => !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0)) {
    throw new Error('The publication Word source has invalid page geometry.');
  }
  return sizes;
}

/** These checks establish measured render evidence, never native edit/save or
 * complete visual qualification. A matching Creator string is not proof that
 * a print belongs to a particular source; the operator must confirm that link.
 */
export function inspectPublicationWordRender(input: {
  renderer: PublicationWordRenderer;
  metadata: string;
  boundingBoxes: string;
  markers: readonly string[];
  pageSizes: readonly PublicationPageSize[];
}): { pages: number; words: number } {
  if (input.renderer !== 'microsoft-word' && input.renderer !== 'libreoffice') throw new Error('Choose a supported publication renderer.');
  const creator = /^Creator:\s*(.+)$/m.exec(input.metadata)?.[1].trim() ?? '';
  const producer = /^Producer:\s*(.+)$/m.exec(input.metadata)?.[1].trim() ?? '';
  if (input.renderer === 'microsoft-word' ? !/^(?:Microsoft(?:®)?\s+)?Word\b/.test(creator) : !/LibreOffice/.test(producer)) {
    throw new Error(`The retained PDF does not identify ${input.renderer}; retain the actual renderer output.`);
  }
  const document = parseXml(input.boundingBoxes);
  const pages = elements(document, 'page');
  if (!pages.length) throw new Error('The publication render contains no measured pages.');
  const words: Element[] = [];
  for (const [index, page] of pages.entries()) {
    const width = Number(page.getAttribute('width')), height = Number(page.getAttribute('height'));
    if (!input.pageSizes.some(size => Math.abs(size.width - width) < 1 && Math.abs(size.height - height) < 1)) {
      throw new Error(`Page ${index + 1}: printed geometry does not match any source section.`);
    }
    for (const word of elements(page, 'word')) {
      const coordinates = ['xMin', 'yMin', 'xMax', 'yMax'].map(attribute => word.hasAttribute(attribute) ? Number(word.getAttribute(attribute)) : Number.NaN);
      const [left, top, right, bottom] = coordinates;
      if (coordinates.some(value => !Number.isFinite(value)) || right < left || bottom < top
        || left < -1 || top < -1 || right > width + 1 || bottom > height + 1) {
        throw new Error(`Page ${index + 1}: printed text extends beyond the page or has invalid bounds.`);
      }
      words.push(word);
    }
  }
  const text = normalize(words.map(word => word.textContent ?? '').join(' '));
  if (!text) throw new Error('The publication render has no searchable text.');
  if (/\{\{(?:PUBREF|VOLREF)_/i.test(text)) throw new Error('The publication render contains an unresolved cross-reference.');
  for (const marker of input.markers) {
    if (!normalize(marker) || !containsMarker(text, normalize(marker))) throw new Error(`The publication render lost required content: ${marker}`);
  }
  return { pages: pages.length, words: words.length };
}

/** Check the exact OOXML used for the print. A rendered page can contain the
 * expected text even when the Word contents links or page fields are broken.
 */
export function inspectPublicationWordNavigation(documentXml: string): { bookmarks: number; internalLinks: number; pageReferences: number; contentsEntries: ContentsEntry[]; linkOnlyEntries: ContentsRow[] } {
  const ns = WORD_NS;
  const document = parseXml(documentXml);
  if (document.documentElement.namespaceURI !== ns || document.documentElement.localName !== 'document') {
    throw new Error('The publication has an invalid Word document root.');
  }
  const bodies = document.getElementsByTagNameNS(ns, 'body');
  const body = bodies.item(0);
  if (!body || bodies.length !== 1) throw new Error('The publication navigation has no Word body.');
  const names = new Set<string>(), foldedNames = new Set<string>(), starts = new Set<string>(), active = new Set<string>();
  const bookmarkId = (node: Element) => {
    const raw = node.getAttributeNS(ns, 'id');
    return raw !== null && /^\d{1,10}$/.test(raw) && Number(raw) <= 2_147_483_647 ? String(Number(raw)) : null;
  };
  let internalLinks = 0, pageReferences = 0;
  const targets: string[] = [];
  const linksByParagraph = new Map<Element, { anchor: string; label: string }[]>();
  const navigationLinks: { paragraph: Element; section: string; label: string }[] = [];
  const fields: { paragraph: Element; anchor: string; section: string; format: ContentsEntry['format'] }[] = [];
  const paragraphText = (node: Element) => normalize(Array.from(node.getElementsByTagNameNS(ns, 't'), content => content.textContent ?? '').join(''));
  let section: string | undefined;
  const containingParagraph = (node: Element): Element | null => {
    const parent = node.parentNode;
    if (parent?.nodeType !== 1) return null;
    const element = parent as Element;
    return element.namespaceURI === ns && element.localName === 'p' ? element : null;
  };
  for (const node of Array.from(body.getElementsByTagNameNS(ns, '*'))) {
    if (node.localName === 'p' && node.parentNode === body) {
      const style = node.getElementsByTagNameNS(ns, 'pStyle').item(0)?.getAttributeNS(ns, 'val') ?? '';
      if (/^Heading[1-3]$/.test(style)) {
        const heading = paragraphText(node);
        section = navigationHeadings.has(heading) ? heading : undefined;
      }
    } else if (node.localName === 'bookmarkStart') {
      const name = node.getAttributeNS(ns, 'name'), id = bookmarkId(node);
      if (!name || id === null || foldedNames.has(name.toLowerCase()) || starts.has(id)) {
        throw new Error('The publication has missing or duplicate Word bookmark identities.');
      }
      names.add(name);
      foldedNames.add(name.toLowerCase());
      starts.add(id);
      active.add(id);
    } else if (node.localName === 'bookmarkEnd') {
      const id = bookmarkId(node);
      if (id === null || !active.delete(id)) throw new Error('The publication has an unmatched Word bookmark end.');
    } else if (node.localName === 'hyperlink') {
      const name = node.getAttributeNS(ns, 'anchor');
      if (name) {
        targets.push(name);
        internalLinks++;
        const paragraph = containingParagraph(node);
        if (paragraph) {
          const links = linksByParagraph.get(paragraph) ?? [];
          const label = paragraphText(node);
          links.push({ anchor: name, label });
          linksByParagraph.set(paragraph, links);
          if (section && paragraph.parentNode === body && label && label === paragraphText(paragraph)) {
            navigationLinks.push({ paragraph, section, label });
          }
        }
      }
    } else if (node.localName === 'fldSimple') {
      const instruction = node.getAttributeNS(ns, 'instr')?.trim() ?? '';
      if (/^PAGEREF\b/i.test(instruction)) {
        const name = /^PAGEREF\s+([A-Za-z_][A-Za-z0-9_]*)(?=\s|$)/i.exec(instruction)?.[1];
        const paragraph = containingParagraph(node);
        const format = /(?:^|\s)\\\*\s+(roman|Arabic)(?=\s|$)/.exec(instruction)?.[1];
        if (!name || !paragraph || !format || !section) {
          throw new Error('The publication has a malformed Word PAGEREF field.');
        }
        targets.push(name);
        fields.push({ paragraph, anchor: name, section, format: format === 'roman' ? 'roman' : 'decimal' });
        pageReferences++;
      }
    }
  }
  if (active.size) throw new Error('The publication has an unmatched Word bookmark start.');
  for (const target of targets) {
    if (!names.has(target)) throw new Error(`The publication has an unresolved Word bookmark target: ${target}.`);
  }
  const paired = new Set<Element>();
  const contentsEntries: ContentsEntry[] = [];
  for (const { paragraph, anchor, section, format } of fields) {
    const links = linksByParagraph.get(paragraph);
    if (links?.length !== 1 || links[0].anchor !== anchor || paired.has(paragraph)) {
      throw new Error(`The publication contents link and its Word PAGEREF field disagree: ${anchor}.`);
    }
    const { label } = links[0];
    if (!label) throw new Error(`The publication contents row has no label: ${anchor}.`);
    contentsEntries.push({ section, label, format });
    paired.add(paragraph);
  }
  const linkOnlyEntries = navigationLinks.filter(({ paragraph }) => !paired.has(paragraph))
    .map(({ section, label }) => ({ section, label }));
  return { bookmarks: names.size, internalLinks, pageReferences, contentsEntries, linkOnlyEntries };
}

/** Measure the printed contents labels independently of the DOCX field code.
 * Unknown rows require inspection of the printed pages.
 */
export function inspectPrintedContentsLabels(layoutText: string, entries: readonly ContentsEntry[], linkOnlyEntries: readonly ContentsRow[] = []) {
  const labels = new Map<string, { value: string; page: number }[]>();
  const linkOnly = new Set(linkOnlyEntries.map(contentsKey));
  for (const [pageIndex, page] of layoutText.split('\f').entries()) {
    let section: string | undefined;
    let foundRow = false;
    for (const raw of page.split(/\r?\n/)) {
      const line = raw.trim();
      const heading = normalize(line);
      if (navigationHeadings.has(heading)) {
        section = heading;
        foundRow = false;
      } else if (section && (line || foundRow)) {
        const match = contentsRow.exec(line);
        if (!match) {
          if (linkOnly.has(contentsKey({ section, label: heading }))) continue;
          section = undefined;
          continue;
        }
        const key = contentsKey({ section, label: normalize(match[1]) });
        const values = labels.get(key) ?? [];
        values.push({ value: match[2], page: pageIndex + 1 });
        labels.set(key, values);
        foundRow = true;
      }
    }
  }

  const counts = new Map<string, number>();
  for (const { section, label } of entries) {
    const key = contentsKey({ section, label });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return entries.map(entry => {
    const key = contentsKey(entry);
    const observations = labels.get(key) ?? [];
    const printed = observations.map(({ value }) => value);
    if (!printed.length) return { ...entry, printed, result: 'missing' } as const;
    if (printed.length !== 1 || counts.get(key) !== 1) return { ...entry, printed, result: 'ambiguous' } as const;
    const value = printed[0];
    const correctFormat = entry.format === 'decimal' ? decimalLabel.test(value) : !!value && romanLabel.test(value);
    return { ...entry, printed, printedPage: observations[0].page, result: correctFormat ? 'matches-format' : 'wrong-format' } as const;
  });
}

type PrintedContentsRow = ReturnType<typeof inspectPrintedContentsLabels>[number];

const pdfKey = (key: string) => PDFName.of(key);

/** Index the document's destination name tree once. Treat duplicate entries
 * as ambiguous and visit each node once even if a print has a cyclic tree. */
function publicationNamedDestinations(pdf: PDFDocument): ReadonlyMap<string, PDFObject | undefined> {
  const result = new Map<string, PDFObject | undefined>();
  const names = pdf.catalog.lookup(pdfKey('Names'));
  const root = names instanceof PDFDict ? names.lookup(pdfKey('Dests')) : undefined;
  if (!(root instanceof PDFDict)) return result;
  const pending = [root];
  const seen = new Set<PDFDict>();
  while (pending.length) {
    const node = pending.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const entries = node.lookup(pdfKey('Names'));
    if (entries instanceof PDFArray) {
      for (let index = 0; index + 1 < entries.size(); index += 2) {
        const key = entries.lookup(index);
        if (!(key instanceof PDFString || key instanceof PDFHexString)) continue;
        const name = key.decodeText();
        result.set(name, result.has(name) ? undefined : entries.lookup(index + 1));
      }
    }
    const children = node.lookup(pdfKey('Kids'));
    if (children instanceof PDFArray) {
      for (let index = 0; index < children.size(); index++) {
        const child = children.lookup(index);
        if (child instanceof PDFDict && !seen.has(child)) pending.push(child);
      }
    }
  }
  return result;
}

/** Bind each unambiguous printed row to a PDF link and read its target's visible
 * footer. A missing link or footer remains a review finding, never a match. */
export async function inspectPublicationContentsDestinations(
  pdfBytes: Uint8Array,
  boundingBoxes: string,
  contents: readonly PrintedContentsRow[],
  linkOnlyEntries: readonly ContentsRow[] = [],
) {
  const pdf = await PDFDocument.load(pdfBytes);
  const pdfPages = pdf.getPages();
  const pages = elements(parseXml(boundingBoxes), 'page');
  if (pages.length !== pdfPages.length) throw new Error('Contents destination inspection requires bounds for every printed page.');
  const name = pdfKey;
  const bounds = (node: Element, key: string) => node.hasAttribute(key) ? Number(node.getAttribute(key)) : Number.NaN;
  const lines = pages.map(page => elements(page, 'line').map(line => ({
    text: normalize(elements(line, 'word').map(word => word.textContent ?? '').join(' ')),
    top: bounds(line, 'yMin'), bottom: bounds(line, 'yMax'),
    left: bounds(line, 'xMin'), right: bounds(line, 'xMax'),
  })));
  const linkOnly = new Set(linkOnlyEntries.map(contentsKey));
  const contentsRows = lines.map(rows => {
    let section: string | undefined;
    return rows.flatMap(row => {
      if (navigationHeadings.has(row.text)) {
        section = row.text;
        return [];
      }
      if (!row.text || !section) return [];
      const match = contentsRow.exec(row.text);
      if (!match) {
        if (linkOnly.has(contentsKey({ section, label: row.text }))) return [];
        section = undefined;
        return [];
      }
      return [{ ...row, section, label: normalize(match[1]), value: match[2] }];
    });
  });
  const supportedGeometry = pdfPages.map(page => {
    const media = page.getMediaBox();
    return page.getRotation().angle % 360 === 0 && media.x === 0 && media.y === 0;
  });
  const footers = lines.map((rows, page) => {
    if (!supportedGeometry[page]) return [];
    const height = pdfPages[page].getHeight();
    return rows.filter(({ text, top }) => top >= height - 48 && (decimalLabel.test(text) || (!!text && romanLabel.test(text))));
  });
  const pageIndexByRef = new Map(pdfPages.map((page, index) => [page.ref.toString(), index]));
  const named = publicationNamedDestinations(pdf);
  const legacy = pdf.catalog.lookup(name('Dests'));
  const links = pdfPages.map((page, index) => {
    if (!supportedGeometry[index]) return [];
    return (page.node.Annots()?.asArray() ?? []).flatMap(ref => {
      const annotation = pdf.context.lookupMaybe(ref, PDFDict);
      if (annotation?.get(name('Subtype')) !== name('Link')) return [];
      const action = annotation.lookup(name('A'));
      let destination = annotation.lookup(name('Dest'));
      if (action !== undefined) {
        destination = !destination && action instanceof PDFDict && action.lookup(name('S')) === name('GoTo')
          ? action.lookup(name('D')) : undefined;
      }
      if (destination instanceof PDFName || destination instanceof PDFString || destination instanceof PDFHexString) {
        destination = destination instanceof PDFName && legacy instanceof PDFDict && legacy.has(destination)
          ? legacy.lookup(destination) : named.get(destination.decodeText());
      }
      if (destination instanceof PDFDict) destination = destination.lookup(name('D'));
      const pageRef = destination instanceof PDFArray ? destination.get(0) : undefined;
      const targetPage = pageRef instanceof PDFRef ? pageIndexByRef.get(pageRef.toString()) : undefined;
      const rect = annotation.lookupMaybe(name('Rect'), PDFArray);
      if (rect?.size() !== 4) return [];
      const top = page.getHeight() - (rect.lookupMaybe(3, PDFNumber)?.asNumber() ?? Number.NaN);
      const bottom = page.getHeight() - (rect.lookupMaybe(1, PDFNumber)?.asNumber() ?? Number.NaN);
      const left = rect.lookupMaybe(0, PDFNumber)?.asNumber() ?? Number.NaN;
      const right = rect.lookupMaybe(2, PDFNumber)?.asNumber() ?? Number.NaN;
      return top < bottom && left < right ? [{ targetPage, top, bottom, left, right }] : [];
    });
  });
  return contents.map(entry => {
    if (!('printedPage' in entry)) return { ...entry, destinationCheck: 'unresolved' } as const;
    const [printed] = entry.printed;
    const page = entry.printedPage - 1;
    const label = normalize(entry.label);
    const matches = contentsRows[page]?.filter(row => row.section === entry.section && row.label === label && row.value === printed) ?? [];
    if (matches.length !== 1) return { ...entry, destinationCheck: 'unresolved' } as const;
    const [row] = matches;
    const midpoint = (row.top + row.bottom) / 2;
    const targets = [...new Set(links[page].filter(link =>
      midpoint >= link.top && midpoint <= link.bottom && row.left <= link.right && row.right >= link.left).map(link => link.targetPage))];
    if (targets.length !== 1 || targets[0] === undefined) return { ...entry, destinationCheck: 'unresolved' } as const;
    const [target] = targets;
    const [footer] = footers[target].length === 1 ? footers[target] : [];
    if (!footer) return { ...entry, destinationPage: target + 1, destinationCheck: 'unresolved' } as const;
    return { ...entry, destinationPage: target + 1, destinationLabel: footer.text,
      destinationCheck: footer.text === printed ? 'matches' : 'differs' } as const;
  });
}

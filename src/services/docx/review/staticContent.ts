import { readWordArchive, isWord, wordAttribute, wordChildren, wordDescendants, wordXml, WORD_REL_NAMESPACES, xmlChildren } from '../import/archive';
import { readWordParagraphText } from '../import/readWord';
import { reviewPayloadDigest } from '@/lib/reviewRounds';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
interface Relationship { type: string; target: string; external: boolean }
type HeaderToken = string | { hyperlink: ReturnType<typeof hyperlinkProperties> } | { drawing: { role: string; description: string; title: string } } | { relationship: unknown } | { field: string; result?: HeaderToken[] };
function partTarget(part: string, target: string): string {
  const url = new URL(target, `https://word.invalid/${part}`), path = decodeURIComponent(url.pathname).slice(1);
  if (!target || url.origin !== 'https://word.invalid' || url.search || url.hash || path.includes('\\') || path.split('/').some(piece => piece === '.' || piece === '..')) throw new Error('An unsupported Word header/footer relationship requires manual review.');
  return path;
}
function relationships(xml: Uint8Array | undefined): Map<string, Relationship> {
  if (!xml) return new Map();
  const root = wordXml(xml, 'header/footer relationships').documentElement, result = new Map<string, Relationship>();
  if (root.namespaceURI !== REL || root.localName !== 'Relationships') throw new Error('Unsupported Word header/footer relationships.');
  for (const relation of xmlChildren(root)) {
    const id = relation.getAttribute('Id') ?? '';
    if (relation.namespaceURI !== REL || relation.localName !== 'Relationship' || !id || result.has(id)) throw new Error('Ambiguous Word header/footer relationships.');
    result.set(id, { type: relation.getAttribute('Type') ?? '', target: relation.getAttribute('Target') ?? '', external: relation.getAttribute('TargetMode') === 'External' });
  }
  return result;
}
function hyperlinkProperties(element: Element) {
  return { anchor: wordAttribute(element, 'anchor') ?? '', location: wordAttribute(element, 'docLocation') ?? '', tooltip: wordAttribute(element, 'tooltip') ?? '' };
}
/** Bind repeated displayed phrases to their actual occurrence in the owner.
 * Surrounding text may change length and runs may split without moving a link;
 * the same phrase elsewhere in that paragraph cannot silently replace it. */
function hyperlinkOccurrence(element: Element, view: 'before' | 'after', text: string): number | null {
  if (!text) return null;
  const ancestors = new Set<Element>([element]);
  let paragraph = element.parentNode;
  while (paragraph?.nodeType === 1) {
    ancestors.add(paragraph as Element);
    if (isWord(paragraph as Element, 'p')) break;
    paragraph = paragraph.parentNode;
  }
  if (paragraph?.nodeType !== 1) throw new Error('A Word hyperlink has no supported paragraph association.');
  let found = false;
  const prefix = (node: Element): string => {
    if (node === element) { found = true;return ''; }
    if (!ancestors.has(node)) return readWordParagraphText(node, view, false, () => {});
    if (view === 'before' && (isWord(node, 'ins') || isWord(node, 'moveTo'))
      || view === 'after' && (isWord(node, 'del') || isWord(node, 'moveFrom'))) return '';
    let value = '';
    for (const child of wordChildren(node)) { if (found) break;value += prefix(child); }
    return value;
  };
  const start = prefix(paragraph as Element).length, content = readWordParagraphText(paragraph as Element, view, false, () => {});
  if (!found || content.slice(start, start + text.length) !== text) throw new Error('The Word hyperlink display association requires manual review.');
  for (let at = content.indexOf(text), ordinal = 0; at >= 0; at = content.indexOf(text, at + 1), ordinal++) {
    if (at === start) return ordinal;
  }
  throw new Error('The Word hyperlink display association is ambiguous.');
}
/** Structural ownership excludes runs, relationship IDs and editable text. */
function bodyOwnerPath(element: Element, body: Element): string[] {
  const result: string[] = [];
  let current: Element = element;
  while (current !== body) {
    const parent = current.parentNode;
    if (!parent || parent.nodeType !== 1) throw new Error('A Word source object has no supported body owner.');
    const container = parent as Element;
    if (container === body) {
      const blocks = xmlChildren(body).filter(child => isWord(child, 'p') || isWord(child, 'tbl'));
      const index = blocks.indexOf(current);
      if (index < 0) throw new Error('A Word source object has an unsupported body owner.');
      result.unshift(`${current.localName}:${index}`);
    } else if (['p', 'tbl', 'tr', 'tc'].some(name => isWord(current, name))) {
      const index = wordChildren(container, current.localName).indexOf(current);
      if (index < 0) throw new Error('A Word source object has an ambiguous structural owner.');
      result.unshift(`${current.localName}:${index}`);
    }
    current = container;
  }
  return result;
}
const normalizedField = (value: string) => value.trim().replace(/\s+/g, ' ');
function headerContent(root: Element, relations: Map<string, unknown>): HeaderToken[] {
  const tokens: HeaderToken[] = [];
  let field: { instruction: string; result: HeaderToken[] } | undefined;
  const append = (token: HeaderToken, target = field?.result ?? tokens) => {
    if (typeof token === 'string' && typeof target.at(-1) === 'string') target[target.length - 1] += token;
    else target.push(token);
  };
  const fieldToken = (instruction: string, result: HeaderToken[]): HeaderToken => {
    const normalized = normalizedField(instruction);
    // Only pagination fields with ordinary numeric/Roman cached results are
    // dynamic. DOCPROPERTY, REF and other results remain reviewed content.
    // Whitespace is normalized above. Keep each case-insensitive alternative
    // unique so repeated switches cannot create exponential backtracking.
    const pagination = /^(?:PAGE|NUMPAGES|SECTIONPAGES)(?: \\\* (?:MERGEFORMAT|Arabic|roman|alphabetic))*$/i.test(normalized);
    const pageResult = result.every(token => typeof token === 'string' && /^[\s\dIVXLCDMivxlcdm-]*$/.test(token));
    return { field: normalized, ...(pagination && pageResult ? {} : { result }) };
  };
  const walk = (element: Element) => {
    if (['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange', 'pPrChange', 'sectPrChange'].some(name => isWord(element, name))) throw new Error('Tracked header/footer changes require manual Word review.');
    if (isWord(element, 'fldSimple')) {
      if (field) throw new Error('Nested Word header/footer fields require manual review.');
      field = { instruction: wordAttribute(element, 'instr') ?? '', result: [] };
      for (const child of xmlChildren(element)) walk(child);
      const completed = field;field = undefined;append(fieldToken(completed.instruction, completed.result));return;
    }
    if (isWord(element, 'fldChar')) {
      const kind = wordAttribute(element, 'fldCharType');
      if (kind === 'begin') { if (field) throw new Error('Nested Word header/footer fields require manual review.');field = { instruction: '', result: [] }; }
      else if (kind === 'end') {
        if (!field) throw new Error('Unbalanced Word header/footer fields require manual review.');
        const completed = field;field = undefined;append(fieldToken(completed.instruction, completed.result));
      }
      return;
    }
    if (isWord(element, 'instrText')) { if (!field) throw new Error('Unbound Word header/footer field instructions require manual review.');field.instruction += element.textContent ?? '';return; }
    if (isWord(element, 't') || isWord(element, 'delText')) { append(element.textContent ?? '');return; }
    if (isWord(element, 'tab')) { append('\t');return; }
    if (isWord(element, 'br') || isWord(element, 'cr')) { append('\n');return; }
    if (['docPr', 'cNvPr'].includes(element.localName) && /^http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/(?:wordprocessingDrawing|picture)$/.test(element.namespaceURI ?? '')) {
      append({ drawing: { role: element.localName, description: element.getAttribute('descr') ?? '', title: element.getAttribute('title') ?? '' } });
    }
    if (isWord(element, 'hyperlink')) append({ hyperlink: hyperlinkProperties(element) });
    for (const attribute of Array.from(element.attributes)) if (WORD_REL_NAMESPACES.has(attribute.namespaceURI ?? '') && ['id', 'embed', 'link'].includes(attribute.localName)) {
      if (!relations.has(attribute.value)) throw new Error('A Word header/footer relationship is missing.');
      append({ relationship: relations.get(attribute.value) });
    }
    for (const child of xmlChildren(element)) walk(child);
    if (isWord(element, 'p')) append('\n');
  };
  walk(root);
  if (field) throw new Error('Unbalanced Word header/footer fields require manual review.');
  return tokens;
}

/** Bind actual section/type references and in-content relationship occurrences.
 * Editable Word part names/IDs cannot substitute another header, image or link.
 * Visual formatting is deliberately outside native text review.
 */
export async function wordReviewStaticDigest(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  const archive = await readWordArchive(bytes, signal), mainRelations = relationships(archive.get('word/_rels/document.xml.rels'));
  const document = wordXml(archive.get('word/document.xml'), 'document'), headers = new Map<string, HeaderToken[]>(), resources = new Map<string, string>();
  const body = wordChildren(document.documentElement, 'body')[0];
  if (!body || ['fldSimple', 'fldChar', 'instrText', 'sdt', 'customXml'].some(name => wordDescendants(body, name).length)) throw new Error('Body Word fields require manual review; only ordinary matched paragraph text can be returned.');
  if (['footnoteReference', 'endnoteReference', 'altChunk', 'subDoc'].some(name => wordDescendants(body, name).length)) throw new Error('Unsupported Word body notes or embedded content require manual review.');
  const allowedBody = ['p', 'tbl', 'sectPr', 'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'proofErr', 'permStart', 'permEnd'];
  if (xmlChildren(body).some(element => !allowedBody.some(name => isWord(element, name)))) throw new Error('This Word return contains unsupported body structures. Keep it for manual review.');
  const resolve = async (part: string, source: Map<string, Relationship>) => {
    const resolved = new Map<string, unknown>();
    for (const [id, resource] of source) {
      signal?.throwIfAborted();
      if (resource.external) resolved.set(id, { type: resource.type, external: resource.target });
      else {
        const path = partTarget(part, resource.target), data = archive.get(path);
        if (!data) throw new Error('A Word drawing or header/footer resource is missing.');
        let digest = resources.get(path);
        if (!digest) {
          if (!(data.buffer instanceof ArrayBuffer)) throw new Error('A Word resource uses unsupported shared memory.');
          digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data.buffer, data.byteOffset, data.byteLength)))).map(byte => byte.toString(16).padStart(2, '0')).join('');resources.set(path, digest);
        }
        resolved.set(id, { type: resource.type, digest });
      }
    }
    return resolved;
  };
  const drawingElements = Array.from(body.getElementsByTagName('*')).filter(element => ['drawing', 'pict', 'object'].some(name => isWord(element, name)));
  const linkElements = wordDescendants(body, 'hyperlink');
  if (drawingElements.length + linkElements.length > 2000) throw new Error('This Word review exceeds its supported drawing and hyperlink count.');
  const drawingRelations = new Map<string, Relationship>();
  for (const drawing of drawingElements) for (const element of [drawing, ...Array.from(drawing.getElementsByTagName('*'))]) {
    for (const attribute of Array.from(element.attributes)) if (WORD_REL_NAMESPACES.has(attribute.namespaceURI ?? '') && ['id', 'embed', 'link'].includes(attribute.localName)) {
      const relation = mainRelations.get(attribute.value);
      if (!relation) throw new Error('A body drawing relationship is missing.');drawingRelations.set(attribute.value, relation);
    }
  }
  const resolvedDrawings = await resolve('word/document.xml', drawingRelations);
  const bodyDrawings = drawingElements.map(element => ({ owner: bodyOwnerPath(element, body), kind: element.localName, content: headerContent(element, resolvedDrawings) }));
  const bodyLinks = linkElements.map(element => {
    let id: string | null = null;
    for (const namespace of WORD_REL_NAMESPACES) id ??= element.getAttributeNS(namespace, 'id');
    const target = id ? mainRelations.get(id) : undefined;
    if (id && (!target || !target.external || ![...WORD_REL_NAMESPACES].some(namespace => target.type === `${namespace}/hyperlink`))) throw new Error('This Word hyperlink requires manual destination review.');
    const before = readWordParagraphText(element, 'before', false, () => {}), after = readWordParagraphText(element, 'after', false, () => {});
    return { owner: bodyOwnerPath(element, body), target: target?.target ?? '', ...hyperlinkProperties(element), before, after,
      beforeOccurrence: hyperlinkOccurrence(element, 'before', before), afterOccurrence: hyperlinkOccurrence(element, 'after', after) };
  });
  const sections: Array<Array<{ kind: string; type: string; content: HeaderToken[] }>> = [];
  for (const section of wordDescendants(document.documentElement, 'sectPr')) {
    const references: Array<{ kind: string; type: string; content: HeaderToken[] }> = [], seen = new Set<string>();
    for (const reference of wordChildren(section)) {
      const kind = isWord(reference, 'headerReference') ? 'header' : isWord(reference, 'footerReference') ? 'footer' : null;
      if (!kind) continue;
      signal?.throwIfAborted();
      const type = wordAttribute(reference, 'type') ?? '', key = `${kind}:${type}`;
      if (!['default', 'first', 'even'].includes(type) || seen.has(key)) throw new Error('Ambiguous Word section header/footer bindings require manual review.');
      seen.add(key);
      let id: string | null = null;
      for (const namespace of WORD_REL_NAMESPACES) id ??= reference.getAttributeNS(namespace, 'id');
      const relation = id && mainRelations.get(id);
      if (!relation || relation.external || ![...WORD_REL_NAMESPACES].some(namespace => relation.type === `${namespace}/${kind}`)) throw new Error('A Word section header/footer is missing or unsupported.');
      const part = partTarget('word/document.xml', relation.target);
      let content = headers.get(part);
      if (!content) {
        const root = wordXml(archive.get(part), kind).documentElement;
        if (!isWord(root, kind === 'header' ? 'hdr' : 'ftr')) throw new Error('Unsupported Word header/footer XML.');
        const slash = part.lastIndexOf('/'), relsName = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
        const resolved = await resolve(part, relationships(archive.get(relsName)));
        content = headerContent(root, resolved);headers.set(part, content);
      }
      references.push({ kind, type, content });
    }
    references.sort((left, right) => `${left.kind}:${left.type}`.localeCompare(`${right.kind}:${right.type}`));sections.push(references);
  }
  signal?.throwIfAborted();
  return reviewPayloadDigest({ sections, bodyDrawings, bodyLinks });
}

import JSZip from 'jszip';

export const WORD_IMPORT_LIMITS = { compressedBytes: 20 * 1024 * 1024, expandedBytes: 48 * 1024 * 1024, entryBytes: 10 * 1024 * 1024, xmlBytes: 4 * 1024 * 1024, entries: 512, nodes: 50_000, paragraphs: 1_000, text: 200_000, images: 30 } as const;
interface StreamingZipFile extends JSZip.JSZipObject { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }
const decoder = new TextDecoder('utf-8', { fatal: true });

function checkDirectory(bytes: Uint8Array): Set<string> {
  if (bytes.byteLength > WORD_IMPORT_LIMITS.compressedBytes) throw new Error('Word files must be smaller than 20 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65_557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < 0 || end < bytes.length - 65_557 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('This is not a supported Word ZIP archive.');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (!count || count > WORD_IMPORT_LIMITS.entries || view.getUint16(end + 8, true) !== count || start + size !== end) throw new Error('This Word archive has too many files or an invalid directory.');
  let offset = start;
  const names = new Set<string>(), folded = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid Word ZIP directory.');
    const flags = view.getUint16(offset + 8, true), length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    if (flags & 1 || offset + 46 + length + extra + comment > end) throw new Error('Encrypted or malformed Word archives are not supported.');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + length));
    // eslint-disable-next-line no-control-regex -- Reject controls in untrusted Word paths and filenames.
    if (!name || /[\\\u0000-\u001f]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..') || folded.has(name.toLowerCase())) throw new Error('Word archive paths must be unique and remain inside the document.');
    names.add(name); folded.add(name.toLowerCase()); offset += 46 + length + extra + comment;
  }
  if (offset !== end) throw new Error('Invalid Word ZIP directory length.');
  return names;
}

export async function readWordArchive(bytes: Uint8Array, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
  const expectedNames = checkDirectory(bytes); signal?.throwIfAborted();
  const zip = await JSZip.loadAsync(bytes);
  // ZIP Unicode Path extras and normalization can change names after the
  // directory was checked, including collapsing two distinct source entries.
  if (Object.keys(zip.files).length !== expectedNames.size || Object.keys(zip.files).some(name => !expectedNames.has(name))) throw new Error('This Word archive contains conflicting or aliased file paths.');
  const result = new Map<string, Uint8Array>();
  let total = 0;
  for (const file of Object.values(zip.files)) {
    signal?.throwIfAborted();
    if (file.unsafeOriginalName && file.unsafeOriginalName !== file.name) throw new Error('Invalid Word archive path.');
    if (file.dir) continue;
    // Content types may name XML parts with arbitrary extensions. Keep the
    // bounded package while inventorying it, then release unused binary parts.
    const chunks: Uint8Array[] = []; let size = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = (file as StreamingZipFile).internalStream('uint8array');
      let stopped = false;
      const stop = (error: unknown) => { if (stopped) return; stopped = true; stream.pause(); signal?.removeEventListener('abort', abort); reject(error); };
      const abort = () => stop(signal?.reason ?? new Error('Word import cancelled.'));
      signal?.addEventListener('abort', abort, { once: true });
      stream.on('data', chunk => {
        if (stopped) return;
        total += chunk.byteLength; size += chunk.byteLength;
        if (total > WORD_IMPORT_LIMITS.expandedBytes || size > WORD_IMPORT_LIMITS.entryBytes || /\.(xml|rels)$/i.test(file.name) && size > WORD_IMPORT_LIMITS.xmlBytes) {
          stop(new Error('This Word document exceeds the expanded-content limit.')); return;
        }
        chunks.push(chunk.slice());
      }).on('error', stop).on('end', () => { if (!stopped) { signal?.removeEventListener('abort', abort); resolve(); } }).resume();
    });
    const content = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
    result.set(file.name, content);
  }
  return result;
}

export function wordXml(bytes: Uint8Array | undefined, label: string): Document {
  if (!bytes) throw new Error(`The Word document is missing ${label}.`);
  if (bytes.byteLength > WORD_IMPORT_LIMITS.xmlBytes) throw new Error(`The Word ${label} XML exceeds its text limit.`);
  const text = decoder.decode(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) throw new Error('Word XML declarations with entities are not supported.');
  let depth = 0, nodes = 0;
  for (const token of text.matchAll(/<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)) {
    if (/^<[!?]/.test(token[0])) continue;
    if (token[0].startsWith('</')) depth--;
    else { if (++nodes > WORD_IMPORT_LIMITS.nodes) throw new Error(`The Word ${label} XML is too complex.`); if (!token[0].endsWith('/>')) depth++; }
    if (depth > 64) throw new Error(`The Word ${label} XML is nested too deeply.`);
  }
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length || document.getElementsByTagName('*').length > WORD_IMPORT_LIMITS.nodes) throw new Error(`The Word ${label} XML is malformed or too complex.`);
  return document;
}

export const WORD_NAMESPACES = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
export const WORD_REL_NAMESPACES = new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships']);
export function isWord(element: Element, localName: string): boolean { return WORD_NAMESPACES.has(element.namespaceURI ?? '') && element.localName === localName; }
export function xmlChildren(element: Element): Element[] { return Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1); }
export function wordChildren(element: Element, name?: string): Element[] { return xmlChildren(element).filter(child => WORD_NAMESPACES.has(child.namespaceURI ?? '') && (!name || child.localName === name)); }
export function wordDescendants(element: Element | Document, name: string): Element[] { return Array.from(element.getElementsByTagName('*')).filter(child => child.localName === name && WORD_NAMESPACES.has(child.namespaceURI ?? '')); }
export function wordAttribute(element: Element, name: string): string | null { for (const namespace of WORD_NAMESPACES) { const value = element.getAttributeNS(namespace, name); if (value !== null) return value; } return null; }

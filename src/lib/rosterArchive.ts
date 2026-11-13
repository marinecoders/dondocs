import JSZip from 'jszip';

interface ArchiveLimits {
  expandedBytes: number;
  entries: number;
  rows: number;
  columns: number;
  cells: number;
}

// This documented public API is missing from JSZip 3.10.1's bundled types.
interface StreamingZipFile extends JSZip.JSZipObject {
  internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
}

export class RosterArchiveError extends Error {}

function xmlDocument(xml: string) {
  // Workbook metadata is small, even for a workbook with many worksheets.
  // Bound it before constructing a DOM; sheet contents are scanned as text.
  if (xml.length > 1024 * 1024) throw new RosterArchiveError('This workbook has too much metadata. Copy the roster to a new workbook and try again.');
  if (/<!DOCTYPE/i.test(xml)) throw new Error('Unsupported workbook XML declaration');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('Invalid workbook XML');
  return document;
}

function elementsNamed(document: Document, name: string) {
  return Array.from(document.getElementsByTagName('*')).filter(element => element.localName.split(':').pop() === name);
}

/** Enforce limits on actual inflated contents before SheetJS allocates cells.
 * ZIP directory sizes and worksheet dimensions are untrusted metadata.
 */
export async function checkRosterArchive(bytes: Uint8Array, limits: ArchiveLimits) {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files);
  if (files.length > limits.entries) throw new RosterArchiveError('This workbook contains too many files. Copy the roster to a new workbook and try again.');
  if (!zip.file('[Content_Types].xml') || !zip.file('xl/workbook.xml') || !zip.file('xl/_rels/workbook.xml.rels')) {
    throw new RosterArchiveError('This file is not an Excel .xlsx workbook. Save it as .xlsx and try again.');
  }
  let expandedBytes = 0;
  for (const file of files) {
    if (file.unsafeOriginalName && file.unsafeOriginalName !== file.name) throw new Error('Invalid workbook path');
    if (file.dir) continue;
    await new Promise<void>((resolve, reject) => {
      let stopped = false;
      const stream = (file as StreamingZipFile).internalStream('uint8array');
      stream.on('data', chunk => {
        if (stopped) return;
        expandedBytes += chunk.byteLength;
        if (expandedBytes > limits.expandedBytes) {
          stopped = true;
          stream.pause();
          reject(new RosterArchiveError('This workbook exceeds 50 MB when expanded. Split the roster into smaller files.'));
        }
      }).on('error', reject).on('end', resolve).resume();
    });
  }

  const workbook = xmlDocument(await zip.file('xl/workbook.xml')!.async('string'));
  const sheet = elementsNamed(workbook, 'sheet')[0];
  const relationshipId = sheet && Array.from(sheet.attributes).find(attribute => attribute.localName.split(':').pop() === 'id')?.value;
  const relationships = xmlDocument(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'));
  const relationship = elementsNamed(relationships, 'Relationship').find(item => item.getAttribute('Id') === relationshipId);
  if (!relationship?.getAttribute('Type')?.endsWith('/worksheet') || relationship.getAttribute('TargetMode') === 'External') {
    throw new RosterArchiveError('The first sheet is not a worksheet. Move the roster to the first worksheet and try again.');
  }
  const target = new URL(relationship.getAttribute('Target') ?? '', 'https://roster.invalid/xl/');
  if (target.origin !== 'https://roster.invalid') throw new Error('Invalid worksheet path');
  const worksheet = zip.file(decodeURIComponent(target.pathname.slice(1)));
  if (!worksheet) throw new Error('Missing first worksheet');
  const xml = await worksheet.async('string');
  let rowNumber = 0;
  let columnNumber = 0;
  let cells = 0;
  // Inspect actual row/cell coordinates, including rows a limited SheetJS
  // read would skip. A forged or stale <dimension> must not truncate data.
  // Nested '<' ends a candidate tag so malformed XML cannot cause rescans.
  for (const tag of xml.matchAll(/<(?:[\w.-]+:)?(row|c)(?=[\s/>])[^<>]*>/g)) {
    const reference = /(?:^|\s)r\s*=\s*["']([^"']*)["']/.exec(tag[0])?.[1];
    if (tag[1] === 'row') {
      rowNumber = reference === undefined ? rowNumber + 1 : Number(reference);
      columnNumber = 0;
    } else {
      if (++cells > limits.cells) throw new RosterArchiveError('The first worksheet exceeds 100,000 cells. Split the roster into smaller files.');
      if (reference !== undefined) {
        const address = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(reference);
        if (!address) throw new Error('Invalid worksheet cell address');
        columnNumber = Array.from(address[1]).reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0);
        if (+address[2] > limits.rows) throw new RosterArchiveError('The first worksheet exceeds 5,000 rows or 100 columns. Split the roster into smaller files.');
      } else ++columnNumber;
    }
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > limits.rows || columnNumber > limits.columns) {
      throw new RosterArchiveError('The first worksheet exceeds 5,000 rows or 100 columns. Split the roster into smaller files.');
    }
  }
  // Parse exactly the entries we checked. Normalizing the archive removes
  // duplicate ZIP names and avoids differences between two ZIP readers.
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}

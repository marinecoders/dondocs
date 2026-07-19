/**
 * Decide how an imported file should be read. Pure and dependency-free so it can
 * be unit-tested without loading the PDF or DOCX engines.
 *
 * Three signals, cheapest and most trustworthy first: the file extension, then
 * the MIME type the browser reported, then the leading "magic" bytes. The byte
 * check is the safety net for a file whose name and type both lie — a `.docx`
 * served as octet-stream, or a document dropped with no name at all.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type ImportFormat = 'pdf' | 'docx';

/** A leading byte sequence that identifies a container format. */
interface Signature {
  magic: readonly number[];
  format: ImportFormat;
}

// Table-driven so a new format is one row, not another hand-rolled comparison.
//   "%PDF"          → 25 50 44 46   (every PDF opens with it)
//   "PK\x03\x04"    → 50 4B 03 04   (ZIP local-file header; a .docx is a ZIP)
const SIGNATURES: readonly Signature[] = [
  { magic: [0x25, 0x50, 0x44, 0x46], format: 'pdf' },
  { magic: [0x50, 0x4b, 0x03, 0x04], format: 'docx' },
];

// The OLE compound-file header shared by the legacy binary Office formats
// (.doc/.xls/.ppt). Not importable — pandoc and pdf.js can't read it — but
// recognizing it lets the UI say "re-save as .docx" instead of "corrupt file".
const OLE_MAGIC: readonly number[] = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const leadsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  magic.every((b, i) => bytes[i] === b);

/** True when the file name or MIME type identifies a modern Word document. */
export function isDocxFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.docx$/i.test(file.name) || file.type === DOCX_MIME;
}

/**
 * True for a legacy binary Word (.doc) file. Recognized so the importer can give
 * a specific "save it as .docx and try again" message rather than failing as if
 * the file were corrupt. `.doc$` never matches `.docx` (that ends in "x").
 */
export function isLegacyDocFile(file: Pick<File, 'name' | 'type'>, bytes?: Uint8Array): boolean {
  return (
    /\.doc$/i.test(file.name) ||
    file.type === 'application/msword' ||
    (bytes !== undefined && leadsWith(bytes, OLE_MAGIC))
  );
}

/**
 * The import format of a file, or null when it is neither a PDF nor a modern
 * Word document. Extension/MIME win; magic bytes are the fallback.
 */
export function detectImportFormat(file: Pick<File, 'name' | 'type'>, bytes: Uint8Array): ImportFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx') || file.type === DOCX_MIME) return 'docx';
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  for (const sig of SIGNATURES) {
    if (leadsWith(bytes, sig.magic)) return sig.format;
  }
  return null;
}

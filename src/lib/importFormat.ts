/**
 * Decide how an imported file should be read. Pure and dependency-free so it can
 * be unit-tested without loading the PDF or DOCX engines.
 *
 * Extension/MIME is trusted first; magic bytes are the fallback so a mislabeled
 * or extension-less file (a `.docx` served as octet-stream, a file dropped with
 * no name) still routes correctly instead of failing.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type ImportFormat = 'pdf' | 'docx';

/** True when the file name or MIME type identifies a Word document. */
export function isDocxFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.docx$/i.test(file.name) || file.type === DOCX_MIME;
}

/**
 * The import format of a file, or null when it is neither a PDF nor a Word
 * document. `%PDF` (25 50 44 46) marks a PDF; the ZIP local-file header
 * `PK\x03\x04` (50 4B 03 04) marks a .docx (an OOXML zip).
 */
export function detectImportFormat(file: Pick<File, 'name' | 'type'>, bytes: Uint8Array): ImportFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx') || file.type === DOCX_MIME) return 'docx';
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'docx';
  return null;
}

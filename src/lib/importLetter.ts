import { readFileAsArrayBuffer, arrayBufferToUint8Array } from '@/lib/encoding';
import { extractPdfText } from '@/lib/pdfText';
import { parseNavalLetter, type ParsedLetter } from '@/lib/parseNavalLetter';
import { detectDocumentType, type DocTypeDetection } from '@/lib/detectDocumentType';
import { convertDocxToPlainText } from '@/services/docx/pandoc-converter';
import { useDocumentStore, persistUnsavedEnclosures } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import type { DocumentData } from '@/types/document';

/** A parsed file plus the importer's best guess at which document type it is. */
export interface ParsedImport {
  parsed: ParsedLetter;
  detection: DocTypeDetection;
}

/** True when the file name or MIME type identifies a Word document. */
function isDocxFile(file: File): boolean {
  return (
    /\.docx$/i.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

/** Extract the plain text of a supported letter file (PDF text-layer or DOCX). */
async function extractLetterText(file: File): Promise<string> {
  const buffer = await readFileAsArrayBuffer(file);
  const bytes = arrayBufferToUint8Array(buffer);
  return isDocxFile(file) ? convertDocxToPlainText(bytes) : extractPdfText(bytes);
}

/**
 * Read a letter file (PDF or DOCX), parse it into naval-letter fields, and
 * detect which document type it most likely is. Text-layer PDFs and Word
 * documents only — a scanned image PDF has no text to read.
 */
export async function parseLetterFile(file: File): Promise<ParsedImport> {
  const text = await extractLetterText(file);
  return { parsed: parseNavalLetter(text), detection: detectDocumentType(text) };
}

/** Whether the parser recognized anything worth importing. */
export function hasParsedContent(p: ParsedLetter): boolean {
  return Boolean(
    p.from ||
      p.to ||
      p.subject ||
      p.paragraphs.length > 0 ||
      p.references.length > 0 ||
      p.enclosures.length > 0
  );
}

/**
 * Load a parsed letter into the editor as a NEW document (the current one is
 * synced first, never clobbered). Mirrors the draft-import sequence in
 * Header.tsx: set the document type, then the scalar fields, then the arrays,
 * then open the result as its own recents entry. Only fields the parser filled
 * are written — everything else stays at the fresh-letter default.
 *
 * `docType` is the type the drafter confirmed in the review step (defaulting to
 * the importer's detection); every importable type lives in the correspondence
 * category, and `setDocType` derives the per-type layout config from it.
 */
export function applyParsedLetter(parsed: ParsedLetter, docType = 'naval_letter'): void {
  const docs = useDocumentsStore.getState();
  const ds = useDocumentStore.getState();

  // Preserve the document being left before we overwrite the live editor state.
  docs.syncCurrent();

  ds.setDocumentMode('compliant');
  ds.setDocumentCategory('correspondence');
  ds.setDocType(docType);

  const formData: Partial<DocumentData> = {};
  if (parsed.ssic) formData.ssic = parsed.ssic;
  if (parsed.serial) formData.serial = parsed.serial;
  if (parsed.date) formData.date = parsed.date;
  if (parsed.from) formData.from = parsed.from;
  if (parsed.to) formData.to = parsed.to;
  if (parsed.via) formData.via = parsed.via;
  if (parsed.subject) formData.subject = parsed.subject;
  if (parsed.signature) {
    formData.sigFirst = parsed.signature.first;
    formData.sigMiddle = parsed.signature.middle;
    formData.sigLast = parsed.signature.last;
  }
  ds.setFormData(formData);

  ds.loadTemplate({
    // `letter` is re-assigned by the store from array position.
    references: parsed.references.map((title) => ({ letter: '', title })),
    enclosures: parsed.enclosures.map((title) => ({ title })),
    paragraphs: parsed.paragraphs.map((p) => ({ text: p.text, level: p.level })),
    copyTos: parsed.copyTos.map((text) => ({ text })),
  });

  docs.openLoadedAsNew();
  void persistUnsavedEnclosures();
}

import { readFileAsArrayBuffer, arrayBufferToUint8Array } from '@/lib/encoding';
import { extractPdfText } from '@/lib/pdfText';
import { parseNavalLetter, type ParsedLetter } from '@/lib/parseNavalLetter';
import { useDocumentStore, persistUnsavedEnclosures } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import type { DocumentData } from '@/types/document';

/** Read a PDF File and parse it into naval-letter fields. Text-layer PDFs only. */
export async function parseLetterFile(file: File): Promise<ParsedLetter> {
  const buffer = await readFileAsArrayBuffer(file);
  const text = await extractPdfText(arrayBufferToUint8Array(buffer));
  return parseNavalLetter(text);
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
 */
export function applyParsedLetter(parsed: ParsedLetter): void {
  const docs = useDocumentsStore.getState();
  const ds = useDocumentStore.getState();

  // Preserve the document being left before we overwrite the live editor state.
  docs.syncCurrent();

  ds.setDocumentMode('compliant');
  ds.setDocumentCategory('correspondence');
  ds.setDocType('naval_letter');

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
  });

  docs.openLoadedAsNew();
  void persistUnsavedEnclosures();
}

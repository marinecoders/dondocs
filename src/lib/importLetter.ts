import { readFileAsArrayBuffer, arrayBufferToUint8Array } from '@/lib/encoding';
import { extractPdfText } from '@/lib/pdfText';
import { parseNavalLetter, type ParsedLetter } from '@/lib/parseNavalLetter';
import { detectDocumentType, type DocTypeDetection } from '@/lib/detectDocumentType';
import { detectClassification, type ClassificationDetection } from '@/lib/detectClassification';
import { convertDocxToPlainText, extractDocxMarkingText } from '@/services/docx/pandoc-converter';
import { useDocumentStore, persistUnsavedEnclosures } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import type { DocumentData } from '@/types/document';

/** A parsed file plus the importer's guesses at document type and classification. */
export interface ParsedImport {
  parsed: ParsedLetter;
  detection: DocTypeDetection;
  classification: ClassificationDetection;
}

/** True when the file name or MIME type identifies a Word document. */
function isDocxFile(file: File): boolean {
  return (
    /\.docx$/i.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

/**
 * Extract the text of a supported letter file (PDF text-layer or DOCX). Returns
 * the readable `body` used for parsing, plus any `markings` text that lives
 * outside the body — the classification banner rides in the Word page
 * header/footer, which the body-only DOCX read can't see, so it is pulled
 * separately. A PDF's banner is already in the page text, so `markings` is
 * empty there.
 */
async function extractLetterText(file: File): Promise<{ body: string; markings: string }> {
  const buffer = await readFileAsArrayBuffer(file);
  const bytes = arrayBufferToUint8Array(buffer);
  if (isDocxFile(file)) {
    const [body, markings] = await Promise.all([convertDocxToPlainText(bytes), extractDocxMarkingText(bytes)]);
    return { body, markings };
  }
  return { body: await extractPdfText(bytes), markings: '' };
}

/**
 * Read a letter file (PDF or DOCX), parse it into naval-letter fields, and
 * detect the document type and classification. Text-layer PDFs and Word
 * documents only — a scanned image PDF has no text to read. The letter
 * structure is parsed from the body; classification also considers the
 * header/footer markings (where the DOCX banner lives).
 */
export async function parseLetterFile(file: File): Promise<ParsedImport> {
  const { body, markings } = await extractLetterText(file);
  return {
    parsed: parseNavalLetter(body),
    detection: detectDocumentType(body),
    classification: detectClassification(markings ? `${markings}\n${body}` : body),
  };
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
 *
 * `classification`, when the source was marked, pre-sets the banner level and
 * any derivative-classification authority block; per-paragraph portion markings
 * ride in on the parsed paragraphs. The drafter still owns the Classification
 * section after import (and the domain restriction applies there as usual).
 */
export function applyParsedLetter(
  parsed: ParsedLetter,
  docType = 'naval_letter',
  classification?: ClassificationDetection
): void {
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
  // Classification: only write when the source actually carried markings, so an
  // unmarked import stays at the fresh-letter Unclassified default.
  if (classification?.found) {
    formData.classLevel = classification.classLevel;
    if (classification.classifiedBy) formData.classifiedBy = classification.classifiedBy;
    if (classification.derivedFrom) formData.derivedFrom = classification.derivedFrom;
    if (classification.declassifyOn) formData.declassifyOn = classification.declassifyOn;
    if (classification.classReason) formData.classReason = classification.classReason;
  }
  ds.setFormData(formData);

  ds.loadTemplate({
    // `letter` is re-assigned by the store from array position.
    references: parsed.references.map((title) => ({ letter: '', title })),
    enclosures: parsed.enclosures.map((title) => ({ title })),
    paragraphs: parsed.paragraphs.map((p) => ({
      text: p.text,
      level: p.level,
      ...(p.portionMarking && { portionMarking: p.portionMarking }),
    })),
    copyTos: parsed.copyTos.map((text) => ({ text })),
  });

  docs.openLoadedAsNew();
  void persistUnsavedEnclosures();
}

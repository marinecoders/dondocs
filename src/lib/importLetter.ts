import { createBlankSession, referenceLetterAt } from '@/stores/documentStore';
import { readFileAsArrayBuffer, arrayBufferToUint8Array } from '@/lib/encoding';
import { extractPdfText } from '@/lib/pdfText';
import { parseNavalLetter, type ParsedLetter } from '@/lib/parseNavalLetter';
import { detectDocumentType, type DocTypeDetection } from '@/lib/detectDocumentType';
import { detectClassification, type ClassificationDetection } from '@/lib/detectClassification';
import { convertDocxToPlainText, extractDocxMarkingText } from '@/services/docx/pandoc-converter';
import { detectImportFormat } from '@/lib/importFormat';
import { openSessionAsNew, type TransitionOutcome } from '@/stores/documentsStore';
import type { DocumentData } from '@/types/document';

export { isDocxFile, isLegacyDocFile, detectImportFormat, type ImportFormat } from '@/lib/importFormat';

/** A parsed letter plus the importer's guesses at document type and classification. */
export interface ParsedImport {
  parsed: ParsedLetter;
  detection: DocTypeDetection;
  classification: ClassificationDetection;
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
  const format = detectImportFormat(file, bytes);
  if (format === 'docx') {
    // The body is essential; the header/footer markings only feed classification
    // detection, so a hiccup reading them must not fail the whole import.
    const [body, markings] = await Promise.all([
      convertDocxToPlainText(bytes),
      extractDocxMarkingText(bytes).catch(() => ''),
    ]);
    return { body, markings };
  }
  if (format === 'pdf') return { body: await extractPdfText(bytes), markings: '' };
  throw new Error(`Unsupported file type for import: ${file.name || '(unnamed file)'}`);
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
  return parseLetterText(body, markings);
}

/** Parse pasted or extracted text through the same letter-import pipeline. */
export function parseLetterText(text: string, markings = ''): ParsedImport {
  return {
    parsed: parseNavalLetter(text),
    detection: detectDocumentType(text),
    classification: detectClassification(markings ? `${markings}\n${text}` : text),
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

/** Prepare a parsed letter from fresh defaults, then open it under one new identity. */
export function applyParsedLetter(
  parsed: ParsedLetter,
  docType = 'naval_letter',
  classification?: ClassificationDetection
): TransitionOutcome {
  const session = createBlankSession(undefined, docType);

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
  session.formData = { ...session.formData, ...formData };
  Object.assign(session, {
    references: parsed.references.map((title, index) => ({ letter: referenceLetterAt(index), title })),
    enclosures: parsed.enclosures.map((title) => ({ title })),
    paragraphs: parsed.paragraphs.map((p) => ({
      text: p.text,
      level: p.level,
      ...(p.portionMarking && { portionMarking: p.portionMarking }),
    })),
    copyTos: parsed.copyTos.map((text) => ({ text })),
  });

  return openSessionAsNew(session);
}

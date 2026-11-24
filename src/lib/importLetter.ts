import { createBlankSession, referenceLetterAt } from '@/stores/documentStore';
import { readFileAsArrayBuffer, arrayBufferToUint8Array } from '@/lib/encoding';
import { extractPdfText } from '@/lib/pdfText';
import { parseNavalLetter, type ParsedLetter } from '@/lib/parseNavalLetter';
import { detectDocumentType, type DocTypeDetection } from '@/lib/detectDocumentType';
import { detectClassification, type ClassificationDetection } from '@/lib/detectClassification';
import { readWordDocument, type WordImport } from '@/services/docx/import/readWord';
import { WORD_IMPORT_LIMITS } from '@/services/docx/import/archive';
import { detectImportFormat, isDocxFile } from '@/lib/importFormat';
import { openSessionAsNew, type TransitionOutcome } from '@/stores/documentsStore';
import type { DocumentData } from '@/types/document';
import { freshParagraphs } from './paragraphIdentity';
import { isEndorsement } from './endorsement';
import { referenceLetterIndex } from './referenceLetters';

export { isDocxFile, isLegacyDocFile, detectImportFormat, type ImportFormat } from '@/lib/importFormat';

/** A parsed letter plus the importer's guesses at document type and classification. */
export interface ParsedImport {
  parsed: ParsedLetter;
  detection: DocTypeDetection;
  classification: ClassificationDetection;
  word?: WordImport;
}

/**
 * Extract the text of a supported letter file (PDF text-layer or DOCX). Returns
 * the readable `body` used for parsing, plus any `markings` text that lives
 * outside the body — the classification banner rides in the Word page
 * header/footer, which the body-only DOCX read can't see, so it is pulled
 * separately. A PDF's banner is already in the page text, so `markings` is
 * empty there.
 */
async function extractLetterText(file: File, signal?: AbortSignal): Promise<{ body: string; markings: string; word?: WordImport }> {
  if (isDocxFile(file) && file.size > WORD_IMPORT_LIMITS.compressedBytes) throw new Error('Word files must be smaller than 20 MB.');
  signal?.throwIfAborted();
  const buffer = await readFileAsArrayBuffer(file);
  signal?.throwIfAborted();
  const bytes = arrayBufferToUint8Array(buffer);
  const format = detectImportFormat(file, bytes);
  if (format === 'docx') {
    // The original's complete retained inventory is required for its handling checks.
    const word = await readWordDocument(bytes, file.name, signal);
    return { body: word.plainText, markings: `${word.markings}\n${word.source.retainedText}`, word };
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
export async function parseLetterFile(file: File, signal?: AbortSignal): Promise<ParsedImport> {
  const { body, markings, word } = await extractLetterText(file, signal);
  const result = parseLetterText(body, markings);
  if (word) {
    result.word = word;
    result.parsed = parsedWordFields(word);
  }
  return result;
}

/** Word metadata owns only source blocks the rich projection actually mapped. */
export function parsedWordFields(word: Pick<WordImport, 'headerFields' | 'blocks'>): ParsedLetter {
  return { references: [], enclosures: [], copyTos: [], ...word.headerFields,
    paragraphs: word.blocks.map(block => ({ text: block.paragraph.text, level: block.paragraph.level })) };
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
export function parsedLetterSession(
  parsed: ParsedLetter,
  docType = 'naval_letter',
  classification?: ClassificationDetection
) {
  const session = createBlankSession(undefined, docType);

  const formData: Partial<DocumentData> = {};
  for (const key of ['department', 'unitLine1', 'unitLine2', 'unitAddress'] as const) if (parsed[key] !== undefined) formData[key] = parsed[key];
  if (parsed.ssic) formData.ssic = parsed.ssic;
  if (parsed.serial) formData.serial = parsed.serial;
  if (parsed.date) formData.date = parsed.date;
  if (parsed.from) formData.from = parsed.from;
  if (parsed.to) formData.to = parsed.to;
  if (parsed.via) formData.via = parsed.via;
  if (parsed.subject) formData.subject = parsed.subject;
  const firstReference = parsed.referenceLabels?.[0];
  if (isEndorsement(docType) && firstReference && referenceLetterIndex(firstReference) !== undefined) {
    formData.startingReferenceLetter = firstReference;
  }
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
    references: parsed.references.map((title, index) => ({ letter: parsed.referenceLabels?.[index] ?? referenceLetterAt(index), title })),
    enclosures: parsed.enclosures.map((title) => ({ title })),
    paragraphs: freshParagraphs(parsed.paragraphs.map((p) => ({
      text: p.text,
      level: p.level,
      ...(p.portionMarking && { portionMarking: p.portionMarking }),
    }))),
    copyTos: parsed.copyTos.map((text) => ({ text })),
    distributions: (parsed.distributions ?? []).map(text => ({ text })),
  });

  return session;
}

export function applyParsedLetter(parsed: ParsedLetter, docType = 'naval_letter', classification?: ClassificationDetection): TransitionOutcome {
  return openSessionAsNew(parsedLetterSession(parsed, docType, classification));
}

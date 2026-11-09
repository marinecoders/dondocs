/**
 * PII/PHI Detection Service for DONDOCS
 * Detects potentially sensitive information before PDF generation
 */
import { capturedTextFields, documentTextFields, type DocumentTextField } from '@/lib/documentFields';
import type { CapturedDocument } from '@/lib/capturedDocument';
import type { SerializedSession } from '@/stores/documentStore';
import type { FormSession } from '@/stores/formStore';
import type { FormInstance } from '@/services/forms/model';
import type { DocumentCategory, DocumentMode, EndItem, Enclosure, FormType, Paragraph, PublicationTableRow, Reference } from '@/types/document';

export type PIIType = 'SSN' | 'EDIPI' | 'DOB' | 'PHONE' | 'MEDICAL_KEYWORD' | 'EMAIL_ADDRESS';

export interface PIIFinding {
  type: PIIType;
  field: string;
  value: string;
  context?: string;
}

export interface PIIDetectionResult {
  found: boolean;
  findings: PIIFinding[];
  summary: {
    ssn: number;
    edipi: number;
    dob: number;
    phone: number;
    medicalKeywords: number;
    emailAddresses: number;
  };
}

// SSN patterns: XXX-XX-XXXX or XXXXXXXXX (9 digits)
const SSN_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b\d{9}\b/g, // May have false positives, but better to catch
];

// EDIPI: 10-digit military ID number
const EDIPI_PATTERN = /\b\d{10}\b/g;

// DOB patterns: Various date formats
const DOB_PATTERNS = [
  /\b(0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])[/-](19|20)\d{2}\b/g, // MM/DD/YYYY or MM-DD-YYYY
  /\b(0[1-9]|[12]\d|3[01])[/-](0[1-9]|1[0-2])[/-](19|20)\d{2}\b/g, // DD/MM/YYYY or DD-MM-YYYY
  /\b(19|20)\d{2}[/-](0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])\b/g, // YYYY-MM-DD
];

// Phone patterns: Various US phone formats
const PHONE_PATTERNS = [
  /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // (XXX) XXX-XXXX or XXX-XXX-XXXX
  /\b\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // +1 (XXX) XXX-XXXX
];

// Email pattern
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

// Medical/PHI keywords (case-insensitive)
const MEDICAL_KEYWORDS = [
  'patient',
  'diagnosis',
  'diagnosed',
  'treatment',
  'medication',
  'prescription',
  'symptom',
  'symptoms',
  'clinical',
  'medical condition',
  'health condition',
  'illness',
  'disease',
  'hospital',
  'hospitalized',
  'psychiatric',
  'mental health',
  'substance abuse',
  'hiv',
  'aids',
  'cancer',
  'diabetes',
  'pregnancy',
  'pregnant',
  'disability',
  'disabled',
  'surgery',
  'surgical',
  'physician',
  'doctor',
  'therapy',
  'counseling',
  'addiction',
  'blood type',
  'allergies',
  'allergic',
  'immunization',
  'vaccination',
  'genetic',
  'dna',
];

// Pre-compiled single alternation regex. Before this we were allocating 40
// fresh RegExp objects on every detectPII() call (which runs before every
// export) and scanning the text 40 separate times. One combined pattern
// does the same work in a single O(n) sweep and zero per-call allocations.
// Keywords are hard-coded above, so no regex-metachar escaping is needed.
const MEDICAL_KEYWORDS_REGEX = new RegExp(
  `\\b(?:${MEDICAL_KEYWORDS.join('|')})\\b`,
  'gi'
);

// Excluded email domains (official/military domains that are less concerning)
const EXCLUDED_EMAIL_DOMAINS = [
  'usmc.mil',
  'navy.mil',
  'army.mil',
  'af.mil',
  'uscg.mil',
  'mail.mil',
  'marines.mil',
];

const digitsOf = (s: string): string => s.replace(/\D/g, '');

// Reject runs that aren't plausibly a real identifier: a single repeated digit
// (000000000) or a strict ascending/descending sequence (123456789 / 987654321).
// These are the placeholder/example values that make bare \d{9}/\d{10} noisy.
function looksLikeRealId(d: string): boolean {
  if (/^(\d)\1+$/.test(d)) return false;
  const chars = d.split('').map(Number);
  const asc = chars.every((n, i) => i === 0 || n === (chars[i - 1] + 1) % 10);
  const desc = chars.every((n, i) => i === 0 || n === (chars[i - 1] + 9) % 10);
  return !asc && !desc;
}

// SSA structural rules for a 9-digit SSN: area 001–899 excluding 666; group 01–99;
// serial 0001–9999. Rules out ZIP+4 runs, document numbers, and obvious fakes.
function isPlausibleSSN(digits: string): boolean {
  if (digits.length !== 9 || !looksLikeRealId(digits)) return false;
  const area = Number(digits.slice(0, 3));
  const group = Number(digits.slice(3, 5));
  const serial = Number(digits.slice(5));
  return area !== 0 && area !== 666 && area < 900 && group !== 0 && serial !== 0;
}

// Precision gate for the low-confidence numeric patterns. A dashed SSN
// (XXX-XX-XXXX) is a strong enough signal to keep as-is; a bare 9-/10-digit run
// must clear the structural / non-placeholder checks before it's flagged.
function passesPrecision(type: PIIType, match: string): boolean {
  if (type === 'SSN') return match.includes('-') ? true : isPlausibleSSN(match);
  if (type === 'EDIPI') return looksLikeRealId(digitsOf(match));
  return true;
}

function findMatches(
  text: string,
  patterns: RegExp[],
  type: PIIType,
  field: string
): PIIFinding[] {
  const findings: PIIFinding[] = [];

  for (const pattern of patterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(text)) !== null) {
      // Drop low-confidence numeric false positives (a bare 9-digit ZIP+4 or a
      // 10-digit doc number that isn't structurally an SSN/EDIPI).
      if (!passesPrecision(type, match[0])) continue;

      // Get context around the match
      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + match[0].length + 20);
      const context = text.substring(start, end);

      findings.push({
        type,
        field,
        value: match[0],
        context: `...${context}...`,
      });
    }
  }

  return findings;
}

function findMedicalKeywords(text: string, field: string): PIIFinding[] {
  const findings: PIIFinding[] = [];

  // Reset lastIndex — the regex is module-level and shared, so a previous
  // call may have left it mid-stream.
  MEDICAL_KEYWORDS_REGEX.lastIndex = 0;

  let match;
  while ((match = MEDICAL_KEYWORDS_REGEX.exec(text)) !== null) {
    // Get context around the match (on the original text so casing is
    // preserved in the preview shown to the user).
    const start = Math.max(0, match.index - 20);
    const end = Math.min(text.length, match.index + match[0].length + 20);
    const context = text.substring(start, end);

    findings.push({
      type: 'MEDICAL_KEYWORD',
      field,
      // Normalize to lowercase so the dedup pass downstream treats
      // "Patient" and "patient" as the same finding (matches previous
      // behavior where `value` was always the lowercase keyword).
      value: match[0].toLowerCase(),
      context: `...${context}...`,
    });
  }

  return findings;
}

function findEmails(text: string, field: string): PIIFinding[] {
  const findings: PIIFinding[] = [];

  EMAIL_PATTERN.lastIndex = 0;
  let match;

  while ((match = EMAIL_PATTERN.exec(text)) !== null) {
    const email = match[0].toLowerCase();

    // Skip official military domains
    if (EXCLUDED_EMAIL_DOMAINS.some(domain => email.endsWith(domain))) {
      continue;
    }

    findings.push({
      type: 'EMAIL_ADDRESS',
      field,
      value: match[0],
    });
  }

  return findings;
}

interface DocumentStore {
  docType?: string;
  documentCategory?: DocumentCategory;
  documentMode?: DocumentMode;
  formType?: FormType;
  forms?: FormSession;
  genericForm?: FormInstance;
  formData: Record<string, unknown>;
  paragraphs: Array<Pick<Paragraph, 'text'> & Partial<Omit<Paragraph, 'text'>>>;
  copyTos: Array<{ text: string }>;
  references: Array<Pick<Reference, 'title'> & Partial<Omit<Reference, 'title'>>>;
  distributions?: Array<{ text: string }>;
  enclosures?: Array<Partial<Enclosure>>;
  endItems?: EndItem[];
  publicationTables?: Record<string, PublicationTableRow[]>;
}

// The full PII battery on a single free-text field. Shared so every scannable
// field — not just the body — gets the same coverage that the share/export
// payload assumes was applied.
function scanText(field: DocumentTextField): PIIFinding[] {
  const { text, label: fieldName } = field;
  if (typeof text !== 'string' || !text.trim()) return [];
  // A valid ID is expected only in Page 11's dedicated EDIPI field. Skip
  // its overlapping phone match too; every free-text use still gets scanned.
  if (field.path.length === 3 && field.path[0] === 'forms'
    && field.path[1] === 'navmc11811' && field.path[2] === 'edipi' && /^\d{10}$/.test(text)) return [];
  // Plain dates in a document-date field include lists of office closures.
  // Free text, configured answers, and annotations still get the full scan;
  // date fields are never exempt from other PII patterns.
  const dateValues = field.datePurpose === 'document' ? text.split(/[\s,;]+/).filter(Boolean) : [];
  const documentDate = dateValues.length > 0
    && dateValues.every(value => /^(?:\d{4}[/-]\d{2}[/-]\d{2}|\d{2}[/-]\d{2}[/-]\d{4})$/.test(value));
  return [
    ...findMatches(text, SSN_PATTERNS, 'SSN', fieldName),
    ...findMatches(text, [EDIPI_PATTERN], 'EDIPI', fieldName),
    ...(documentDate ? [] : findMatches(text, DOB_PATTERNS, 'DOB', fieldName)),
    ...findMatches(text, PHONE_PATTERNS, 'PHONE', fieldName),
    ...findMedicalKeywords(text, fieldName),
    ...findEmails(text, fieldName),
  ];
}

/** Compatibility data port for existing export callers; preparation will select their output projection. */
export function detectPII(documentStore: DocumentStore): PIIDetectionResult {
  const fields = documentTextFields({
    docType: documentStore.docType ?? 'naval_letter',
    documentCategory: documentStore.documentCategory ?? 'correspondence',
    documentMode: documentStore.documentMode ?? 'compliant',
    formType: documentStore.formType ?? 'navmc_10274',
    formData: documentStore.formData,
    paragraphs: documentStore.paragraphs.map(paragraph => ({ ...paragraph, level: paragraph.level ?? 0 })),
    references: documentStore.references.map(reference => ({ ...reference, letter: reference.letter ?? '' })),
    enclosures: documentStore.enclosures?.map(enclosure => ({ ...enclosure, title: enclosure.title ?? '' })),
    copyTos: documentStore.copyTos,
    distributions: documentStore.distributions,
    endItems: documentStore.endItems,
    publicationTables: documentStore.publicationTables,
    forms: documentStore.forms,
    genericForm: documentStore.genericForm,
  }, 'draft');
  return inspectFields(fields);
}

/** Inspect the exact serialized share payload, including its inactive fields. */
export function detectSharedSessionPII(session: SerializedSession): PIIDetectionResult {
  return inspectFields(documentTextFields(session, 'share'));
}

/** Preparation inspects an issued revision rather than rereading a live store. */
export function detectCapturedPII(captured: CapturedDocument, projection: 'output' | 'share' = 'output'): PIIDetectionResult {
  return inspectFields(capturedTextFields(captured, projection));
}

function inspectFields(fields: readonly DocumentTextField[]): PIIDetectionResult {
  return summarizeFindings(fields.flatMap(scanText));
}

export function detectTextPII(fields: readonly { field: string; value: string }[]): PIIDetectionResult {
  return inspectFields(fields.map(({ field, value }, index) => ({ path: ['batchValues', index], text: value, label: field, role: 'text' })));
}

export function mergePIIResults(results: readonly PIIDetectionResult[]): PIIDetectionResult {
  return summarizeFindings(results.flatMap(result => result.findings));
}

function summarizeFindings(findings: PIIFinding[]): PIIDetectionResult {

  // Remove duplicates (same value in same field)
  const uniqueFindings = findings.filter((finding, index, self) =>
    index === self.findIndex(f =>
      f.type === finding.type &&
      f.field === finding.field &&
      f.value === finding.value
    )
  );

  // Build summary
  const summary = {
    ssn: uniqueFindings.filter(f => f.type === 'SSN').length,
    edipi: uniqueFindings.filter(f => f.type === 'EDIPI').length,
    dob: uniqueFindings.filter(f => f.type === 'DOB').length,
    phone: uniqueFindings.filter(f => f.type === 'PHONE').length,
    medicalKeywords: uniqueFindings.filter(f => f.type === 'MEDICAL_KEYWORD').length,
    emailAddresses: uniqueFindings.filter(f => f.type === 'EMAIL_ADDRESS').length,
  };

  return {
    found: uniqueFindings.length > 0,
    findings: uniqueFindings,
    summary,
  };
}

export function getPIITypeLabel(type: PIIType): string {
  switch (type) {
    case 'SSN':
      return 'Social Security Number';
    case 'EDIPI':
      return 'EDIPI (DoD ID Number)';
    case 'DOB':
      return 'Date of Birth';
    case 'PHONE':
      return 'Phone Number';
    case 'MEDICAL_KEYWORD':
      return 'Medical/PHI Keyword';
    case 'EMAIL_ADDRESS':
      return 'Personal Email Address';
    default:
      return type;
  }
}

export function getPIITypeSeverity(type: PIIType): 'high' | 'medium' | 'low' {
  switch (type) {
    case 'SSN':
    case 'EDIPI':
      return 'high';
    case 'DOB':
    case 'MEDICAL_KEYWORD':
      return 'medium';
    case 'PHONE':
    case 'EMAIL_ADDRESS':
      return 'low';
    default:
      return 'medium';
  }
}

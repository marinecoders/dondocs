/**
 * PII/PHI Detection Service for LIBO-SECURED
 * Detects potentially sensitive information before PDF generation
 */

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
  /\b(0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/g, // MM/DD/YYYY or MM-DD-YYYY
  /\b(0[1-9]|[12]\d|3[01])[\/\-](0[1-9]|1[0-2])[\/\-](19|20)\d{2}\b/g, // DD/MM/YYYY or DD-MM-YYYY
  /\b(19|20)\d{2}[\/\-](0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])\b/g, // YYYY-MM-DD
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
  const lowerText = text.toLowerCase();

  for (const keyword of MEDICAL_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    let match;

    while ((match = regex.exec(lowerText)) !== null) {
      // Get context around the match
      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + match[0].length + 20);
      const context = text.substring(start, end);

      findings.push({
        type: 'MEDICAL_KEYWORD',
        field,
        value: keyword,
        context: `...${context}...`,
      });
    }
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
  formData: Record<string, unknown>;
  paragraphs: Array<{ text: string }>;
  copyTos: Array<{ text: string }>;
  references: Array<{ title: string; url?: string }>;
}

export function detectPII(documentStore: DocumentStore): PIIDetectionResult {
  const findings: PIIFinding[] = [];

  // Scan form data fields
  const formFieldsToScan = [
    'from',
    'to',
    'subject',
    'sigFirst',
    'sigMiddle',
    'sigLast',
    'sigRank',
    'sigTitle',
    'unitLine1',
    'unitLine2',
    'unitAddress',
  ];

  for (const fieldName of formFieldsToScan) {
    const value = documentStore.formData[fieldName];
    if (typeof value === 'string' && value.trim()) {
      findings.push(...findMatches(value, SSN_PATTERNS, 'SSN', `Form: ${fieldName}`));
      findings.push(...findMatches(value, [EDIPI_PATTERN], 'EDIPI', `Form: ${fieldName}`));
      findings.push(...findMatches(value, DOB_PATTERNS, 'DOB', `Form: ${fieldName}`));
      findings.push(...findMatches(value, PHONE_PATTERNS, 'PHONE', `Form: ${fieldName}`));
      findings.push(...findMedicalKeywords(value, `Form: ${fieldName}`));
    }
  }

  // Scan email fields specifically
  const emailFields = ['pocEmail', 'classifiedPocEmail'];
  for (const fieldName of emailFields) {
    const value = documentStore.formData[fieldName];
    if (typeof value === 'string' && value.trim()) {
      findings.push(...findEmails(value, `Form: ${fieldName}`));
    }
  }

  // Scan paragraphs (document body - highest risk area)
  documentStore.paragraphs.forEach((para, index) => {
    if (para.text && para.text.trim()) {
      const fieldName = `Paragraph ${index + 1}`;
      findings.push(...findMatches(para.text, SSN_PATTERNS, 'SSN', fieldName));
      findings.push(...findMatches(para.text, [EDIPI_PATTERN], 'EDIPI', fieldName));
      findings.push(...findMatches(para.text, DOB_PATTERNS, 'DOB', fieldName));
      findings.push(...findMatches(para.text, PHONE_PATTERNS, 'PHONE', fieldName));
      findings.push(...findMedicalKeywords(para.text, fieldName));
      findings.push(...findEmails(para.text, fieldName));
    }
  });

  // Scan copy-to recipients
  documentStore.copyTos.forEach((copyTo, index) => {
    if (copyTo.text && copyTo.text.trim()) {
      const fieldName = `Copy To ${index + 1}`;
      findings.push(...findMatches(copyTo.text, SSN_PATTERNS, 'SSN', fieldName));
      findings.push(...findMatches(copyTo.text, [EDIPI_PATTERN], 'EDIPI', fieldName));
      findings.push(...findEmails(copyTo.text, fieldName));
    }
  });

  // Scan references
  documentStore.references.forEach((ref, index) => {
    const fieldName = `Reference ${index + 1}`;
    if (ref.title && ref.title.trim()) {
      findings.push(...findMatches(ref.title, SSN_PATTERNS, 'SSN', fieldName));
    }
    if (ref.url && ref.url.trim()) {
      // URLs might contain PII in query parameters
      findings.push(...findMatches(ref.url, SSN_PATTERNS, 'SSN', `${fieldName} URL`));
    }
  });

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

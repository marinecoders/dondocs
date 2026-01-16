export type DocumentMode = 'compliant' | 'custom';

// Top-level document category: correspondence (letters, memos, etc.) or forms (6105, Page 11, etc.)
export type DocumentCategory = 'correspondence' | 'forms';

// Form types
export type FormType = 'navmc_10274' | 'navmc_118_11';

export const FORM_TYPE_LABELS: Record<FormType, string> = {
  navmc_10274: 'NAVMC 10274 - Administrative Action',
  navmc_118_11: 'NAVMC 118 (11) - Administrative Remarks (6105)',
};

export const FORM_TYPE_CATEGORIES: { category: string; types: FormType[] }[] = [
  {
    category: 'Administrative',
    types: ['navmc_10274', 'navmc_118_11'],
  },
];

export interface Reference {
  letter: string;
  title: string;
  url?: string;
}

export type EnclosurePageStyle = 'border' | 'fullpage' | 'fit';

export interface Enclosure {
  title: string;
  file?: {
    name: string;
    size: number;
    data: ArrayBuffer;
  };
  pageStyle?: EnclosurePageStyle; // 'border' = 85% with border, 'fullpage' = full page, 'fit' = fit to margins
  hasCoverPage?: boolean; // If true, add a cover page before the enclosure content
  coverPageDescription?: string; // Optional description text for the cover page
}

export type PortionMarking = 'U' | 'CUI' | 'FOUO' | 'C' | 'S' | 'TS';

export interface Paragraph {
  text: string;
  level: number;
  header?: string; // Optional paragraph heading (underlined per Ch 7 ¶13d)
  portionMarking?: PortionMarking;
}

export interface CopyTo {
  text: string;
}

export interface SignatureImage {
  name: string;
  size: number;
  data: string; // base64 encoded for localStorage compatibility
}

// Signature type: 'none' = just typed name, 'image' = uploaded signature image, 'digital' = empty field for CAC/digital signing
export type SignatureType = 'none' | 'image' | 'digital';

export interface Profile {
  department?: string;
  unitLine1: string;
  unitLine2: string;
  unitAddress: string;
  ssic: string;
  from: string;
  sigFirst: string;
  sigMiddle: string;
  sigLast: string;
  sigRank: string;
  sigTitle: string;
  officeCode?: string;
  byDirection?: boolean;
  byDirectionAuthority?: string;
  cuiControlledBy?: string;
  pocEmail?: string;
  signatureImage?: SignatureImage;
  signatureType?: SignatureType;
}

export interface DocumentData {
  // Document type
  docType: string;

  // Font settings
  fontSize: string;
  fontFamily: string;

  // Page settings
  pageNumbering: string;

  // Letterhead
  department: string;
  unitLine1: string;
  unitLine2: string;
  unitAddress: string;
  sealType: string;
  letterheadColor: 'blue' | 'black';

  // Document identification
  ssic: string;
  serial: string;
  date: string;

  // Addressing
  from: string;
  to: string;
  via: string;
  subject: string;

  // Signature
  sigFirst: string;
  sigMiddle: string;
  sigLast: string;
  sigRank: string;
  sigTitle: string;
  officeCode: string;
  byDirection: boolean;
  byDirectionAuthority: string;
  signatureImage?: SignatureImage;
  signatureType?: SignatureType;

  // Classification
  classLevel: string;
  classifiedBy: string;
  derivedFrom: string;
  declassifyOn: string;
  classReason: string;
  classifiedPocEmail: string;

  // CUI
  cuiControlledBy: string;
  cuiCategory: string;
  cuiDissemination: string;
  cuiDistStatement: string;
  pocEmail: string;

  // MOA/MOU fields
  seniorCommandName: string;
  seniorSSIC: string;
  seniorSerial: string;
  seniorDate: string;
  seniorSigName: string;
  seniorSigRank: string;
  seniorSigTitle: string;
  juniorCommandName: string;
  juniorSSIC: string;
  juniorSerial: string;
  juniorDate: string;
  juniorSigName: string;
  juniorSigRank: string;
  juniorSigTitle: string;
  moaSubject: string;

  // Joint Letter fields
  jointSeniorName: string;
  jointSeniorZip: string;
  jointSeniorCode: string;
  jointSeniorFrom: string;
  jointSeniorSigName: string;
  jointSeniorSigTitle: string;
  jointJuniorName: string;
  jointJuniorZip: string;
  jointJuniorCode: string;
  jointJuniorSSIC: string;
  jointJuniorSerial: string;
  jointJuniorDate: string;
  jointJuniorSigName: string;
  jointJuniorSigTitle: string;
  jointJuniorFrom: string;
  jointCommonLocation: string;
  jointTo: string;
  jointSubject: string;

  // Joint Memorandum fields
  jointMemoSeniorFrom: string;
  jointMemoSeniorSigName: string;
  jointMemoSeniorSigTitle: string;
  jointMemoJuniorFrom: string;
  jointMemoJuniorSigName: string;
  jointMemoJuniorSigTitle: string;

  // Body
  body: string;

  // In reply to
  inReplyTo: boolean;
  inReplyToText: string;

  // Hyperlinks
  includeHyperlinks: boolean;

  // Business letter fields (compliance-driven)
  salutation: string;
  complimentaryClose: string;
}

export interface DocTypeConfig {
  letterhead: boolean;
  ssic: boolean;
  fromTo: boolean;
  via: boolean;
  memoHeader: boolean;
  signature: 'abbrev' | 'full' | 'dual';
  uiMode: 'standard' | 'moa' | 'joint' | 'joint_memo' | 'memo' | 'business';
  // Optional flags for special document types
  dateOnly?: boolean;           // Show only date field (no SSIC/Serial) - for business letters
  recipientAddress?: boolean;   // Show multi-line "To" address (no "From") - for business letters
  regulations: {
    fontSize: string;
    fontFamily: string;
    ref: string;
  };
  // Compliance restrictions (used in compliant mode)
  compliance: {
    numberedParagraphs: boolean;     // false = no numbered paragraphs (business letters)
    allowReferences: boolean;        // false = no formal references section (business letters)
    allowEnclosures: boolean;        // false = no formal enclosures section (business letters)
    requiresSalutation: boolean;     // true = needs "Dear Mr./Ms.:" (business letters)
    requiresComplimentaryClose: boolean; // true = needs "Sincerely," (business letters)
    dualSignature: boolean;          // true = two signature blocks (MOA/MOU/Joint)
    dateFormat: 'military' | 'spelled'; // 'military' = "4 Jan 26", 'spelled' = "January 4, 2026"
  };
}

// Default compliance settings for most document types
const DEFAULT_COMPLIANCE = {
  numberedParagraphs: true,
  allowReferences: true,
  allowEnclosures: true,
  requiresSalutation: false,
  requiresComplimentaryClose: false,
  dualSignature: false,
  dateFormat: 'military' as const,
};

// Business letter compliance (Ch 11) - NO numbered paragraphs, NO formal refs/enclosures
const BUSINESS_COMPLIANCE = {
  numberedParagraphs: false,
  allowReferences: false,  // Mentioned in body only
  allowEnclosures: false,  // Mentioned in body only
  requiresSalutation: true,
  requiresComplimentaryClose: true,
  dualSignature: false,
  dateFormat: 'spelled' as const,  // "January 4, 2026" format
};

// Endorsement compliance - NO numbered paragraphs (continues basic letter sequence)
const ENDORSEMENT_COMPLIANCE = {
  ...DEFAULT_COMPLIANCE,
  numberedParagraphs: false,
};

// Dual signature compliance (MOA/MOU/Joint)
const DUAL_SIGNATURE_COMPLIANCE = {
  ...DEFAULT_COMPLIANCE,
  dualSignature: true,
};

export const DOC_TYPE_CONFIG: Record<string, DocTypeConfig> = {
  naval_letter: {
    letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 2-20' },
    compliance: DEFAULT_COMPLIANCE,
  },
  standard_letter: {
    letterhead: false, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 2-20' },
    compliance: DEFAULT_COMPLIANCE,
  },
  business_letter: {
    letterhead: true, ssic: false, fromTo: false, via: false, memoHeader: false, signature: 'full', uiMode: 'business',
    dateOnly: true, recipientAddress: true,
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 11' },
    compliance: BUSINESS_COMPLIANCE,
  },
  multiple_address_letter: {
    letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 2-20' },
    compliance: DEFAULT_COMPLIANCE,
  },
  joint_letter: {
    letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: false, signature: 'dual', uiMode: 'joint',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 2-20' },
    compliance: DUAL_SIGNATURE_COMPLIANCE,
  },
  same_page_endorsement: {
    letterhead: false, ssic: false, fromTo: false, via: false, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 7' },
    compliance: ENDORSEMENT_COMPLIANCE,
  },
  new_page_endorsement: {
    letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 7' },
    compliance: ENDORSEMENT_COMPLIANCE,
  },
  mfr: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 10' },
    compliance: DEFAULT_COMPLIANCE,
  },
  plain_paper_memorandum: {
    letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' },
    compliance: DEFAULT_COMPLIANCE,
  },
  letterhead_memorandum: {
    letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' },
    compliance: DEFAULT_COMPLIANCE,
  },
  decision_memorandum: {
    letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' },
    compliance: DEFAULT_COMPLIANCE,
  },
  executive_memorandum: {
    letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: true, signature: 'full', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' },
    compliance: DEFAULT_COMPLIANCE,
  },
  moa: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: false, signature: 'dual', uiMode: 'moa',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' },
    compliance: DUAL_SIGNATURE_COMPLIANCE,
  },
  mou: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: false, signature: 'dual', uiMode: 'moa',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' },
    compliance: DUAL_SIGNATURE_COMPLIANCE,
  },
  joint_memorandum: {
    letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: true, signature: 'dual', uiMode: 'joint_memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' },
    compliance: DUAL_SIGNATURE_COMPLIANCE,
  },
  mf: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 10' },
    compliance: DEFAULT_COMPLIANCE,
  },
  executive_correspondence: {
    letterhead: true, ssic: false, fromTo: false, via: false, memoHeader: false, signature: 'full', uiMode: 'business',
    dateOnly: true, recipientAddress: true,
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' },
    compliance: BUSINESS_COMPLIANCE,
  },
};

export const DOC_TYPE_LABELS: Record<string, string> = {
  naval_letter: 'Naval Letter (on letterhead)',
  standard_letter: 'Standard Letter (plain paper)',
  business_letter: 'Business Letter',
  multiple_address_letter: 'Multiple Address Letter',
  joint_letter: 'Joint Letter',
  same_page_endorsement: 'Same-Page Endorsement',
  new_page_endorsement: 'New-Page Endorsement',
  mfr: 'Memorandum for the Record (MFR)',
  plain_paper_memorandum: 'Plain Paper Memorandum',
  letterhead_memorandum: 'Letterhead Memorandum',
  decision_memorandum: 'Decision Memorandum',
  executive_memorandum: 'Executive Memorandum',
  moa: 'Memorandum of Agreement (MOA)',
  mou: 'Memorandum of Understanding (MOU)',
  joint_memorandum: 'Joint Memorandum',
  mf: 'Memorandum For',
  executive_correspondence: 'Executive Correspondence',
};

// Categorized document types for the selector UI
export const DOC_TYPE_CATEGORIES: { category: string; types: string[] }[] = [
  {
    category: 'Letters',
    types: ['naval_letter', 'standard_letter', 'business_letter', 'multiple_address_letter', 'joint_letter'],
  },
  {
    category: 'Endorsements',
    types: ['same_page_endorsement', 'new_page_endorsement'],
  },
  {
    category: 'Memoranda',
    types: ['mfr', 'mf', 'plain_paper_memorandum', 'letterhead_memorandum', 'decision_memorandum', 'executive_memorandum', 'joint_memorandum'],
  },
  {
    category: 'Agreements',
    types: ['moa', 'mou'],
  },
  {
    category: 'Executive',
    types: ['executive_correspondence'],
  },
];

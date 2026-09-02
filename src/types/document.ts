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

// A durable pointer to enclosure file bytes stored in the IndexedDB `attachments`
// store. Persisted in the serialized session so an enclosure's file survives a
// reload (and travels in a full backup), instead of being dropped to a re-attach.
export interface FileRef {
  id: string; // key into the attachments store
  name: string;
  size: number;
  type: string; // MIME type ('' when the browser didn't provide one)
}

export interface Enclosure {
  title: string;
  file?: {
    name: string;
    size: number;
    data: ArrayBuffer;
  };
  fileRef?: FileRef; // durable handle to `file`'s bytes; set once the file is persisted
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

export interface Distribution {
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
  startingPageNumber: number;
  // Endorsements continue the basic letter's sequences rather than opening
  // their own: the reference sequence of letters (SECNAV M-5216.5 Ch 9 ¶3),
  // the enclosure sequence of numbers (Ch 9 ¶4), and the page numbers
  // (Fig 9-2 ¶1). The basic letter is a separate document, so the user
  // supplies where this one picks up. See `referenceStartIndex` /
  // `enclosureStartNumber` in lib/endorsement.ts.
  startingReferenceLetter?: string;
  startingEnclosureNumber?: number;

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

  // Endorsements only (same_page_endorsement, new_page_endorsement)
  // Per SECNAV M-5216.5 Ch 9 §2.1.b -- endorsement line format is:
  //   "[ORDINAL] ENDORSEMENT on [basic letter id]"
  // where ORDINAL is the word ordinal (FIRST, SECOND, THIRD, ...) for
  // the endorsement's position in the routing chain. Both fields are
  // populated by dedicated UI in AddressingSection that only renders
  // for endorsement doc types. The generators read them directly
  // (with regex fallback to subject for sessions saved before this
  // structured-fields migration).
  endorsementOrdinal?: string;
  basicLetterId?: string;

  // The basic letter this endorsement is written on, uploaded as a PDF so the
  // exported endorsement can be assembled after it (SECNAV M-5216.5 Ch 9 — the
  // endorsement continues the basic letter's page numbers, so the letter reads
  // first). Stored like an enclosure file: bytes live in the attachments
  // store, only `basicLetterFileRef` is serialized, and `basicLetterFile.data`
  // is rehydrated from it on load. Endorsement doc types only.
  basicLetterFile?: {
    name: string;
    size: number;
    data: ArrayBuffer;
  };
  basicLetterFileRef?: FileRef;

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

  // Acknowledgement endorsement — an appointment letter usually carries the
  // appointee's acknowledgement on its own sheet: the appointing officer signs,
  // a rule divides the page, the appointee endorses back below it. Both halves
  // are written at once, so the endorsement keeps its own addressees, body, and
  // signer rather than reusing the letter's. Addressees default to inverting
  // the letter. See src/lib/appendedEndorsement.ts.
  appendEndorsement?: boolean;
  endorsementFrom?: string;
  endorsementTo?: string;
  /** One paragraph per line; numbered like any endorsement body. */
  endorsementBody?: string;
  endorsementSigFirst?: string;
  endorsementSigMiddle?: string;
  endorsementSigLast?: string;
  /** Distinct from the letter's own serial/date: the appointee signs later. */
  endorsementSerial?: string;
  endorsementDate?: string;

  // Classification
  classLevel: string;
  customClassification: string;
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

  // Continuation subject on page 2+
  showSubjectOnContinuation: boolean;
  /** Ch 9 lets a same-page endorsement omit the subject when the whole page is
   *  photocopied. Omitting is the norm, so this is opt-in. */
  includeEndorsementSubject: boolean;

  // Underline subject line in generated PDF/DOCX
  underlineSubject: boolean;

  // Business letter fields (compliance-driven)
  salutation: string;
  complimentaryClose: string;

  // Executive memo fields (Ch 12)
  memorandumFor: string;       // "MEMORANDUM FOR" addressee
  attnLine: string;            // Optional ATTN: line
  throughLine: string;         // Optional THROUGH: line
  coordination: string;        // COORDINATION: section (Action/Info memos)
  preparedBy: string;          // Prepared By: line (Action/Info memos)
}

export interface DocTypeConfig {
  letterhead: boolean;
  ssic: boolean;
  fromTo: boolean;
  via: boolean;
  memoHeader: boolean;
  signature: 'abbrev' | 'full' | 'dual';
  uiMode: 'standard' | 'moa' | 'joint' | 'joint_memo' | 'memo' | 'business' | 'executive';
  // Optional flags for special document types
  dateOnly?: boolean;           // Show only date field (no SSIC/Serial) - for business letters
  recipientAddress?: boolean;   // Show multi-line "To" address (no "From") - for business letters
  regulations: {
    fontSize: string;
    fontSizeOptions?: string[];    // Allowed sizes in compliant mode (e.g., ['10pt', '11pt', '12pt'])
                                   // When absent, defaults to [fontSize] (locked to one value)
    fontFamily: string;
    fontFamilyRequired?: boolean;  // true = lock to fontFamily in compliant mode (Ch 12 exec docs)
                                   // When absent/false = font family is RECOMMENDED, not required
    ref: string;
  };
  // Layout fields — single source of truth for both PDF and DOCX generators
  showSignatureRankTitle?: boolean;    // default true — false for name-only signatures
  signatureSpacing?: '36pt' | '48pt'; // default '48pt' — '36pt' for memos
  memoTitle?: string;                  // centered memo header text (e.g., 'MEMORANDUM')
  skipSubject?: boolean;               // default false — true omits Subj: row in address block
  topSpacing?: string;                 // extra top spacing (e.g., '1in') for non-letterhead docs
  subjectPrefix?: string;              // prefix before subject in body (e.g., 'SUBJECT: ')
  hasDecisionBlock?: boolean;          // default false — true adds APPROVE/DISAPPROVE block
  // Optional field indicators — shown in compliant mode to note "not required" per SECNAV
  optionalLetterhead?: boolean;        // true = letterhead shown but marked "(optional)" in compliant mode
  optionalSSIC?: boolean;              // true = SSIC shown but marked "(optional)" in compliant mode
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

// Dual signature compliance (MOA/MOU/Joint)
const DUAL_SIGNATURE_COMPLIANCE = {
  ...DEFAULT_COMPLIANCE,
  dualSignature: true,
};

// Executive correspondence compliance (Ch 12) - bullets not numbered paragraphs, uses "Attachments:" not "Encl:"
const EXECUTIVE_COMPLIANCE = {
  numberedParagraphs: false,     // Uses bullets per Ch 12 ¶4.3a(2)
  allowReferences: false,        // Avoided for principal signatures per Ch 12 ¶2m
  allowEnclosures: false,        // Uses "Attachments:" not "Encl:" per Ch 12 ¶3
  requiresSalutation: false,
  requiresComplimentaryClose: false,
  dualSignature: false,
  dateFormat: 'spelled' as const,  // Executive uses spelled date
};

export const DOC_TYPE_CONFIG: Record<string, DocTypeConfig> = {
  naval_letter: {
    letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    showSignatureRankTitle: false, // Per SECNAV Ch 7 ¶14a(2): abbreviated name only, NO rank, NO title
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 7' },
    compliance: DEFAULT_COMPLIANCE,
  },
  standard_letter: {
    letterhead: false, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    showSignatureRankTitle: false,
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 7' },
    compliance: DEFAULT_COMPLIANCE,
  },
  business_letter: {
    letterhead: true, ssic: false, fromTo: false, via: false, memoHeader: false, signature: 'full', uiMode: 'business',
    dateOnly: true, recipientAddress: true,
    subjectPrefix: 'SUBJECT: ',
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 11' },
    compliance: BUSINESS_COMPLIANCE,
  },
  multiple_address_letter: {
    letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    showSignatureRankTitle: true, // PDF template uses \optionalLine for rank/title
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 8' },
    compliance: DEFAULT_COMPLIANCE,
  },
  joint_letter: {
    letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: false, signature: 'dual', uiMode: 'joint',
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 7' },
    compliance: DUAL_SIGNATURE_COMPLIANCE,
  },
  // Endorsements number their paragraphs. The rule is Ch 7 ¶13a
  // (Correspondence Format) -- "Identify all paragraphs or subparagraphs with a
  // number or letter" -- which an endorsement inherits by being
  // letter-formatted: Ch 9 sets only the endorsement line, addressees and
  // signature, and states no paragraph rule of its own. Figs 9-1 and 9-2 settle
  // it directly, both showing a numbered body (9-1 numbers even its single
  // paragraph). Where this manual wants paragraphs unnumbered it says so in
  // those words (Ch 11 ¶6, Ch 12 ¶3.2c(2)); Ch 9 has no such sentence, and its
  // only "do not number" is for Via addressees.
  //
  // These rendered unnumbered because Ch 9's "continue the sequence" language
  // was read as a paragraph rule. It never is: ¶3 continues a sequence of
  // *letters* (references), ¶4 a sequence of *numbers* (enclosures), and
  // Fig 9-2's own first paragraph continues *page* numbers.
  same_page_endorsement: {
    letterhead: false, ssic: false, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    showSignatureRankTitle: false, // Endorsements use abbreviated name only per Ch 9
    skipSubject: true,
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 9' },
    compliance: DEFAULT_COMPLIANCE,
  },
  new_page_endorsement: {
    letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    showSignatureRankTitle: false, // Endorsements use abbreviated name only per Ch 9
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 9' },
    compliance: DEFAULT_COMPLIANCE,
  },
  mfr: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    signatureSpacing: '36pt', memoTitle: 'MEMORANDUM FOR THE RECORD',
    optionalLetterhead: true,  // Ch 10 ¶1: "plain paper acceptable", letterhead NOT required
    optionalSSIC: true,        // Ch 10 ¶1: "identification symbols are not required"
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 10' },
    compliance: DEFAULT_COMPLIANCE,
  },
  plain_paper_memorandum: {
    letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    showSignatureRankTitle: false, signatureSpacing: '36pt', memoTitle: 'MEMORANDUM', topSpacing: '1in',
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 10 ¶3' },
    compliance: DEFAULT_COMPLIANCE,
  },
  letterhead_memorandum: {
    letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    showSignatureRankTitle: false, signatureSpacing: '36pt', memoTitle: 'MEMORANDUM',
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 10 ¶4' },
    compliance: DEFAULT_COMPLIANCE,
  },
  decision_memorandum: {
    letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    showSignatureRankTitle: false, signatureSpacing: '36pt', memoTitle: 'DECISION MEMORANDUM', topSpacing: '1in', hasDecisionBlock: true,
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 10 ¶5' },
    compliance: DEFAULT_COMPLIANCE,
  },
  executive_memorandum: {
    letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: true, signature: 'full', uiMode: 'memo',
    signatureSpacing: '36pt', memoTitle: 'MEMORANDUM',
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 12' },
    compliance: DEFAULT_COMPLIANCE,
  },
  moa: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: false, signature: 'dual', uiMode: 'moa',
    optionalLetterhead: true,  // Ch 10 ¶6c: "Both commands or plain bond" — letterhead not required
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 10 ¶6' },
    compliance: DUAL_SIGNATURE_COMPLIANCE,
  },
  mou: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: false, signature: 'dual', uiMode: 'moa',
    optionalLetterhead: true,  // Ch 10 ¶6c: "Both commands or plain bond" — letterhead not required
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 10 ¶6' },
    compliance: DUAL_SIGNATURE_COMPLIANCE,
  },
  joint_memorandum: {
    letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: true, signature: 'dual', uiMode: 'joint_memo',
    memoTitle: 'JOINT MEMORANDUM',
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 12' },
    compliance: DUAL_SIGNATURE_COMPLIANCE,
  },
  mf: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    memoTitle: 'MEMORANDUM FOR',
    optionalLetterhead: true,  // Ch 10 ¶2: Form-based (OPNAV 5215/144A/B), letterhead not required
    regulations: { fontSize: '12pt', fontSizeOptions: ['10pt', '11pt', '12pt'], fontFamily: 'times', ref: 'Ch 10' },
    compliance: DEFAULT_COMPLIANCE,
  },
  executive_correspondence: {
    letterhead: true, ssic: false, fromTo: false, via: false, memoHeader: false, signature: 'full', uiMode: 'business',
    dateOnly: true, recipientAddress: true, topSpacing: '1in',
    subjectPrefix: 'SUBJECT: ',
    regulations: { fontSize: '12pt', fontFamily: 'times', fontFamilyRequired: true, ref: 'Ch 12' },
    compliance: BUSINESS_COMPLIANCE,
  },
  standard_memorandum: {
    letterhead: false, ssic: false, fromTo: false, via: false, memoHeader: false, signature: 'full', uiMode: 'executive',
    topSpacing: '1in', // Achieves 2" top margin (1" geometry + 1" extra) per Ch 12 ¶2b
    regulations: { fontSize: '12pt', fontFamily: 'times', fontFamilyRequired: true, ref: 'Ch 12 ¶2' },
    compliance: EXECUTIVE_COMPLIANCE,
  },
  action_memorandum: {
    letterhead: false, ssic: false, fromTo: false, via: false, memoHeader: false, signature: 'full', uiMode: 'executive',
    topSpacing: '1in',
    regulations: { fontSize: '12pt', fontFamily: 'times', fontFamilyRequired: true, ref: 'Ch 12 ¶3' },
    compliance: EXECUTIVE_COMPLIANCE,
  },
  information_memorandum: {
    letterhead: false, ssic: false, fromTo: false, via: false, memoHeader: false, signature: 'abbrev', uiMode: 'executive',
    topSpacing: '1in',
    regulations: { fontSize: '12pt', fontFamily: 'times', fontFamilyRequired: true, ref: 'Ch 12 ¶4' },
    compliance: EXECUTIVE_COMPLIANCE,
  },
};

// Labels for document types visible in the UI
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
  standard_memorandum: 'Standard Memorandum (HqDON)',
  action_memorandum: 'Action Memorandum',
  information_memorandum: 'Information Memorandum',
};

/**
 * Short, scannable type code shown as a chip on each Recents row, using the
 * shorthand a correspondence clerk reads at a glance (LTR / MEMO / END / MFR /
 * MOA …) so a document package stops being a wall of identical file icons.
 */
export const DOC_TYPE_CHIP: Record<string, string> = {
  naval_letter: 'LTR',
  standard_letter: 'LTR',
  business_letter: 'BL',
  multiple_address_letter: 'LTR',
  joint_letter: 'JLTR',
  same_page_endorsement: 'END',
  new_page_endorsement: 'END',
  mfr: 'MFR',
  plain_paper_memorandum: 'MEMO',
  letterhead_memorandum: 'MEMO',
  decision_memorandum: 'MEMO',
  executive_memorandum: 'MEMO',
  moa: 'MOA',
  mou: 'MOU',
  joint_memorandum: 'JMEM',
  mf: 'MF',
  executive_correspondence: 'EXEC',
  standard_memorandum: 'MEMO',
  action_memorandum: 'MEMO',
  information_memorandum: 'MEMO',
};

/** The Recents type chip for a doc type (falls back to a generic code). */
export function docTypeChip(docType: string): string {
  return DOC_TYPE_CHIP[docType] ?? 'DOC';
}

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
    types: ['executive_correspondence', 'standard_memorandum', 'action_memorandum', 'information_memorandum'],
  },
];

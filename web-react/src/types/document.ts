export type DocumentMode = 'compliant' | 'custom';

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

export interface Paragraph {
  text: string;
  level: number;
}

export interface CopyTo {
  text: string;
}

export interface SignatureImage {
  name: string;
  size: number;
  data: string; // base64 encoded for localStorage compatibility
}

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
  byDirection?: boolean;
  byDirectionAuthority?: string;
  cuiControlledBy?: string;
  pocEmail?: string;
  signatureImage?: SignatureImage;
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
  byDirection: boolean;
  byDirectionAuthority: string;
  signatureImage?: SignatureImage;

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

  // Body
  body: string;

  // In reply to
  inReplyTo: boolean;
  inReplyToText: string;

  // Hyperlinks
  includeHyperlinks: boolean;
}

export interface DocTypeConfig {
  letterhead: boolean;
  ssic: boolean;
  fromTo: boolean;
  via: boolean;
  memoHeader: boolean;
  signature: 'abbrev' | 'full' | 'dual';
  uiMode: 'standard' | 'moa' | 'joint' | 'memo' | 'business';
  regulations: {
    fontSize: string;
    fontFamily: string;
    ref: string;
  };
}

export const DOC_TYPE_CONFIG: Record<string, DocTypeConfig> = {
  naval_letter: {
    letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 2-20' }
  },
  standard_letter: {
    letterhead: false, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 2-20' }
  },
  business_letter: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: false, signature: 'full', uiMode: 'business',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 11' }
  },
  multiple_address_letter: {
    letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 2-20' }
  },
  joint_letter: {
    letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: false, signature: 'dual', uiMode: 'joint',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 2-20' }
  },
  same_page_endorsement: {
    letterhead: false, ssic: false, fromTo: false, via: false, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 7' }
  },
  new_page_endorsement: {
    letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 7' }
  },
  mfr: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 10' }
  },
  plain_paper_memorandum: {
    letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' }
  },
  letterhead_memorandum: {
    letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' }
  },
  decision_memorandum: {
    letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' }
  },
  executive_memorandum: {
    letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: true, signature: 'full', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' }
  },
  moa: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: false, signature: 'dual', uiMode: 'moa',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' }
  },
  mou: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: false, signature: 'dual', uiMode: 'moa',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' }
  },
  joint_memorandum: {
    letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: true, signature: 'dual', uiMode: 'joint',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' }
  },
  mf: {
    letterhead: true, ssic: true, fromTo: false, via: false, memoHeader: true, signature: 'abbrev', uiMode: 'memo',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 10' }
  },
  executive_correspondence: {
    letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: false, signature: 'full', uiMode: 'standard',
    regulations: { fontSize: '12pt', fontFamily: 'times', ref: 'Ch 12' }
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

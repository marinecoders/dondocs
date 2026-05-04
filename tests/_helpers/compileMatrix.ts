/**
 * Fixture matrix for the LaTeX/DOCX compile integration tests.
 *
 * Strategy:
 *   - One realistic baseline `TestStore` per doc type, with the fields
 *     that doc type actually uses (joint letters need joint-prefixed
 *     fields, MOAs need senior- and junior-prefixed fields, executive
 *     memos need memorandumFor, etc.)
 *   - For each doc type, emit:
 *       1. baseline (everything default, minimal valid input)
 *       2. one fixture per binary flag toggled true
 *       3. one "everything-on" fixture
 *   - The cartesian product of every flag would explode; pairwise is
 *     overkill for a compile-error scan. The "each-flag-toggled +
 *     everything-on" approach catches every flag's interaction with
 *     the doc type's structural rendering, which is where most compile
 *     bugs hide.
 *
 * If a future regression turns out to live in a 2-way interaction we
 * can graduate to pairwise via `tests/_helpers/combinatorial.ts`.
 */
import type { TestStore } from './compileLatex';
import type {
  Reference,
  Enclosure,
  Paragraph,
  CopyTo,
  Distribution,
  DocumentData,
} from '@/types/document';

/**
 * All correspondence doc types. Forms (NAVMC 10274, 118-11) are
 * deliberately excluded — they go through pdf-lib overlay, not the
 * LaTeX pipeline, and have separate test coverage.
 */
export const ALL_DOC_TYPES = [
  'naval_letter',
  'standard_letter',
  'business_letter',
  'multiple_address_letter',
  'joint_letter',
  'joint_memorandum',
  'same_page_endorsement',
  'new_page_endorsement',
  'mfr',
  'mf',
  'plain_paper_memorandum',
  'letterhead_memorandum',
  'decision_memorandum',
  'executive_memorandum',
  'moa',
  'mou',
  'executive_correspondence',
  'standard_memorandum',
  'action_memorandum',
  'information_memorandum',
] as const;

export type DocType = typeof ALL_DOC_TYPES[number];

/**
 * Flags we toggle independently on top of each doc type's baseline.
 * Every entry here produces a fixture per doc type.
 */
export interface FlagOverrides {
  includeHyperlinks?: boolean;
  showSubjectOnContinuation?: boolean;
  byDirection?: boolean;
  inReplyTo?: boolean;
  classLevel?: 'unclassified' | 'cui' | 'secret';
  hasReferences?: boolean;
  hasEnclosures?: boolean;
  hasVia?: boolean;
  hasCopyTos?: boolean;
  hasDistributions?: boolean;
  /** Multi-paragraph body with nesting (catches label/wrap bugs). */
  longBody?: boolean;
  /** Subject with LaTeX special characters (catches escape bugs). */
  specialCharsInSubject?: boolean;
}

export interface Fixture {
  name: string;
  store: TestStore;
}

// ----- Realistic per-doc-type baseline factories -----

function commonSignatory(): Partial<DocumentData> {
  return {
    sigFirst: 'John',
    sigMiddle: 'A',
    sigLast: 'DOE',
    sigRank: 'Lieutenant Colonel',
    sigTitle: 'Commanding Officer',
    officeCode: 'S-3',
    byDirection: false,
    byDirectionAuthority: '',
    classLevel: 'unclassified',
    customClassification: '',
    pocEmail: 'john.doe@usmc.mil',
  };
}

function letterheadDefaults(): Partial<DocumentData> {
  return {
    department: 'usmc',
    unitLine1: '1ST BATTALION, 6TH MARINES',
    unitLine2: '2D MARINE DIVISION, II MEF',
    unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
    sealType: 'dow',
    letterheadColor: 'blue',
  };
}

function commonHeader(): Partial<DocumentData> {
  return {
    fontSize: '12pt',
    fontFamily: 'times',
    pageNumbering: 'none',
    ssic: '1000',
    serial: '0123',
    date: '15 Jan 26',
  };
}

const SIMPLE_PARAGRAPHS: Paragraph[] = [
  { text: 'Subject paragraph one with normal text and a [PLACEHOLDER].', level: 0 },
  { text: 'A nested item with technical jargon.', level: 1 },
];

const LONG_PARAGRAPHS: Paragraph[] = [
  { text: 'First top-level paragraph with content that exceeds typical width to exercise the wrapper at level 0 indentation.', level: 0 },
  { text: 'Sub-paragraph at level 1 with a few continuation candidates.', level: 1 },
  { text: 'Sub-sub at level 2 nested deeper to test label letter wrapping.', level: 2 },
  { text: 'Numbered parenthesized at level 3 testing (1) format.', level: 3 },
  { text: 'Top-level second paragraph following deep nesting.', level: 0 },
];

const REFS: Reference[] = [
  { letter: 'a', title: 'MCO 5216.20B' },
  { letter: 'b', title: 'SECNAV M-5216.5' },
];

const ENCS: Enclosure[] = [
  { title: 'Operational Readiness Report' },
  { title: 'Personnel Roster' },
];

const COPY_TOS: CopyTo[] = [{ text: 'G-3/5' }, { text: 'G-4' }];
const DISTROS: Distribution[] = [{ text: 'A' }, { text: 'B' }];

/**
 * Build a baseline TestStore for a doc type. Keeps it valid (no
 * undefined-macro errors) — the docType-specific fields each template
 * actually requires are populated.
 */
export function buildBaseline(docType: DocType): TestStore {
  const base: TestStore = {
    docType,
    formData: {
      docType,
      ...commonHeader(),
      ...letterheadDefaults(),
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'Commanding General, II Marine Expeditionary Force',
      via: '',
      subject: 'OPERATIONAL READINESS REPORT',
      ...commonSignatory(),
      includeHyperlinks: false,
      showSubjectOnContinuation: false,
      inReplyTo: false,
      inReplyToText: '',
      salutation: 'Dear Sir or Madam:',
      complimentaryClose: 'Sincerely,',
    },
    references: [],
    enclosures: [],
    paragraphs: SIMPLE_PARAGRAPHS,
    copyTos: [],
    distributions: [],
  };

  // Doc-type-specific field overrides
  switch (docType) {
    case 'business_letter':
      base.formData!.to = 'Acme Corporation\n123 Main Street\nAnytown, USA 12345';
      break;

    case 'joint_letter':
    case 'joint_memorandum':
      base.formData = {
        ...base.formData,
        jointSeniorName: 'COMMANDANT OF THE MARINE CORPS',
        jointSeniorZip: '20380',
        jointSeniorCode: 'PP&O',
        jointSeniorFrom: 'Commandant of the Marine Corps',
        jointSeniorSigName: 'D. R. SMITH',
        jointSeniorSigTitle: 'General, U.S. Marine Corps',
        jointJuniorName: 'CHIEF OF NAVAL OPERATIONS',
        jointJuniorZip: '20350',
        jointJuniorCode: 'N00',
        jointJuniorSSIC: '1000',
        jointJuniorSerial: '0001',
        jointJuniorDate: '15 Jan 26',
        jointJuniorSigName: 'M. K. JONES',
        jointJuniorSigTitle: 'Admiral, U.S. Navy',
        jointJuniorFrom: 'Chief of Naval Operations',
        jointCommonLocation: 'Washington, D.C.',
        jointTo: 'Secretary of the Navy',
        jointSubject: 'JOINT POLICY STATEMENT ON READINESS',
        // joint_memorandum needs jointMemo* signatory fields
        jointMemoSeniorFrom: 'Commandant of the Marine Corps',
        jointMemoSeniorSigName: 'D. R. SMITH',
        jointMemoSeniorSigTitle: 'General, U.S. Marine Corps',
        jointMemoJuniorFrom: 'Chief of Naval Operations',
        jointMemoJuniorSigName: 'M. K. JONES',
        jointMemoJuniorSigTitle: 'Admiral, U.S. Navy',
      };
      break;

    case 'moa':
    case 'mou':
      base.formData = {
        ...base.formData,
        seniorCommandName: 'UNITED STATES MARINE CORPS',
        seniorSSIC: '1000',
        seniorSerial: '0001',
        seniorDate: '15 Jan 26',
        seniorSigName: 'D. R. SMITH',
        seniorSigRank: 'General',
        seniorSigTitle: 'Commandant of the Marine Corps',
        juniorCommandName: 'UNITED STATES NAVY',
        juniorSSIC: '1000',
        juniorSerial: '0002',
        juniorDate: '15 Jan 26',
        juniorSigName: 'M. K. JONES',
        juniorSigRank: 'Admiral',
        juniorSigTitle: 'Chief of Naval Operations',
        moaSubject: 'AGREEMENT ON JOINT OPERATIONS',
      };
      break;

    case 'same_page_endorsement':
    case 'new_page_endorsement':
      base.formData = {
        ...base.formData,
        endorsementOrdinal: 'FIRST',
        basicLetterId: '1st Bn ltr 1000 Ser 0123 of 15 Jan 26',
      };
      break;

    case 'standard_memorandum':
    case 'action_memorandum':
    case 'information_memorandum':
    case 'executive_memorandum':
    case 'executive_correspondence':
      base.formData = {
        ...base.formData,
        date: 'January 15, 2026',  // executive uses spelled format
        subject: 'Quarterly Report on Personnel Readiness',  // Title Case for executive
        memorandumFor: 'Secretary of the Navy',
        attnLine: '',
        throughLine: '',
        coordination: '',
        preparedBy: 'CAPT John Smith, USN',
      };
      break;

    case 'mf':
      base.formData!.to = 'All Department Heads';
      break;

    default:
      // letterhead_memorandum, plain_paper_memorandum, decision_memorandum,
      // mfr, naval_letter, standard_letter, multiple_address_letter
      // — all use the standard baseline.
      break;
  }

  return base;
}

/**
 * Apply flag overrides to a baseline. Returns a NEW TestStore (no mutation).
 */
export function applyFlags(base: TestStore, flags: FlagOverrides): TestStore {
  const store: TestStore = {
    ...base,
    formData: { ...base.formData },
    references: [...base.references],
    enclosures: [...base.enclosures],
    paragraphs: [...base.paragraphs],
    copyTos: [...base.copyTos],
    distributions: [...base.distributions],
  };

  if (flags.includeHyperlinks !== undefined) {
    store.formData.includeHyperlinks = flags.includeHyperlinks;
  }
  if (flags.showSubjectOnContinuation !== undefined) {
    store.formData.showSubjectOnContinuation = flags.showSubjectOnContinuation;
  }
  if (flags.byDirection) {
    store.formData.byDirection = true;
    store.formData.byDirectionAuthority = 'TITLE 10 USC 5012';
  }
  if (flags.inReplyTo) {
    store.formData.inReplyTo = true;
    store.formData.inReplyToText = '1000 Ser N00/12345 of 1 Jan 26';
  }
  if (flags.classLevel) {
    store.formData.classLevel = flags.classLevel;
    if (flags.classLevel !== 'unclassified') {
      store.formData.classifiedBy = 'OPNAVINST 5510.1';
      store.formData.derivedFrom = 'Multiple Sources';
      store.formData.declassifyOn = '20460115';
      store.formData.classReason = '1.4(a)';
      store.formData.classifiedPocEmail = 'classified.poc@usmc.mil';
    }
  }
  if (flags.hasReferences) store.references = REFS;
  if (flags.hasEnclosures) store.enclosures = ENCS;
  if (flags.hasVia) {
    store.formData.via = 'Commanding Officer, Marine Corps Base\nCommanding General, MARFORCOM';
  }
  if (flags.hasCopyTos) store.copyTos = COPY_TOS;
  if (flags.hasDistributions) store.distributions = DISTROS;
  if (flags.longBody) store.paragraphs = LONG_PARAGRAPHS;
  if (flags.specialCharsInSubject) {
    // Every LaTeX special: & % $ # _ { } ~ ^ \\
    // Catches escape regressions for any flag that touches subject rendering.
    const special = 'BUDGET & POLICY: 50% INCREASE FOR Q1 #1 PRIORITY';
    if (store.formData.jointSubject) store.formData.jointSubject = special;
    else if (store.formData.moaSubject) store.formData.moaSubject = special;
    else store.formData.subject = special;
  }

  return store;
}

/**
 * The smoke matrix: baseline + each-flag-toggled + everything-on, per doc type.
 *
 * Per-type fixture count: 1 (baseline) + N (toggled flags) + 1 (everything) = ~13.
 * Across 20 doc types ≈ 260 fixtures.
 *
 * Per-fixture compile cost ≈ 1-2s on a modern machine. Whole matrix:
 * ~5-10 min serial, ~1-2 min on a 4-way shard.
 */
export function smokeMatrix(): Fixture[] {
  const fixtures: Fixture[] = [];

  for (const docType of ALL_DOC_TYPES) {
    const baseline = buildBaseline(docType);

    fixtures.push({ name: `${docType}:baseline`, store: baseline });

    fixtures.push({
      name: `${docType}:hyperlinks`,
      store: applyFlags(baseline, { includeHyperlinks: true, hasReferences: true }),
    });
    fixtures.push({
      name: `${docType}:byDirection`,
      store: applyFlags(baseline, { byDirection: true }),
    });
    fixtures.push({
      name: `${docType}:inReplyTo`,
      store: applyFlags(baseline, { inReplyTo: true }),
    });
    fixtures.push({
      name: `${docType}:cui`,
      store: applyFlags(baseline, { classLevel: 'cui' }),
    });
    fixtures.push({
      name: `${docType}:references`,
      store: applyFlags(baseline, { hasReferences: true }),
    });
    fixtures.push({
      name: `${docType}:enclosures`,
      store: applyFlags(baseline, { hasEnclosures: true }),
    });
    fixtures.push({
      name: `${docType}:via`,
      store: applyFlags(baseline, { hasVia: true }),
    });
    fixtures.push({
      name: `${docType}:copyTos`,
      store: applyFlags(baseline, { hasCopyTos: true }),
    });
    fixtures.push({
      name: `${docType}:distributions`,
      store: applyFlags(baseline, { hasDistributions: true }),
    });
    fixtures.push({
      name: `${docType}:longBody`,
      store: applyFlags(baseline, { longBody: true }),
    });
    fixtures.push({
      name: `${docType}:specialChars`,
      store: applyFlags(baseline, { specialCharsInSubject: true }),
    });
    fixtures.push({
      name: `${docType}:everything`,
      store: applyFlags(baseline, {
        includeHyperlinks: true,
        showSubjectOnContinuation: true,
        byDirection: true,
        inReplyTo: true,
        classLevel: 'cui',
        hasReferences: true,
        hasEnclosures: true,
        hasVia: true,
        hasCopyTos: true,
        hasDistributions: true,
        longBody: true,
        specialCharsInSubject: true,
      }),
    });
  }

  return fixtures;
}

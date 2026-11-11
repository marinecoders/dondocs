/**
 * Native compile fixture builders: a baseline per matrix format, a covering
 * pairwise matrix, an optional single-flag smoke matrix and a streamed full
 * Cartesian product. The integration suites consume pairwiseMatrix().
 * docs/PROJECT_INVENTORY.md derives current counts from these builders.
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
import { pairwise } from './combinatorial';

/**
 * Matrix formats, including I-Type and SL-3. SL-4 and TM front matter have
 * dedicated structured-publication tests. Forms use separate PDF overlay
 * renderers/tests and are not part of this LaTeX fixture list.
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
  'i_type',
  'sl3',
] as const;

export type DocType = typeof ALL_DOC_TYPES[number];

/**
 * Every per-docType dimension a fixture can vary. Categorized:
 *
 *   Multi-value (rendering-mode dimensions — each branches generator output):
 *     classLevel       — 6 values: unclassified, cui, confidential,
 *                        secret, top_secret, top_secret_sci
 *                        (omits 'custom', which requires
 *                        customClassification to be set; covered
 *                        separately if needed.)
 *     fontSize         — 10pt / 11pt / 12pt
 *     fontFamily       — times / courier
 *     pageNumbering    — none / simple / xofy
 *     letterheadColor  — blue / black
 *     signatureType    — none / digital
 *                        (omits 'image', which needs base64-encoded
 *                        image bytes — provided in a separate
 *                        targeted test if needed.)
 *
 *   Boolean flags (each toggles a code path or content branch):
 *     underlineSubject, includeHyperlinks, showSubjectOnContinuation,
 *     byDirection, inReplyTo, hasReferences, hasEnclosures, hasVia,
 *     hasCopyTos, hasDistributions, longBody, specialCharsInSubject
 */
export interface FlagOverrides {
  classLevel?: 'unclassified' | 'cui' | 'confidential' | 'secret' | 'top_secret' | 'top_secret_sci';
  fontSize?: '10pt' | '11pt' | '12pt';
  fontFamily?: 'times' | 'courier';
  pageNumbering?: 'none' | 'simple' | 'xofy';
  letterheadColor?: 'blue' | 'black';
  signatureType?: 'none' | 'digital';
  underlineSubject?: boolean;
  includeHyperlinks?: boolean;
  showSubjectOnContinuation?: boolean;
  byDirection?: boolean;
  inReplyTo?: boolean;
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

  // Multi-value rendering-mode dimensions
  if (flags.fontSize !== undefined) store.formData.fontSize = flags.fontSize;
  if (flags.fontFamily !== undefined) store.formData.fontFamily = flags.fontFamily;
  if (flags.pageNumbering !== undefined) store.formData.pageNumbering = flags.pageNumbering;
  if (flags.letterheadColor !== undefined) store.formData.letterheadColor = flags.letterheadColor;
  if (flags.signatureType !== undefined) store.formData.signatureType = flags.signatureType;

  // Boolean flags
  if (flags.underlineSubject !== undefined) {
    store.formData.underlineSubject = flags.underlineSubject;
  }
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

  // classLevel branches into different field setups. CUI uses the
  // cui*-prefixed fields; confidential/secret/topsecret/topsecret-sci
  // use the classified*-prefixed fields. Setting both is harmless but
  // wasteful — we set only the relevant ones to keep test fixtures
  // closer to real user input.
  if (flags.classLevel) {
    store.formData.classLevel = flags.classLevel;
    if (flags.classLevel === 'cui') {
      store.formData.cuiControlledBy = 'DOD';
      store.formData.cuiCategory = 'PRVCY';
      store.formData.cuiDissemination = 'FEDCON';
      store.formData.cuiDistStatement = 'D';
    } else if (flags.classLevel !== 'unclassified') {
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
 * See docs/PROJECT_INVENTORY.md for the generated current totals.
 *
 * Currently NOT used by the integration suite — `pairwiseMatrix()`
 * subsumes it. Retained for situations where a faster local sanity
 * run is wanted (single-flag-at-a-time, no pair coverage).
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

/**
 * Pairwise matrix — every 2-way interaction of flag values is covered
 * AT LEAST ONCE, per doc type.
 *
 * Pairwise covers interactions between dimensions without enumerating the full
 * product. The covering array includes each pair of values for the dimensions
 * below. Regenerate docs/PROJECT_INVENTORY.md after changing the builder.
 */
export function pairwiseMatrix(): Fixture[] {
  const dims = {
    classLevel: ['unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'] as const,
    fontSize: ['10pt', '11pt', '12pt'] as const,
    fontFamily: ['times', 'courier'] as const,
    pageNumbering: ['none', 'simple', 'xofy'] as const,
    letterheadColor: ['blue', 'black'] as const,
    signatureType: ['none', 'digital'] as const,
    underlineSubject: [false, true] as const,
    includeHyperlinks: [false, true] as const,
    showSubjectOnContinuation: [false, true] as const,
    byDirection: [false, true] as const,
    inReplyTo: [false, true] as const,
    hasReferences: [false, true] as const,
    hasEnclosures: [false, true] as const,
    hasVia: [false, true] as const,
    hasCopyTos: [false, true] as const,
    hasDistributions: [false, true] as const,
    longBody: [false, true] as const,
    specialCharsInSubject: [false, true] as const,
  };

  // The covering array is identical across doc types (same dimension
  // structure), so generate once and reuse. The doc-type-specific
  // fixture comes from threading the row through `applyFlags` on each
  // doc type's baseline.
  const rows = pairwise(dims);

  const fixtures: Fixture[] = [];
  for (const docType of ALL_DOC_TYPES) {
    const baseline = buildBaseline(docType);
    rows.forEach((row, idx) => {
      // Compact 4-digit hex of the row index — keeps test names short
      // while staying unique. The actual flag values are visible in
      // the failure message via fixture inspection.
      const id = idx.toString(16).padStart(4, '0');
      fixtures.push({
        name: `${docType}:pw#${id}`,
        store: applyFlags(baseline, row as FlagOverrides),
      });
    });
  }

  // Unsigned-draft guard: every doc type must also compile with an EMPTY
  // signatory name. A document legitimately reaches the compiler unsigned —
  // SECNAV allows unsigned drafts, "Clear all fields" wipes the signature, and
  // a profile may carry no signer (the editor-ux default profile did, so every
  // new doc hit this). The pairwise rows above always populate the signatory,
  // so this case was uncovered: `\printSignature`'s `\MakeUppercase{}\\` fataled
  // with "There's no line here to end." The signature block must render blank.
  for (const docType of ALL_DOC_TYPES) {
    const baseline = buildBaseline(docType);
    fixtures.push({
      name: `${docType}:unsigned`,
      store: {
        ...baseline,
        formData: {
          ...baseline.formData,
          sigFirst: '', sigMiddle: '', sigLast: '',
          sigRank: '', sigTitle: '', officeCode: '',
          // Dual-signatory doc types (MOA/MOU, joint letter/memo) read their own
          // signer fields, so empty those too — otherwise their `:unsigned` rows
          // would still carry names and never exercise the empty path. They end
          // name lines with \par (not \\) so they don't crash today, but this
          // keeps the guard honest if a future edit changes that.
          seniorSigName: '', seniorSigRank: '', seniorSigTitle: '',
          juniorSigName: '', juniorSigRank: '', juniorSigTitle: '',
          jointSeniorSigName: '', jointSeniorSigTitle: '',
          jointJuniorSigName: '', jointJuniorSigTitle: '',
          jointMemoSeniorSigName: '', jointMemoSeniorSigTitle: '',
          jointMemoJuniorSigName: '', jointMemoJuniorSigTitle: '',
        },
      },
    });
  }

  return fixtures;
}

// ----- Full cartesian (every combination of every dimension) -----
//
// Counts are computed below and published by npm run docs:inventory.
// A CLI streams rows rather than allocating millions of test cases up front.
// Names use a seven-digit hexadecimal offset so a failure can be selected with
// --doc-type=X --start=N --end=N+1. See tests/cartesian/README.md.

const CART_DIMS = {
  classLevel: ['unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'] as const,
  fontSize: ['10pt', '11pt', '12pt'] as const,
  fontFamily: ['times', 'courier'] as const,
  pageNumbering: ['none', 'simple', 'xofy'] as const,
  letterheadColor: ['blue', 'black'] as const,
  signatureType: ['none', 'digital'] as const,
} as const;

const CART_BOOL_KEYS = [
  'underlineSubject',
  'includeHyperlinks',
  'showSubjectOnContinuation',
  'byDirection',
  'inReplyTo',
  'hasReferences',
  'hasEnclosures',
  'hasVia',
  'hasCopyTos',
  'hasDistributions',
  'longBody',
  'specialCharsInSubject',
] as const satisfies readonly (keyof FlagOverrides)[];

const CART_BOOL_COUNT = CART_BOOL_KEYS.length;
const CART_BOOL_COMBOS = 1 << CART_BOOL_COUNT; // 2^12 = 4096

/** Cartesian size per doc type, computed once. */
export const CARTESIAN_PER_DOCTYPE: number =
  CART_DIMS.classLevel.length *
  CART_DIMS.fontSize.length *
  CART_DIMS.fontFamily.length *
  CART_DIMS.pageNumbering.length *
  CART_DIMS.letterheadColor.length *
  CART_DIMS.signatureType.length *
  CART_BOOL_COMBOS;

/** Total cartesian size across every correspondence doc type. */
export const CARTESIAN_TOTAL: number = CARTESIAN_PER_DOCTYPE * ALL_DOC_TYPES.length;

/**
 * Map a 0-based offset within `[0, CARTESIAN_PER_DOCTYPE)` to a `FlagOverrides`
 * value. The offset's bit/digit positions encode each dimension. Mirrors the
 * iteration order used by the generator below.
 */
function flagsFromOffset(offset: number): FlagOverrides {
  let n = offset;
  const bools = n & (CART_BOOL_COMBOS - 1); n >>>= CART_BOOL_COUNT;
  const sigType = CART_DIMS.signatureType[n % CART_DIMS.signatureType.length]; n = Math.floor(n / CART_DIMS.signatureType.length);
  const lhColor = CART_DIMS.letterheadColor[n % CART_DIMS.letterheadColor.length]; n = Math.floor(n / CART_DIMS.letterheadColor.length);
  const pageNum = CART_DIMS.pageNumbering[n % CART_DIMS.pageNumbering.length]; n = Math.floor(n / CART_DIMS.pageNumbering.length);
  const fontFam = CART_DIMS.fontFamily[n % CART_DIMS.fontFamily.length]; n = Math.floor(n / CART_DIMS.fontFamily.length);
  const fontSz = CART_DIMS.fontSize[n % CART_DIMS.fontSize.length]; n = Math.floor(n / CART_DIMS.fontSize.length);
  const classLv = CART_DIMS.classLevel[n % CART_DIMS.classLevel.length];

  const flags: FlagOverrides = {
    classLevel: classLv,
    fontSize: fontSz,
    fontFamily: fontFam,
    pageNumbering: pageNum,
    letterheadColor: lhColor,
    signatureType: sigType,
  };
  for (let i = 0; i < CART_BOOL_COUNT; i++) {
    (flags as Record<string, unknown>)[CART_BOOL_KEYS[i]] = !!(bools & (1 << i));
  }
  return flags;
}

/**
 * Lazy generator over the full cartesian product.
 *
 * @param docType   restrict to a single doc type, or undefined for all 20
 * @param start     global offset to start at (inclusive)
 * @param end       global offset to stop at (exclusive); defaults to total
 *
 * Streaming — emits fixtures one at a time without materializing the array.
 * Safe to use with millions of rows on a normal-RAM machine.
 *
 * Global offset:
 *   docTypeIndex * CARTESIAN_PER_DOCTYPE + offsetWithinDocType
 *
 * The hex name format `<docType>:cart#<7-digit-hex>` encodes the
 * offsetWithinDocType (0..CARTESIAN_PER_DOCTYPE-1).
 */
export function* cartesianGenerator(
  docType?: DocType,
  start: number = 0,
  end: number = docType ? CARTESIAN_PER_DOCTYPE : CARTESIAN_TOTAL
): Generator<Fixture> {
  if (docType) {
    // Single doc type — offset is local.
    const baseline = buildBaseline(docType);
    const lo = Math.max(0, Math.floor(start));
    const hi = Math.min(CARTESIAN_PER_DOCTYPE, Math.floor(end));
    for (let i = lo; i < hi; i++) {
      yield {
        name: `${docType}:cart#${i.toString(16).padStart(7, '0')}`,
        store: applyFlags(baseline, flagsFromOffset(i)),
      };
    }
    return;
  }

  // All doc types — global offset.
  const lo = Math.max(0, Math.floor(start));
  const hi = Math.min(CARTESIAN_TOTAL, Math.floor(end));
  for (let global = lo; global < hi; global++) {
    const docIdx = Math.floor(global / CARTESIAN_PER_DOCTYPE);
    const localIdx = global % CARTESIAN_PER_DOCTYPE;
    const dt = ALL_DOC_TYPES[docIdx];
    const baseline = buildBaseline(dt);
    yield {
      name: `${dt}:cart#${localIdx.toString(16).padStart(7, '0')}`,
      store: applyFlags(baseline, flagsFromOffset(localIdx)),
    };
  }
}

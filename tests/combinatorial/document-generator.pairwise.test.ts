/**
 * Pairwise combinatorial test for the LaTeX correspondence generator.
 *
 * The dimensions below carve out the user-visible feature space:
 * which doc type, what classification, with or without each of the
 * optional sections (refs, enclosures, copy-tos, via line, POC, etc.)
 *
 * Full cartesian product of these dims is ~24,000 cases. A pairwise
 * (all-pairs) covering set is ~25-30 cases — every two-way interaction
 * is exercised, and empirically that's where ~80-90% of integration
 * bugs live. PR #65 (the wrap-helper bug) was a 2-way interaction
 * (`level-2 label` × `paragraph that wraps`); PR #64 (the SECRET-
 * default safety bug) was a 2-way interaction (`UI default` ×
 * `classification level`). Both would have been caught by a test
 * shape like this if it had existed.
 *
 * Each generated row runs the full `generateAllLatexFiles` pipeline
 * and asserts:
 *
 *   1. No exception thrown anywhere in the pipeline.
 *   2. Every emitted .tex file is a non-empty string.
 *   3. The user-supplied SUBJECT survives into `document.tex`
 *      (a regression that drops the subject is the canonical
 *      "the bug is silent until users notice" failure).
 *
 * The wall-time cost is small — pairwise compresses the matrix down
 * to ~30 cases × ~5ms each = ~150ms.
 */
import { describe, it, expect } from 'vitest';
import {
  generateDocumentTex,
  generateAllLatexFiles,
} from '@/services/latex/generator';
import type {
  Reference,
  Enclosure,
  Paragraph,
  CopyTo,
  Distribution,
  DocumentData,
} from '@/types/document';
import { pairwise, rowName } from '../_helpers/combinatorial';

interface TestStore {
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];
}

const dims = {
  docType: [
    'naval_letter',
    'memorandum',
    'endorsement',
    'mf',
    'standard_memorandum',
    'action_memorandum',
    'information_memorandum',
  ] as const,
  classification: [
    'unclassified',
    'cui',
    'confidential',
    'secret',
    'top_secret',
  ] as const,
  paragraphShape: ['flat', 'multilevel', 'empty'] as const,
  refsCount: ['none', 'one', 'many'] as const,
  hasEnclosures: ['none', 'one'] as const,
  hasCopyTos: ['none', 'two'] as const,
  hasVia: [false, true] as const,
  hasPocEmail: [false, true] as const,
  fontSize: ['10pt', '11pt', '12pt'] as const,
  byDirection: [false, true] as const,
};

type Row = ReturnType<typeof pairwise<typeof dims>>[number];

const PARAGRAPHS_FLAT: Paragraph[] = [
  { text: '1. The unit reports operational readiness.', level: 0 },
  { text: '2. All personnel are current on training.', level: 0 },
];

const PARAGRAPHS_MULTILEVEL: Paragraph[] = [
  { text: '1. Operational status update.', level: 0 },
  { text: '   a. Pull-ups: 2 (minimum 4 required)', level: 1 },
  { text: '       (1) Annual fitness assessment overdue.', level: 2 },
  { text: '   b. Crunches: 85', level: 1 },
  { text: '2. Recommended actions.', level: 0 },
];

function buildStore(row: Row): TestStore {
  return {
    docType: row.docType,
    formData: {
      docType: row.docType,
      fontSize: row.fontSize,
      fontFamily: 'times',
      pageNumbering: 'none',
      department: 'usmc',
      unitLine1: '1ST BATTALION, 6TH MARINES',
      unitLine2: '2D MARINE DIVISION, II MEF',
      unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
      sealType: 'dow',
      letterheadColor: 'blue',
      ssic: '1000',
      serial: '0123',
      date: '15 Jan 25',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'Commanding General, II Marine Expeditionary Force',
      via: row.hasVia ? '(1) XO\n(2) S-3' : '',
      subject: 'PAIRWISE COMBINATORIAL TEST SUBJECT',
      sigFirst: 'John',
      sigMiddle: 'A',
      sigLast: 'DOE',
      sigRank: 'Lieutenant Colonel',
      sigTitle: 'Commanding Officer',
      officeCode: 'S-3',
      classLevel: row.classification,
      pocEmail: row.hasPocEmail ? 'john.doe@usmc.mil' : '',
      byDirection: row.byDirection,
      byDirectionAuthority: row.byDirection ? 'CG, II MEF' : '',
      salutation: 'Dear Sir or Madam:',
      complimentaryClose: 'Sincerely,',
    },
    references:
      row.refsCount === 'none'
        ? []
        : row.refsCount === 'one'
          ? [{ letter: 'a', title: 'MCO 6100.13A W/CH 1' }]
          : [
              { letter: 'a', title: 'MCO 6100.13A W/CH 1' },
              { letter: 'b', title: 'MCO 1610.7A' },
              { letter: 'c', title: 'Unit PT Policy dtd 01 Oct 24' },
            ],
    enclosures:
      row.hasEnclosures === 'none'
        ? []
        : [{ title: 'PFT Scorecard dtd 15 Jan 2025' }],
    paragraphs:
      row.paragraphShape === 'flat'
        ? PARAGRAPHS_FLAT
        : row.paragraphShape === 'multilevel'
          ? PARAGRAPHS_MULTILEVEL
          : [],
    copyTos: row.hasCopyTos === 'none' ? [] : [{ text: 'G-3/5' }, { text: 'G-4' }],
    distributions: [],
  };
}

const rows = pairwise(dims);

describe(`generateAllLatexFiles — pairwise (${rows.length} rows from ${
  dims.docType.length *
  dims.classification.length *
  dims.paragraphShape.length *
  dims.refsCount.length *
  dims.hasEnclosures.length *
  dims.hasCopyTos.length *
  dims.hasVia.length *
  dims.hasPocEmail.length *
  dims.fontSize.length *
  dims.byDirection.length
} cartesian combos)`, () => {
  for (const row of rows) {
    it(`runs without throwing: ${rowName(row)}`, () => {
      const store = buildStore(row);
      // 1. End-to-end pipeline doesn't throw.
      expect(() => generateAllLatexFiles(store)).not.toThrow();

      const files = generateAllLatexFiles(store);

      // 2. Every emitted file is a non-empty string.
      for (const [name, content] of Object.entries(files.texFiles)) {
        expect(content, `${name} should be non-empty`).toBeTruthy();
        expect(typeof content).toBe('string');
        expect(content.length).toBeGreaterThan(0);
      }

      // 3. The user-supplied subject survived into document.tex.
      // Executive memo doc types title-case the subject (e.g.,
      // "PAIRWISE..." becomes "Pairwise..."), so we check
      // case-insensitive containment of a unique distinctive
      // substring — `combinatorial` doesn't appear elsewhere in the
      // template, so its presence proves the user's subject made it
      // into the output.
      const documentTex = generateDocumentTex(store);
      expect(documentTex.toLowerCase()).toContain('combinatorial');
    });
  }
});

/**
 * Random-store fuzz for the LaTeX correspondence generator.
 *
 * Where `tests/unit/latex-generator.smoke.test.ts` feeds the generator
 * a single hand-curated fixture, this fuzzer builds DocumentStore-shaped
 * objects with random everything: doc type, formData fields, paragraphs
 * at every level, references with adversarial titles, copyTos /
 * distributions, etc.
 *
 * Same contract: the generator must never throw on any shape-valid
 * store. A regression here means a real "Download PDF" call would
 * crash for some combination of fields a user types in. Fuzz catches
 * it before they do.
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  generateDocumentTex,
  generateLetterheadTex,
  generateSignatoryTex,
  generateClassificationTex,
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
import { adversarialString, adversarialSentence } from '../_helpers/fuzzArbitraries';

interface TestStore {
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];
}

const NUM_RUNS = 100;

const docTypeArb = fc.constantFrom(
  'naval_letter',
  'memorandum',
  'endorsement',
  'mf',
  'standard_memorandum',
  'action_memorandum',
  'information_memorandum',
);

const classLevelArb = fc.constantFrom(
  'unclassified',
  'cui',
  'confidential',
  'secret',
  'top_secret',
);

const referenceArb = fc.record({
  letter: fc.constantFrom('a', 'b', 'c', 'd', 'e'),
  title: adversarialSentence,
  url: fc.option(adversarialString, { nil: undefined }),
}) as fc.Arbitrary<Reference>;

const paragraphArb = fc.record({
  text: adversarialSentence,
  level: fc.integer({ min: 0, max: 7 }),
  header: fc.option(adversarialString, { nil: undefined }),
}) as fc.Arbitrary<Paragraph>;

const copyToArb = fc.record({ text: adversarialString }) as fc.Arbitrary<CopyTo>;
const distributionArb = fc.record({ text: adversarialString }) as fc.Arbitrary<Distribution>;

/**
 * Build a random formData object. Keys mirror the production
 * `DocumentData` shape; values are adversarial strings so the
 * downstream LaTeX escapes / wrap helpers / regex matchers all
 * get adversarial input.
 */
const formDataArb: fc.Arbitrary<Partial<DocumentData>> = fc.record(
  {
    docType: docTypeArb,
    fontSize: fc.constantFrom('10pt', '11pt', '12pt'),
    fontFamily: fc.constantFrom('times', 'courier'),
    pageNumbering: fc.constantFrom('none', 'arabic', 'roman'),
    department: fc.constantFrom('usmc', 'navy', 'army', 'af'),
    unitLine1: adversarialString,
    unitLine2: adversarialString,
    unitAddress: adversarialString,
    sealType: fc.constantFrom('dow', 'dod'),
    letterheadColor: fc.constantFrom('blue', 'black'),
    ssic: fc.string({ minLength: 0, maxLength: 8 }),
    serial: fc.string({ minLength: 0, maxLength: 8 }),
    date: adversarialString,
    from: adversarialString,
    to: adversarialString,
    via: adversarialString,
    subject: adversarialSentence,
    sigFirst: adversarialString,
    sigMiddle: adversarialString,
    sigLast: adversarialString,
    sigRank: adversarialString,
    sigTitle: adversarialString,
    officeCode: adversarialString,
    classLevel: classLevelArb,
    pocEmail: adversarialString,
    salutation: adversarialString,
    complimentaryClose: adversarialString,
  },
  { requiredKeys: ['docType'] }
);

const storeArb: fc.Arbitrary<TestStore> = fc.record({
  docType: docTypeArb,
  formData: formDataArb,
  references: fc.array(referenceArb, { maxLength: 5 }),
  enclosures: fc.array(fc.record({ title: adversarialString }), { maxLength: 3 }),
  paragraphs: fc.array(paragraphArb, { maxLength: 12 }),
  copyTos: fc.array(copyToArb, { maxLength: 5 }),
  distributions: fc.array(distributionArb, { maxLength: 5 }),
});

describe('generateDocumentTex — random-store fuzz', () => {
  it('never throws on adversarial DocumentStore shapes', () => {
    fc.assert(
      fc.property(storeArb, (store) => {
        generateDocumentTex(store);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('output is always a non-empty string', () => {
    fc.assert(
      fc.property(storeArb, (store) => {
        const tex = generateDocumentTex(store);
        if (typeof tex !== 'string' || tex.length === 0) {
          throw new Error(`Bad output: ${typeof tex}, length=${tex?.length}`);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('generateLetterheadTex / Signatory / Classification — random-store fuzz', () => {
  it('generateLetterheadTex never throws', () => {
    fc.assert(
      fc.property(storeArb, (store) => {
        generateLetterheadTex(store);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('generateSignatoryTex never throws', () => {
    fc.assert(
      fc.property(storeArb, (store) => {
        generateSignatoryTex(store);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('generateClassificationTex never throws', () => {
    fc.assert(
      fc.property(storeArb, (store) => {
        generateClassificationTex(store);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('generateAllLatexFiles — full pipeline random-store fuzz', () => {
  it('never throws end-to-end', () => {
    // The orchestration call: every named tex file + enclosure
    // metadata + ref URL extraction + signature image + classification
    // banner. If any step blows up, this catches it.
    fc.assert(
      fc.property(storeArb, (store) => {
        generateAllLatexFiles(store);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('every emitted .tex file is a non-empty string', () => {
    fc.assert(
      fc.property(storeArb, (store) => {
        const files = generateAllLatexFiles(store);
        for (const [name, content] of Object.entries(files.texFiles)) {
          if (typeof content !== 'string' || content.length === 0) {
            throw new Error(`Bad ${name}: ${typeof content}, length=${content?.length}`);
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

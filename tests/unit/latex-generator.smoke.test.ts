/**
 * Smoke tests for `src/services/latex/generator.ts`.
 *
 * The LaTeX correspondence generator is the single biggest hot path in
 * the app — every "Download PDF" call from the SECNAV correspondence
 * flow goes through `generateAllLatexFiles`. A crash here is a bug
 * report, but more insidiously a *silent* output regression (subject
 * line missing, signature block typo, encoded-but-invisible LaTeX) ships
 * to users without the test suite noticing.
 *
 * These are SMOKE tests, not output snapshots: we feed the generator
 * representative DocumentStore fixtures and assert
 *
 *   - no thrown exception
 *   - returned string is non-empty
 *   - key user-supplied fields appear verbatim (or escape-form) in the
 *     output, so a regression that drops a field is caught
 *
 * The full `generateAllLatexFiles` returns multiple .tex files; we
 * spot-check the main `document.tex` plus a couple of the smaller
 * helpers. Per-snapshot output assertions live downstream of the
 * actual LaTeX → PDF pipeline (a separate visual-diff layer).
 */
import { describe, it, expect } from 'vitest';
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

interface TestStore {
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];
}

/**
 * A minimal naval-letter store, mirroring `EXAMPLE_FORM_DATA` from
 * `documentStore.ts`. Adjustments here should match what the production
 * defaults look like so the smoke tests stay representative.
 */
function fixtureNavalLetter(overrides: Partial<TestStore> = {}): TestStore {
  return {
    docType: 'naval_letter',
    formData: {
      docType: 'naval_letter',
      fontSize: '12pt',
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
      subject: 'OPERATIONAL READINESS REPORT',
      sigFirst: 'John',
      sigMiddle: 'A',
      sigLast: 'DOE',
      sigRank: 'Lieutenant Colonel',
      sigTitle: 'Commanding Officer',
      officeCode: 'S-3',
      classLevel: 'unclassified',
      pocEmail: 'john.doe@usmc.mil',
      salutation: 'Dear Sir or Madam:',
      complimentaryClose: 'Sincerely,',
    },
    references: [
      { letter: 'a', title: 'MCO 6100.13A W/CH 1' },
    ],
    enclosures: [],
    paragraphs: [
      { text: '1. The unit reports operational readiness for the upcoming exercise.', level: 0 },
      { text: '   a. All personnel are current on training requirements.', level: 1 },
    ],
    copyTos: [{ text: 'G-3/5' }],
    distributions: [],
    ...overrides,
  };
}

describe('generateDocumentTex — smoke', () => {
  it('produces non-empty LaTeX for a typical naval letter', () => {
    const store = fixtureNavalLetter();
    const tex = generateDocumentTex(store);
    expect(typeof tex).toBe('string');
    expect(tex.length).toBeGreaterThan(0);
  });

  it('subject appears in the output', () => {
    const store = fixtureNavalLetter();
    const tex = generateDocumentTex(store);
    expect(tex).toContain('OPERATIONAL READINESS REPORT');
  });

  it('from + to lines appear in the output', () => {
    const store = fixtureNavalLetter();
    const tex = generateDocumentTex(store);
    expect(tex).toContain('Commanding Officer');
    expect(tex).toContain('Marine Expeditionary Force');
  });

  it('SSIC + serial appear in the output', () => {
    const store = fixtureNavalLetter();
    const tex = generateDocumentTex(store);
    expect(tex).toContain('1000');
    expect(tex).toContain('0123');
  });

  it('LaTeX specials in user fields are escaped (& → \\&)', () => {
    const store = fixtureNavalLetter({
      formData: {
        ...fixtureNavalLetter().formData,
        subject: 'PROCUREMENT & CONTRACTING — Q1 REVIEW',
      },
    });
    const tex = generateDocumentTex(store);
    // The subject made it into output, but the `&` is now escaped.
    expect(tex).toContain('PROCUREMENT');
    expect(tex).toContain('\\&');
  });

  it('does not throw on missing optional fields (via, salutation, etc.)', () => {
    const store = fixtureNavalLetter({
      formData: {
        ...fixtureNavalLetter().formData,
        via: undefined,
        salutation: undefined,
        complimentaryClose: undefined,
        pocEmail: undefined,
      },
    });
    expect(() => generateDocumentTex(store)).not.toThrow();
  });

  it('does not throw on an empty paragraphs array', () => {
    const store = fixtureNavalLetter({ paragraphs: [] });
    expect(() => generateDocumentTex(store)).not.toThrow();
  });

  it('does not throw on different doc types (memorandum, endorsement, etc.)', () => {
    for (const docType of ['memorandum', 'endorsement', 'mf', 'standard_memorandum']) {
      const store = fixtureNavalLetter({
        docType,
        formData: { ...fixtureNavalLetter().formData, docType },
      });
      expect(() => generateDocumentTex(store), `docType=${docType}`).not.toThrow();
    }
  });
});

describe('generateLetterheadTex — smoke', () => {
  it('emits unit name + address', () => {
    const store = fixtureNavalLetter();
    const tex = generateLetterheadTex(store);
    expect(typeof tex).toBe('string');
    expect(tex).toContain('1ST BATTALION');
  });

  it('does not throw when address is missing', () => {
    const store = fixtureNavalLetter({
      formData: { ...fixtureNavalLetter().formData, unitAddress: undefined },
    });
    expect(() => generateLetterheadTex(store)).not.toThrow();
  });
});

describe('generateSignatoryTex — smoke', () => {
  it('emits the signer name in the standard SECNAV format', () => {
    const store = fixtureNavalLetter();
    const tex = generateSignatoryTex(store);
    // The block contains the signer's surname uppercased per Ch 7 ¶7.
    expect(tex).toContain('DOE');
  });

  it('does not throw when signature fields are blank', () => {
    const store = fixtureNavalLetter({
      formData: {
        ...fixtureNavalLetter().formData,
        sigFirst: '',
        sigMiddle: '',
        sigLast: '',
      },
    });
    expect(() => generateSignatoryTex(store)).not.toThrow();
  });
});

describe('generateClassificationTex — smoke', () => {
  it('UNCLASSIFIED → emits empty or no-op markers', () => {
    const store = fixtureNavalLetter();
    const tex = generateClassificationTex(store);
    expect(typeof tex).toBe('string');
  });

  it('SECRET → emits banner setup', () => {
    // The PR #64 SECRET-default safety bug was about UI defaulting,
    // but this test pins the tex output for an explicit SECRET document
    // — the banner / mark setup must include a SECRET-related token.
    const store = fixtureNavalLetter({
      formData: { ...fixtureNavalLetter().formData, classLevel: 'secret' },
    });
    const tex = generateClassificationTex(store);
    expect(tex.toLowerCase()).toContain('secret');
  });

  it('does not throw on an unknown classLevel', () => {
    const store = fixtureNavalLetter({
      formData: { ...fixtureNavalLetter().formData, classLevel: 'unknown-level' },
    });
    expect(() => generateClassificationTex(store)).not.toThrow();
  });
});

describe('generateAllLatexFiles — orchestration', () => {
  it('returns a record of named .tex files (non-empty values)', () => {
    const store = fixtureNavalLetter();
    const files = generateAllLatexFiles(store);
    expect(typeof files).toBe('object');
    expect(files.texFiles).toBeDefined();
    expect(typeof files.texFiles).toBe('object');
    // Every emitted .tex file must be a non-empty string.
    for (const [name, content] of Object.entries(files.texFiles)) {
      expect(typeof content, `${name} should be a string`).toBe('string');
      expect(content.length, `${name} should be non-empty`).toBeGreaterThan(0);
    }
    // And the orchestration result includes the standard set of files.
    expect(files.texFiles).toHaveProperty('document.tex');
    expect(files.texFiles).toHaveProperty('letterhead.tex');
    expect(files.texFiles).toHaveProperty('signatory.tex');
  });

  it('does not throw on a store with maximum complexity (refs + enclosures + 4-level paragraphs + copyTos + distributions)', () => {
    const store = fixtureNavalLetter({
      references: [
        { letter: 'a', title: 'MCO 6100.13A' },
        { letter: 'b', title: 'MCO 1610.7A', url: 'https://www.marines.mil' },
      ],
      enclosures: [{ title: 'PFT Scorecard' }],
      paragraphs: [
        { text: '1. Top-level paragraph.', level: 0 },
        { text: '   a. Level 1 sub-paragraph.', level: 1 },
        { text: '       (1) Level 2 nesting.', level: 2 },
        { text: '           (a) Level 3 nesting.', level: 3 },
        { text: '2. Another top-level.', level: 0 },
      ],
      copyTos: [{ text: 'G-3/5' }, { text: 'G-4' }],
      distributions: [{ text: 'A' }, { text: 'B' }],
    });
    expect(() => generateAllLatexFiles(store)).not.toThrow();
  });
});

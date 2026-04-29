/**
 * Tests for `src/services/pii/detector.ts`.
 *
 * The PII detector is the last line of defense against accidentally
 * exporting Marines' SSNs / EDIPIs / DOBs / medical info in a
 * generated document. False NEGATIVES (silent miss of a real SSN) are
 * the worst-case bug; false positives are an annoyance but don't leak
 * data.
 *
 * The exported function `detectPII` takes a documentStore-shaped object,
 * not raw text. We exercise it with hand-built minimal store objects
 * that pin down the detection patterns. Property-based fuzzing then
 * confirms the function never throws on shape-valid inputs.
 *
 * Out of scope: the medical-keyword corpus is a closed list; we hit a
 * representative subset rather than enumerating every keyword.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  detectPII,
  getPIITypeLabel,
  getPIITypeSeverity,
  type PIIType,
} from '@/services/pii/detector';

interface MinimalStore {
  formData: Record<string, unknown>;
  paragraphs: Array<{ text: string }>;
  copyTos: Array<{ text: string }>;
  references: Array<{ title: string; url?: string }>;
}

const emptyStore = (): MinimalStore => ({
  formData: {},
  paragraphs: [],
  copyTos: [],
  references: [],
});

describe('detectPII — pattern detection', () => {
  it('empty store → found: false, no findings', () => {
    const out = detectPII(emptyStore());
    expect(out.found).toBe(false);
    expect(out.findings).toEqual([]);
    expect(out.summary).toEqual({
      ssn: 0,
      edipi: 0,
      dob: 0,
      phone: 0,
      medicalKeywords: 0,
      emailAddresses: 0,
    });
  });

  it('detects an SSN in the dashed format', () => {
    const store = emptyStore();
    store.formData.subject = 'SSN: 123-45-6789';
    const out = detectPII(store);
    expect(out.found).toBe(true);
    expect(out.summary.ssn).toBeGreaterThanOrEqual(1);
  });

  it('detects an EDIPI (10-digit number)', () => {
    const store = emptyStore();
    store.formData.subject = 'EDIPI: 1234567890';
    const out = detectPII(store);
    expect(out.found).toBe(true);
    // 10-digit EDIPI matches both EDIPI and the 9-digit-fallback SSN
    // pattern (since the regex allows any 9-digit run inside a longer
    // number — the SUT documents this as "may have false positives").
    // The important assertion is that EDIPI was caught.
    expect(out.summary.edipi).toBeGreaterThanOrEqual(1);
  });

  it('detects a DOB in MM/DD/YYYY format', () => {
    const store = emptyStore();
    store.formData.subject = 'DOB: 03/15/1985';
    const out = detectPII(store);
    expect(out.found).toBe(true);
    expect(out.summary.dob).toBeGreaterThanOrEqual(1);
  });

  it('detects a phone number in standard formats', () => {
    const store = emptyStore();
    store.formData.subject = 'Call (555) 123-4567';
    const out = detectPII(store);
    expect(out.found).toBe(true);
    expect(out.summary.phone).toBeGreaterThanOrEqual(1);
  });

  it('detects an email address (in pocEmail field or paragraph body)', () => {
    // The detector only scans email patterns in: pocEmail/classifiedPocEmail
    // form fields, paragraph bodies, and copyTo text — NOT in `subject` or
    // similar metadata fields. Catching email in subject would false-
    // positive on legitimate "Re: foo@bar" thread subjects.
    const store = emptyStore();
    store.formData.pocEmail = 'john@example.com';
    const out = detectPII(store);
    expect(out.found).toBe(true);
    expect(out.summary.emailAddresses).toBeGreaterThanOrEqual(1);
  });

  it('detects medical keywords (case-insensitive)', () => {
    const store = emptyStore();
    store.paragraphs = [{ text: 'The Marine has a diagnosis of PTSD.' }];
    const out = detectPII(store);
    expect(out.found).toBe(true);
    expect(out.summary.medicalKeywords).toBeGreaterThanOrEqual(1);
  });

  it('clean text → no PII (the false-positive guard)', () => {
    // A common SECNAV phrase with no PII. This should not trigger.
    const store = emptyStore();
    store.paragraphs = [
      {
        text: 'The Marine demonstrates exceptional leadership and tactical proficiency.',
      },
    ];
    const out = detectPII(store);
    expect(out.found).toBe(false);
  });

  it('never throws on any shape-valid documentStore (property)', () => {
    fc.assert(
      fc.property(
        fc.record({
          formData: fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer())),
          paragraphs: fc.array(fc.record({ text: fc.string() }), { maxLength: 10 }),
          copyTos: fc.array(fc.record({ text: fc.string() }), { maxLength: 5 }),
          references: fc.array(fc.record({ title: fc.string() }), { maxLength: 5 }),
        }),
        (store) => {
          detectPII(store as MinimalStore);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('getPIITypeLabel — exhaustive', () => {
  const types: PIIType[] = ['SSN', 'EDIPI', 'DOB', 'PHONE', 'MEDICAL_KEYWORD', 'EMAIL_ADDRESS'];

  for (const type of types) {
    it(`${type} returns a non-empty human-readable string`, () => {
      const label = getPIITypeLabel(type);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    });
  }
});

describe('getPIITypeSeverity — policy table', () => {
  it('SSN and EDIPI are HIGH severity (regulated identifiers)', () => {
    expect(getPIITypeSeverity('SSN')).toBe('high');
    expect(getPIITypeSeverity('EDIPI')).toBe('high');
  });

  it('DOB and medical keywords are MEDIUM severity', () => {
    expect(getPIITypeSeverity('DOB')).toBe('medium');
    expect(getPIITypeSeverity('MEDICAL_KEYWORD')).toBe('medium');
  });

  it('phone and email are LOW severity (often public)', () => {
    expect(getPIITypeSeverity('PHONE')).toBe('low');
    expect(getPIITypeSeverity('EMAIL_ADDRESS')).toBe('low');
  });
});

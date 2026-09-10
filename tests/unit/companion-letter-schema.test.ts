/**
 * The published request contract.
 *
 * The parity suite proves the two doors agree with each other. This proves what
 * they agree on: that a marking level survives, that every level the generator
 * recognises is offered, and that an unnamed field is refused rather than
 * dropped.
 */
import { describe, it, expect } from 'vitest';
import { letterSchema, acceptedFields } from '../../companion/letterSchema';
import { toStore, templateFor } from '../../companion/letterInput';
import type { LetterInput } from '../../companion/letterInput';

const base = { docType: 'naval_letter', subject: 'S', paragraphs: [{ text: 'body' }] };

describe('the published schema', () => {
  it('requires a docType and nothing else', () => {
    expect(letterSchema.safeParse({ docType: 'naval_letter' }).success).toBe(true);
    expect(letterSchema.safeParse({ subject: 'no doc type' }).success).toBe(false);
  });

  it('refuses a field it does not name, rather than dropping it', () => {
    // Without .strict() this parses fine and the misspelled key is gone.
    const r = letterSchema.safeParse({ ...base, clasification: { level: 'secret' } });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/clasification/);
  });

  it('names the unknown key so a caller can fix it', () => {
    const r = letterSchema.safeParse({ ...base, subjekt: 'typo' });
    expect(JSON.stringify(r.error?.issues)).toMatch(/subjekt/);
  });

  it('accepts the nested fields the generator reads', () => {
    // Each was honoured by toStore while going unpublished.
    const r = letterSchema.safeParse({
      ...base,
      unit: { line1: 'FIRST', letterheadColor: 'black' },
      references: [{ letter: '(a)', title: 'Ref' }],
      signature: { byDirection: true, byDirectionAuthority: 'By direction' },
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('keeps formData open as the escape hatch', () => {
    // Strictness needs this: a generator field the schema has not learned yet
    // still needs a way through.
    expect(letterSchema.safeParse({ ...base, formData: { fontSize: '10pt' } }).success).toBe(true);
  });
});

describe('classification levels', () => {
  // generator.ts refuses a level it does not recognise, rendering no marking at
  // all, so the published enum is what keeps a caller inside the set.
  const RENDERABLE = ['unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'];

  it.each(RENDERABLE)('publishes %s', (level) => {
    expect(letterSchema.safeParse({ ...base, classification: { level } }).success).toBe(true);
  });

  it.each(RENDERABLE)('%s reaches the generator as classLevel', (level) => {
    const store = toStore({ ...base, classification: { level } } as LetterInput, {});
    expect((store.formData as Record<string, unknown>).classLevel).toBe(level);
  });

  it('rejects a level the generator would silently ignore', () => {
    expect(letterSchema.safeParse({ ...base, classification: { level: 'top-secret' } }).success).toBe(false);
    expect(letterSchema.safeParse({ ...base, classification: { level: 'SECRET' } }).success).toBe(false);
  });

  it('defaults to unclassified when no level is given', () => {
    const store = toStore(base as LetterInput, {});
    expect((store.formData as Record<string, unknown>).classLevel).toBe('unclassified');
  });
});

describe('acceptedFields', () => {
  it('derives from the schema rather than restating it', () => {
    const declared = Object.keys(letterSchema.shape);
    expect(acceptedFields().sort()).toEqual(declared.sort());
  });

  it('includes the fields whose absence caused the drift', () => {
    expect(acceptedFields()).toEqual(
      expect.arrayContaining(['classification', 'pocEmail', 'formData', 'format', 'out']),
    );
  });
});

describe('field precedence', () => {
  it('prefers a top-level pocEmail over the nested one', () => {
    const store = toStore(
      { ...base, pocEmail: 'top@example.mil', classification: { level: 'cui', pocEmail: 'nested@example.mil' } } as LetterInput,
      {},
    );
    expect((store.formData as Record<string, unknown>).pocEmail).toBe('top@example.mil');
  });

  it('falls back to the nested pocEmail', () => {
    const store = toStore({ ...base, classification: { level: 'cui', pocEmail: 'nested@example.mil' } } as LetterInput, {});
    expect((store.formData as Record<string, unknown>).pocEmail).toBe('nested@example.mil');
  });

  it('lets formData outrank every named field', () => {
    // toStore documents this as "merged last, deliberately".
    const store = toStore({ ...base, ssic: '5216', formData: { ssic: '1500' } } as LetterInput, {});
    expect((store.formData as Record<string, unknown>).ssic).toBe('1500');
  });

  it('prefers a request unit over the machine default', () => {
    const store = toStore(
      { ...base, unit: { name: 'REQUEST UNIT' } } as LetterInput,
      { unit: { name: 'MACHINE UNIT', line2: 'PARENT' } },
    );
    const fd = store.formData as Record<string, unknown>;
    expect(fd.unitName).toBe('REQUEST UNIT');
    // ...without discarding the parts the request did not override.
    expect(fd.unitLine2).toBe('PARENT');
  });
});

describe('parties', () => {
  const parties = {
    senior: { name: 'SENIOR CMD', from: 'Senior From', code: 'S1', zip: '20380', ssic: '1000', serial: '0001', signature: { name: 'A. Senior', rank: 'General', title: 'Senior Title' } },
    junior: { name: 'JUNIOR CMD', from: 'Junior From', code: 'J1', zip: '20350', ssic: '1000', serial: '0002', date: '15 Jan 26', signature: { name: 'B. Junior', rank: 'Admiral', title: 'Junior Title' } },
    commonLocation: 'Washington, D.C.',
  };
  const fd = (docType: string) => toStore({ ...base, docType, parties } as LetterInput, {}).formData as Record<string, unknown>;

  it('feeds the joint family', () => {
    const f = fd('joint_letter');
    expect(f.jointSeniorName).toBe('SENIOR CMD');
    expect(f.jointSeniorFrom).toBe('Senior From');
    expect(f.jointSeniorSigName).toBe('A. Senior');
    expect(f.jointJuniorDate).toBe('15 Jan 26');
    expect(f.jointCommonLocation).toBe('Washington, D.C.');
  });

  it('feeds the agreement family from the same input', () => {
    const f = fd('moa');
    expect(f.seniorCommandName).toBe('SENIOR CMD');
    expect(f.juniorCommandName).toBe('JUNIOR CMD');
    expect(f.seniorSigRank).toBe('General');
    expect(f.juniorSigTitle).toBe('Junior Title');
    expect(f.juniorDate).toBe('15 Jan 26');
  });

  it('lets the senior block win the plain ssic, serial and date for both families', () => {
    const f = toStore({ ...base, docType: 'joint_letter', ssic: '5216', serial: '9999', date: '1 Jan 26', parties } as LetterInput, {}).formData as Record<string, unknown>;
    // joint types read the plain names for the senior column
    expect([f.ssic, f.serial]).toEqual(['1000', '0001']);
    // agreements read the senior* names; same source
    expect([f.seniorSSIC, f.seniorSerial]).toEqual(['1000', '0001']);
  });

  it('lets a party from line override the plain one', () => {
    const f = toStore({ ...base, docType: 'joint_letter', from: 'Plain From', parties } as LetterInput, {}).formData as Record<string, unknown>;
    expect(f.jointSeniorFrom).toBe('Senior From');
  });

  it('routes the plain fields to every alias when no parties are given', () => {
    const f = toStore({ ...base, docType: 'joint_letter', from: 'F', to: 'T', subject: 'S' } as LetterInput, {}).formData as Record<string, unknown>;
    expect(f.jointSeniorFrom).toBe('F');
    expect(f.jointTo).toBe('T');
    expect(f.jointSubject).toBe('S');
    expect(f.moaSubject).toBe('S');
  });
});

describe('date default by type', () => {
  const d = (docType: string) => (toStore({ ...base, docType } as LetterInput, {}).formData as Record<string, unknown>).date as string;
  it('naval letters get d MMM yy', () => { expect(d('naval_letter')).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{2}$/); });
  it('business letters get MMMM d, yyyy', () => { expect(d('business_letter')).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/); });
  it('executive memoranda get MMMM d, yyyy', () => { expect(d('standard_memorandum')).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/); });
  it('seniorDate follows the document date', () => {
    const f = toStore({ ...base, docType: 'moa', date: '1 Jan 26' } as LetterInput, {}).formData as Record<string, unknown>;
    expect(f.seniorDate).toBe('1 Jan 26');
  });
});

describe('endorsement and furniture', () => {
  it('maps the endorsement object', () => {
    const f = toStore({ ...base, docType: 'same_page_endorsement', endorsement: { ordinal: 'SECOND', basicLetterId: 'ID', includeSubject: true } } as LetterInput, {}).formData as Record<string, unknown>;
    expect(f.endorsementOrdinal).toBe('SECOND');
    expect(f.basicLetterId).toBe('ID');
    expect(f.includeEndorsementSubject).toBe(true);
  });
  it('maps salutation, close, coordination and preparedBy', () => {
    const f = toStore({ ...base, salutation: 'Dear X:', complimentaryClose: 'V/r,', coordination: 'C', preparedBy: 'P' } as LetterInput, {}).formData as Record<string, unknown>;
    expect([f.salutation, f.complimentaryClose, f.coordination, f.preparedBy]).toEqual(['Dear X:', 'V/r,', 'C', 'P']);
  });
  it('feeds the classification POC from the top-level pocEmail too', () => {
    const f = toStore({ ...base, pocEmail: 'top@example.mil', classification: { level: 'secret' } } as LetterInput, {}).formData as Record<string, unknown>;
    expect(f.classifiedPocEmail).toBe('top@example.mil');
  });

  it('maps the classification detail block', () => {
    const f = toStore({ ...base, classification: { level: 'secret', classifiedBy: 'CB', derivedFrom: 'DF', declassifyOn: 'DO', reason: '1.4(a)', cui: { category: 'PRVCY' } } } as LetterInput, {}).formData as Record<string, unknown>;
    expect([f.classifiedBy, f.derivedFrom, f.declassifyOn, f.classReason, f.cuiCategory]).toEqual(['CB', 'DF', 'DO', '1.4(a)', 'PRVCY']);
  });
});

describe('templateFor', () => {
  it('translates memorandum to the template that exists', () => {
    expect(templateFor('memorandum')).toBe('standard_memorandum');
  });

  it('passes through a docType that needs no translation', () => {
    expect(templateFor('naval_letter')).toBe('naval_letter');
    expect(templateFor('standard_letter')).toBe('standard_letter');
  });

  it('carries the translation into the store, not just the lookup', () => {
    // Both the top-level docType and the one inside formData feed the generator;
    // translating only one of them renders the wrong template.
    const store = toStore({ ...base, docType: 'memorandum' } as LetterInput, {});
    expect(store.docType).toBe('standard_memorandum');
    expect((store.formData as Record<string, unknown>).docType).toBe('standard_memorandum');
  });

  it('routes the addressee to the field executive memoranda read', () => {
    const store = toStore({ ...base, docType: 'memorandum', to: 'Commanding General' } as LetterInput, {});
    expect((store.formData as Record<string, unknown>).memorandumFor).toBe('Commanding General');
  });
});

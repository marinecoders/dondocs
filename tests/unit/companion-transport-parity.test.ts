/**
 * The two front doors accept the same request.
 *
 * The same JSON goes through both intake paths and the resulting stores are
 * compared. `toStore` is the last point they can differ; everything past it is
 * shared. Whole stores rather than chosen fields, because the next drift will be
 * in a field nobody thought to assert.
 *
 * No render: a parity break is an intake bug, and this should stay cheap enough
 * to run on every push.
 */
import { describe, it, expect } from 'vitest';
import { letterSchema } from '../../companion/letterSchema';
import { toStore, type CompanionDefaults, type LetterInput } from '../../companion/letterInput';
import { validate } from '../../companion/handler';

const defaults: CompanionDefaults = {
  unit: { name: 'TEST UNIT', line2: 'PARENT COMMAND', address: 'PSC BOX 1, QUANTICO VA 22134' },
  signature: { first: 'A', middle: 'B', last: 'SMITH', rank: 'Major', title: 'Officer in Charge' },
  ssic: '5216',
};

/** What the HTTP door does with a body before rendering it. */
function throughHttp(body: Record<string, unknown>) {
  const problems = validate(body as LetterInput);
  return { problems, store: problems.length ? null : toStore(body as LetterInput, defaults) };
}

/** What the tool transport does: parse against the published schema, then the
 *  same shared content rules the HTTP door applies. */
function throughSchema(body: Record<string, unknown>) {
  const parsed = letterSchema.safeParse(body);
  if (!parsed.success) {
    return { problems: parsed.error.issues.map((i) => i.message), store: null };
  }
  const input = parsed.data as unknown as LetterInput;
  const problems = validate(input);
  return { problems, store: problems.length ? null : toStore(input, defaults) };
}

const CASES: Array<[string, Record<string, unknown>]> = [
  ['a minimal letter', {
    docType: 'naval_letter', subject: 'MINIMAL', paragraphs: [{ text: 'Body.' }],
  }],
  ['a classified letter — the field that drifted', {
    docType: 'naval_letter', subject: 'MARKED', paragraphs: [{ text: 'Body.' }],
    classification: { level: 'secret' },
  }],
  ['a CUI letter with a point of contact', {
    docType: 'naval_letter', subject: 'CUI', paragraphs: [{ text: 'Body.' }],
    classification: { level: 'cui' }, pocEmail: 'someone@example.mil',
  }],
  ['every top-level field at once', {
    docType: 'standard_letter', format: 'pdf', out: 'everything.pdf',
    subject: 'EVERYTHING', from: 'Commanding Officer', to: 'Commanding General',
    via: ['First Via', 'Second Via'],
    ssic: '1500', serial: '001', date: '8 Aug 26', originatorCode: 'S-6',
    paragraphs: [{ text: 'One.', level: 0, header: 'Background' }, { text: 'Two.', level: 1 }],
    references: [{ letter: 'a', title: 'Ref one' }, { title: 'Ref two' }],
    enclosures: [{ title: 'Encl one' }],
    copyTo: ['Copy A'], distribution: ['Dist A'],
    unit: {
      name: 'OVERRIDE UNIT', line1: 'FIRST LINE', line2: 'SECOND LINE',
      address: 'PSC BOX 2, CAMP LEJEUNE NC 28542', department: 'navy',
      seal: 'dod', letterheadColor: 'black',
    },
    signature: {
      first: 'C', middle: 'D', last: 'JONES', rank: 'Colonel',
      title: 'Commanding Officer', byDirection: true, byDirectionAuthority: 'By direction',
    },
    classification: { level: 'confidential', pocEmail: 'poc@example.mil' },
    pocEmail: 'top@example.mil',
  }],
  ['a memorandum', {
    docType: 'memorandum', subject: 'MEMO', to: 'Commanding General',
    paragraphs: [{ text: 'Body.' }],
  }],
  ['an endorsement', {
    docType: 'same_page_endorsement', subject: 'FIRST ENDORSEMENT on CO ltr 5216 of 8 Sep 26',
    from: 'Sergeant A. B. Marine, USMC', to: 'Commanding Officer',
    paragraphs: [{ text: 'I have read and understand the references listed above.' }],
  }],
  ['an endorsement with the explicit object', {
    docType: 'same_page_endorsement', subject: 'APPOINTMENT', from: 'Sgt A', to: 'CO',
    paragraphs: [{ text: 'x' }], endorsement: { ordinal: 'SECOND', basicLetterId: 'CO ltr 5216', includeSubject: true },
  }],
  ['a joint letter with both parties', {
    docType: 'joint_letter', subject: 'JOINT', to: 'SECNAV', paragraphs: [{ text: 'x' }],
    parties: {
      senior: { name: 'CMC', from: 'Commandant', code: 'PP&O', zip: '20380', ssic: '1000', serial: '0001', signature: { name: 'D. R. SMITH', title: 'General' } },
      junior: { name: 'CNO', from: 'Chief of Naval Operations', ssic: '1000', serial: '0001', date: '15 Jan 26', signature: { name: 'M. K. JONES', title: 'Admiral' } },
      commonLocation: 'Washington, D.C.',
    },
  }],
  ['an MOA with both parties', {
    docType: 'moa', subject: 'AGREEMENT', paragraphs: [{ text: 'x' }],
    parties: {
      senior: { name: 'USMC', ssic: '1000', serial: '0001', signature: { name: 'David R. Smith', rank: 'General', title: 'CMC' } },
      junior: { name: 'USN', ssic: '1000', serial: '0002', date: '15 Jan 26', signature: { name: 'Mary K. Jones', rank: 'Admiral', title: 'CNO' } },
    },
  }],
  ['a business letter with furniture', {
    docType: 'business_letter', subject: 'Thanks', to: 'Mr. Doe', paragraphs: [{ text: 'x' }],
    salutation: 'Dear Mr. Doe:', complimentaryClose: 'Very respectfully,', pageNumbering: 'simple',
  }],
  ['an information memorandum', {
    docType: 'information_memorandum', subject: 'Readiness', from: 'Dir', to: 'CMC', paragraphs: [{ text: 'x' }],
    coordination: 'DC PP&O', preparedBy: 'CAPT Smith', attnLine: 'ATTN', throughLine: 'THRU',
  }],
  ['a classified letter with the detail block', {
    docType: 'naval_letter', subject: 'S', paragraphs: [{ text: 'x' }],
    classification: { level: 'secret', classifiedBy: 'CB', derivedFrom: 'DF', declassifyOn: '20360910', reason: '1.4(a)', cui: { category: 'PRVCY', controlledBy: 'USMC' } },
  }],
];

describe('transport parity', () => {
  it.each(CASES)('%s reaches the generator identically', (_name, body) => {
    const http = throughHttp(body);
    const schema = throughSchema(body);

    expect(schema.problems, `schema rejected what HTTP accepted: ${schema.problems.join('; ')}`)
      .toEqual(http.problems);
    expect(schema.store).toEqual(http.store);
  });

  it('carries the classification through both doors, not just one', () => {
    const body = { docType: 'naval_letter', subject: 'MARKED', paragraphs: [{ text: 'x' }], classification: { level: 'secret' } };
    // The regression itself: classLevel 'unclassified' renders no banner.
    for (const [door, run] of [['http', throughHttp], ['schema', throughSchema]] as const) {
      const { store } = run(body);
      const formData = (store as Record<string, Record<string, unknown>>).formData;
      expect(formData.classLevel, `${door} dropped the classification`).toBe('secret');
    }
  });

  it('publishes nothing the generator ignores', () => {
    // The mirror image: a published field toStore never reads.
    const populated: Record<string, unknown> = {
      docType: 'naval_letter', subject: 'S', from: 'F', to: 'T', via: ['V'],
      ssic: '1500', serial: '001', date: '8 Aug 26', originatorCode: 'OC',
      paragraphs: [{ text: 'P' }], references: [{ title: 'R' }], enclosures: [{ title: 'E' }],
      copyTo: ['C'], distribution: ['D'],
      unit: { name: 'U' }, signature: { last: 'L' },
      classification: { level: 'secret' }, pocEmail: 'p@example.mil',
    };
    const store = toStore(populated as LetterInput, {});
    const seen = JSON.stringify(store);
    for (const marker of ['S', 'F', 'T', 'V', '1500', '001', '8 Aug 26', 'OC', 'P', 'R', 'E', 'C', 'D', 'U', 'L', 'secret', 'p@example.mil']) {
      expect(seen, `no field carried ${JSON.stringify(marker)} into the store`).toContain(marker);
    }
  });
});

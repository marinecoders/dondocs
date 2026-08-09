/**
 * The request → store mapping.
 *
 * Precedence is the part that will break quietly: request beats machine config
 * beats built-in fallback, at every field. A caller overriding its unit for one
 * letter must not be silently ignored, and a configured unit must not be
 * silently discarded.
 */
import { describe, it, expect } from 'vitest';
import { toStore, type CompanionDefaults } from '../../companion/letterInput';

const FORM = (store: ReturnType<typeof toStore>) => store.formData as Record<string, unknown>;

const CONFIG: CompanionDefaults = {
  unit: { name: 'MARINE INNOVATION UNIT', city: 'QUANTICO', state: 'VA', zip: '22134' },
  signature: { first: 'R', last: 'CHIOFALO', rank: 'Major', title: 'Officer in Charge' },
  ssic: '5216',
  originatorCode: 'S-6',
};

describe('precedence', () => {
  it('uses machine config when the request says nothing', () => {
    const f = FORM(toStore({ docType: 'naval_letter' }, CONFIG));
    expect(f.unitName).toBe('MARINE INNOVATION UNIT');
    expect(f.sigLast).toBe('CHIOFALO');
    expect(f.ssic).toBe('5216');
  });

  it('lets the request override config for one letter', () => {
    const f = FORM(toStore({ docType: 'naval_letter', unit: { name: '8TH COMMUNICATION BN' }, ssic: '1500' }, CONFIG));
    expect(f.unitName).toBe('8TH COMMUNICATION BN');
    expect(f.ssic).toBe('1500');
  });

  it('merges unit fields rather than replacing the whole object', () => {
    // Overriding just the name must not wipe the configured address.
    const f = FORM(toStore({ docType: 'naval_letter', unit: { name: '8TH COMM BN' } }, CONFIG));
    expect(f.unitName).toBe('8TH COMM BN');
    expect(f.unitAddress).toBe('QUANTICO VA 22134');
  });

  it('falls back to something renderable with no config at all', () => {
    const f = FORM(toStore({ docType: 'naval_letter' }));
    expect(f.unitName).toBe('UNITED STATES MARINE CORPS');
    expect(f.ssic).toBe('5216');
  });

  it('lets formData outrank every named field', () => {
    const f = FORM(toStore({ docType: 'naval_letter', subject: 'NAMED', formData: { subject: 'ESCAPE HATCH' } }, CONFIG));
    expect(f.subject).toBe('ESCAPE HATCH');
  });
});

describe('collections', () => {
  it('letters references in order when the caller omits them', () => {
    const s = toStore({
      docType: 'naval_letter',
      references: [{ title: 'SECNAV M-5216.5' }, { title: 'MCO 5215.1K' }, { title: 'Third' }],
    });
    expect(s.references).toEqual([
      { letter: 'a', title: 'SECNAV M-5216.5' },
      { letter: 'b', title: 'MCO 5215.1K' },
      { letter: 'c', title: 'Third' },
    ]);
  });

  it('respects an explicit reference letter', () => {
    const s = toStore({ docType: 'naval_letter', references: [{ letter: 'z', title: 'Pinned' }] });
    expect((s.references as Array<{ letter: string }>)[0].letter).toBe('z');
  });

  it('carries a reference url through when given', () => {
    const s = toStore({ docType: 'naval_letter', references: [{ title: 'T', url: 'https://example.mil/x' }] });
    expect((s.references as Array<{ url?: string }>)[0].url).toBe('https://example.mil/x');
  });

  it('rolls past z into aa', () => {
    const s = toStore({
      docType: 'naval_letter',
      references: Array.from({ length: 27 }, (_, i) => ({ title: `ref ${i}` })),
    });
    const letters = (s.references as Array<{ letter: string }>).map((r) => r.letter);
    expect(letters[25]).toBe('z');
    expect(letters[26]).toBe('aa');
  });

  it('maps enclosures, copy-to and distribution to their store shapes', () => {
    const s = toStore({
      docType: 'naval_letter',
      enclosures: [{ title: 'Encl one' }],
      copyTo: ['CO, 1st Bn', 'S-3'],
      distribution: ['All hands'],
    });
    expect(s.enclosures).toEqual([{ title: 'Encl one' }]);
    expect(s.copyTos).toEqual([{ text: 'CO, 1st Bn' }, { text: 'S-3' }]);
    expect(s.distributions).toEqual([{ text: 'All hands' }]);
  });

  it('joins via lines so the generator can format them', () => {
    const f = FORM(toStore({ docType: 'naval_letter', via: ['CO, 8th Comm Bn', 'CG, MCIEAST'] }));
    expect(f.via).toBe('CO, 8th Comm Bn\nCG, MCIEAST');
  });

  it('keeps paragraph levels and run-in headings', () => {
    const s = toStore({
      docType: 'naval_letter',
      paragraphs: [{ text: 'Top' }, { text: 'Nested', level: 2, header: 'Background' }],
    });
    expect(s.paragraphs).toEqual([
      { text: 'Top', level: 0 },
      { text: 'Nested', level: 2, header: 'Background' },
    ]);
  });
});

describe('date', () => {
  it('defaults to a naval-style date rather than an ISO string', () => {
    const f = FORM(toStore({ docType: 'naval_letter' }));
    expect(f.date).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{2}$/);
  });

  it('takes the caller’s date verbatim', () => {
    const f = FORM(toStore({ docType: 'naval_letter', date: '1 Jan 27' }));
    expect(f.date).toBe('1 Jan 27');
  });
});

describe('unit address', () => {
  // The first version invented unitCity/unitState/unitZip. Those fields exist
  // nowhere in the app, so the address silently never reached the letterhead.
  // The generator reads ONE `unitAddress` string and splits it itself.
  it('maps a whole address string to unitAddress', () => {
    const f = FORM(toStore({ docType: 'naval_letter', unit: { address: 'PSC BOX 20004, CAMP LEJEUNE NC 28542' } }));
    expect(f.unitAddress).toBe('PSC BOX 20004, CAMP LEJEUNE NC 28542');
  });

  it('composes city/state/zip into one address line', () => {
    const f = FORM(toStore({ docType: 'naval_letter', unit: { city: 'CAMP LEJEUNE', state: 'NC', zip: '28542' } }));
    expect(f.unitAddress).toBe('CAMP LEJEUNE NC 28542');
  });

  it('prefers an explicit address over the parts', () => {
    const f = FORM(toStore({ docType: 'naval_letter', unit: { address: 'ONE LINE', city: 'IGNORED' } }));
    expect(f.unitAddress).toBe('ONE LINE');
  });

  it('never emits a field the app does not have', () => {
    const f = FORM(toStore({ docType: 'naval_letter', unit: { city: 'X', state: 'Y', zip: 'Z' } }, CONFIG));
    expect(f).not.toHaveProperty('unitCity');
    expect(f).not.toHaveProperty('unitState');
    expect(f).not.toHaveProperty('unitZip');
  });
});

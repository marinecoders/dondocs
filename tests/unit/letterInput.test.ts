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
import { splitAddressForLetterhead } from '../../src/lib/unitAddress';

const FORM = (store: ReturnType<typeof toStore>) => store.formData as Record<string, unknown>;

const CONFIG: CompanionDefaults = {
  unit: { name: 'MARINE INNOVATION UNIT', address: 'QUANTICO, VA 22134' },
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
    expect(f.unitAddress).toBe('QUANTICO, VA 22134');
  });

  it('falls back to something renderable with no config at all', () => {
    const f = FORM(toStore({ docType: 'naval_letter' }));
    // The department heading already says UNITED STATES MARINE CORPS; a
    // second copy under it is not a unit line.
    expect(f.unitLine1).toBe('');
    expect(f.ssic).toBe('5216');
  });

  it('does not print the Marine Corps line under a Navy heading', () => {
    const f = FORM(toStore({ docType: 'naval_letter', unit: { department: 'navy', address: '2000 NAVY PENTAGON, WASHINGTON DC 20350' } }));
    expect(f.department).toBe('navy');
    expect(f.unitLine1).toBe('');
  });

  it('lets a request name beat a configured line1, the same line under another spelling', () => {
    const f = FORM(toStore({ docType: 'naval_letter', unit: { name: 'REQUEST NAME' } }, { unit: { line1: 'CONFIG LINE' } }));
    expect(f.unitLine1).toBe('REQUEST NAME');
  });

  it('has no escape hatch past the named fields', () => {
    // `formData` used to be merged last, which let a caller overwrite any
    // generator field the schema guards with an enum.
    const f = FORM(toStore({ docType: 'naval_letter', subject: 'NAMED', formData: { subject: 'ESCAPE HATCH' } } as never, CONFIG));
    expect(f.subject).toBe('NAMED');
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

  it('does not carry a reference url: nothing the companion runs renders one', () => {
    const s = toStore({ docType: 'naval_letter', references: [{ title: 'T', url: 'https://example.mil/x' } as never] });
    expect(s.references).toEqual([{ letter: 'a', title: 'T' }]);
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
  it.each(['request', 'config'] as const)('splits the Newburgh lookup address into two letterhead lines from %s', (source) => {
    const unit = { address: '10 MCDONALD ST, NEWBURGH NY 12550-5012' };
    const f = FORM(toStore(
      { docType: 'naval_letter', ...(source === 'request' ? { unit } : {}) },
      source === 'config' ? { unit } : {},
    ));
    expect(splitAddressForLetterhead(f.unitAddress as string)).toEqual({
      line1: '10 MCDONALD ST',
      line2: 'NEWBURGH, NY 12550-5012',
    });
  });

  it('preserves military post office formatting', () => {
    const f = FORM(toStore({ docType: 'naval_letter', unit: { address: 'UNIT 35602, FPO AP 96604-5602' } }));
    expect(splitAddressForLetterhead(f.unitAddress as string)).toEqual({
      line1: 'UNIT 35602', line2: 'FPO AP 96604-5602',
    });
  });

  // The first version invented unitCity/unitState/unitZip. Those fields exist
  // nowhere in the app, so the address silently never reached the letterhead.
  // The generator reads ONE `unitAddress` string and splits it itself.
  it('maps a whole address string to unitAddress', () => {
    const f = FORM(toStore({ docType: 'naval_letter', unit: { address: 'PSC BOX 20004, CAMP LEJEUNE NC 28542' } }));
    expect(f.unitAddress).toBe('PSC BOX 20004, CAMP LEJEUNE, NC 28542');
  });

  it('leaves the address empty when none is given: the parts were never published', () => {
    const f = FORM(toStore({ docType: 'naval_letter', unit: { name: 'X' } }));
    expect(f.unitAddress).toBe('');
  });
});

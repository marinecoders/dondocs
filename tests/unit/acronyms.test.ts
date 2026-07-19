import { describe, it, expect } from 'vitest';
import { findUndefinedAcronyms, CORRESPONDENCE_ALLOWLIST } from '@/lib/acronyms';

describe('findUndefinedAcronyms — spell-out-first (SECNAV M-5216.5 ¶17c)', () => {
  it('flags an acronym used without ever being defined', () => {
    const f = findUndefinedAcronyms('The JTFHQ will convene a board next week.');
    expect(f.map((x) => x.acronym)).toEqual(['JTFHQ']);
  });

  it('flags an acronym used before it is defined', () => {
    const text = 'The JTFHQ met. The Joint Task Force Headquarters (JTFHQ) is standing up.';
    expect(findUndefinedAcronyms(text).map((x) => x.acronym)).toEqual(['JTFHQ']);
  });

  it('accepts an acronym defined on first use, then used freely', () => {
    const text = 'The Joint Task Force Headquarters (JTFHQ) met. The JTFHQ will report weekly.';
    expect(findUndefinedAcronyms(text)).toEqual([]);
  });

  it('does not flag allowlisted, universally understood abbreviations', () => {
    expect(findUndefinedAcronyms('The USMC and DoD agreed; POC is the S-1.')).toEqual([]);
  });

  it('reports each undefined acronym once, in first-use order', () => {
    const text = 'The C4ISR suite and the ISR feed; the C4ISR again.';
    expect(findUndefinedAcronyms(text).map((x) => x.acronym)).toEqual(['C4ISR', 'ISR']);
  });

  it('ignores ordinary words and single capitals', () => {
    expect(findUndefinedAcronyms('The Commanding Officer directed a review of the Marine.')).toEqual([]);
  });
});

describe('findUndefinedAcronyms — strict (directives)', () => {
  it('flags even established/allowlisted acronyms when strict', () => {
    const f = findUndefinedAcronyms('The USMC will comply.', { strict: true });
    expect(f.map((x) => x.acronym)).toEqual(['USMC']);
  });

  it('honors a definition even in strict mode', () => {
    const text = 'The United States Marine Corps (USMC) will comply. The USMC leads.';
    expect(findUndefinedAcronyms(text, { strict: true })).toEqual([]);
  });
});

describe('CORRESPONDENCE_ALLOWLIST', () => {
  it('is normalized (uppercase, no periods)', () => {
    expect(CORRESPONDENCE_ALLOWLIST.has('USMC')).toBe(true);
    expect(CORRESPONDENCE_ALLOWLIST.has('US')).toBe(true); // "U.S." normalizes to this
  });
});

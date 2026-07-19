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

describe('findUndefinedAcronyms — not-an-acronym cases (no false positives)', () => {
  it('does not flag plurals of allowlisted or defined acronyms', () => {
    expect(findUndefinedAcronyms('Identify the unit POCs and redact all SSNs.')).toEqual([]);
    expect(
      findUndefinedAcronyms('A Memorandum of Understanding (MOU) governs this. Three MOUs were signed.')
    ).toEqual([]);
  });

  it('does not flag Roman numerals', () => {
    expect(findUndefinedAcronyms('Veterans of World War II attended Phase IV of paragraph VII.')).toEqual([]);
  });

  it('does not flag CamelCase rank abbreviations', () => {
    expect(findUndefinedAcronyms('LCpl Doe and GySgt Roe reported as directed.')).toEqual([]);
  });

  it('does not flag all-caps emphasis words or slashed abbreviations', () => {
    expect(findUndefinedAcronyms('Personnel will NOT enter; mark the field N/A.')).toEqual([]);
  });

  it('does not flag SECNAV / OPNAV / CMC (now allowlisted)', () => {
    expect(findUndefinedAcronyms('Per SECNAV and OPNAV policy, CMC will decide.')).toEqual([]);
  });

  it('matches a definition regardless of period/case variance', () => {
    // "(NATO)" defines a later "N.A.T.O." use.
    expect(findUndefinedAcronyms('The North Atlantic Treaty Organization (NATO) met; N.A.T.O. adjourned.')).toEqual(
      []
    );
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

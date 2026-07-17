/**
 * Sequence continuation for endorsements (SECNAV M-5216.5 Ch 9 ¶3).
 *
 * An endorsement continues the basic letter's reference lettering and enclosure
 * numbering rather than restarting at (a) / (1). The basic letter is a separate
 * document DonDocs can't read, so the start is user-supplied — and it must only
 * ever apply to endorsements, so a stale value can't silently offset a basic
 * letter's sequence.
 */
import { describe, it, expect } from 'vitest';
import {
  isEndorsement,
  referenceStartIndex,
  enclosureStartNumber,
  continuationReferenceLetter,
  continuationEnclosureNumber,
} from '@/lib/endorsement';

describe('isEndorsement', () => {
  it('is true for both endorsement types only', () => {
    expect(isEndorsement('same_page_endorsement')).toBe(true);
    expect(isEndorsement('new_page_endorsement')).toBe(true);
    expect(isEndorsement('naval_letter')).toBe(false);
    expect(isEndorsement('mfr')).toBe(false);
  });
});

describe('referenceStartIndex', () => {
  it('maps a start letter to its zero-based index', () => {
    expect(referenceStartIndex('same_page_endorsement', 'a')).toBe(0);
    expect(referenceStartIndex('same_page_endorsement', 'b')).toBe(1);
    // The reg's own example: basic ran to (f), so this one starts at (g).
    expect(referenceStartIndex('same_page_endorsement', 'g')).toBe(6);
    expect(referenceStartIndex('new_page_endorsement', 'z')).toBe(25);
  });

  it('tolerates case and surrounding whitespace', () => {
    expect(referenceStartIndex('same_page_endorsement', ' G ')).toBe(6);
    expect(referenceStartIndex('same_page_endorsement', 'G')).toBe(6);
  });

  it('never offsets a non-endorsement, even with a value set', () => {
    // The footgun this guards: setting a start, then switching doc type.
    expect(referenceStartIndex('naval_letter', 'g')).toBe(0);
    expect(referenceStartIndex('mfr', 'g')).toBe(0);
  });

  it('falls back to 0 for anything that is not a single a–z letter', () => {
    for (const bad of [undefined, '', '  ', '1', 'aa', '(g)', '?']) {
      expect(referenceStartIndex('same_page_endorsement', bad)).toBe(0);
    }
  });
});

describe('enclosureStartNumber', () => {
  it('returns the start number for endorsements', () => {
    expect(enclosureStartNumber('same_page_endorsement', 2)).toBe(2);
    expect(enclosureStartNumber('new_page_endorsement', 7)).toBe(7);
  });

  it('never offsets a non-endorsement, even with a value set', () => {
    expect(enclosureStartNumber('naval_letter', 5)).toBe(1);
  });

  it('defaults to 1 for absent, sub-1, or non-numeric values', () => {
    expect(enclosureStartNumber('same_page_endorsement', undefined)).toBe(1);
    expect(enclosureStartNumber('same_page_endorsement', 0)).toBe(1);
    expect(enclosureStartNumber('same_page_endorsement', -3)).toBe(1);
    expect(enclosureStartNumber('same_page_endorsement', NaN)).toBe(1);
  });

  it('floors a fractional value rather than emitting "(2.5)"', () => {
    expect(enclosureStartNumber('same_page_endorsement', 2.7)).toBe(2);
  });
});

describe('continuationReferenceLetter', () => {
  it("continues the source's sequence — the reg's own example", () => {
    // Ch 9 ¶3: "identified up to letter 'f', the first reference of your
    // endorsement would be letter 'g'" — six references (a-f) → (g).
    expect(continuationReferenceLetter(6)).toBe('g');
    expect(continuationReferenceLetter(3)).toBe('d');
  });

  it('keeps counting when the source itself continued a sequence', () => {
    // Endorsing an endorsement: the source started at (d) and added (d), (e),
    // so this one starts at (f) — not back at (c).
    expect(continuationReferenceLetter(2, 3)).toBe('f');
  });

  it('returns "" when the source identifies no references', () => {
    expect(continuationReferenceLetter(0)).toBe('');
    expect(continuationReferenceLetter(-1)).toBe('');
    expect(continuationReferenceLetter(1.5)).toBe('');
  });

  it('returns "" past (z) — the field holds a single letter', () => {
    expect(continuationReferenceLetter(25)).toBe('z');
    expect(continuationReferenceLetter(26)).toBe('');
    expect(continuationReferenceLetter(20, 10)).toBe('');
  });
});

describe('continuationEnclosureNumber', () => {
  it("continues the source's sequence — the reg's own example", () => {
    // Ch 9 ¶4: "identified up to number '5', the first enclosure of your
    // endorsement would be number '6'."
    expect(continuationEnclosureNumber(5)).toBe(6);
  });

  it('keeps counting when the source itself continued a sequence', () => {
    expect(continuationEnclosureNumber(2, 6)).toBe(8);
  });

  it('returns undefined when the source adds no enclosures', () => {
    expect(continuationEnclosureNumber(0)).toBeUndefined();
    expect(continuationEnclosureNumber(-2)).toBeUndefined();
    expect(continuationEnclosureNumber(0.5)).toBeUndefined();
  });
});

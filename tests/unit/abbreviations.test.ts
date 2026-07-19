import { describe, it, expect } from 'vitest';
import {
  buildAbbrevIndex,
  scanAbbreviations,
  findApplicableAbbreviations,
  applyAbbreviation,
} from '@/lib/abbreviations';
import type { AbbrevEntry } from '@/data/abbreviations';

const ENTRIES: AbbrevEntry[] = [
  { word: 'commanding officer', abbr: 'CO' },
  { word: 'accomplish', abbr: 'accomp' },
  { word: 'active duty', abbr: 'AD' },
  { word: 'headquarters', abbr: 'hq' },
  { word: 'american', abbr: 'Am', compoundOnly: true },
  { word: 'a/c', abbr: 'a/c' }, // same length — never suggested
];

const index = buildAbbrevIndex(ENTRIES);

describe('buildAbbrevIndex', () => {
  it('drops compound-only entries and tracks the longest phrase', () => {
    expect(index.byWord.has('american')).toBe(false); // compound-only
    expect(index.byWord.has('commanding officer')).toBe(true);
    expect(index.maxWords).toBe(2); // "commanding officer" / "active duty"
  });
});

describe('scanAbbreviations', () => {
  it('prefers the longest phrase and reports offsets', () => {
    const text = 'The commanding officer is on active duty.';
    const matches = scanAbbreviations(text, index);
    expect(matches.map((m) => m.entry.abbr)).toEqual(['CO', 'AD']);
    // Offsets point at the full phrase in the source.
    expect(text.slice(matches[0].start, matches[0].end)).toBe('commanding officer');
  });

  it('is case-insensitive and matches whole words only', () => {
    // "accomplished" must NOT match "accomplish" (letter follows).
    expect(scanAbbreviations('ACCOMPLISH the task', index).map((m) => m.entry.abbr)).toEqual(['accomp']);
    expect(scanAbbreviations('accomplished the task', index)).toEqual([]);
  });

  it('never suggests when the abbreviation is not shorter', () => {
    expect(scanAbbreviations('the a/c value', index)).toEqual([]);
  });
});

describe('findApplicableAbbreviations', () => {
  it('returns unique entries in first-occurrence order', () => {
    const text = 'headquarters told the commanding officer; headquarters again';
    expect(findApplicableAbbreviations(text, index).map((e) => e.abbr)).toEqual(['hq', 'CO']);
  });
});

describe('applyAbbreviation', () => {
  it('replaces every whole-word occurrence with the abbreviation', () => {
    const text = 'Headquarters to headquarters, not headquartersman';
    const out = applyAbbreviation(text, { word: 'headquarters', abbr: 'hq' });
    expect(out).toBe('hq to hq, not headquartersman');
  });

  it('applies a multi-word phrase', () => {
    expect(applyAbbreviation('the commanding officer signed', { word: 'commanding officer', abbr: 'CO' })).toBe(
      'the CO signed'
    );
  });
});

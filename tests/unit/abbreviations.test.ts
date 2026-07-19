import { describe, it, expect } from 'vitest';
import {
  buildAbbrevIndex,
  scanAbbreviations,
  findApplicableAbbreviations,
  applyAbbreviation,
  applyMatches,
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

describe('scanAbbreviations — a non-shortening phrase does not shadow a nested word', () => {
  it('falls through to the one-word entry when the longer phrase does not shorten', () => {
    // "active duty" would match, but its abbr is NOT shorter, so the scan must
    // fall through to "active" -> "act" at the same start (regression for the
    // break-vs-continue fix).
    const idx = buildAbbrevIndex([
      { word: 'active duty', abbr: 'active-duty status' }, // longer than the phrase
      { word: 'active', abbr: 'act' },
    ]);
    expect(scanAbbreviations('active duty roster', idx).map((m) => m.entry.abbr)).toEqual(['act']);
  });
});

describe('applyMatches — composes non-overlapping spans', () => {
  const idx = buildAbbrevIndex([
    { word: 'service', abbr: 'svc' },
    { word: 'service record', abbr: 'SR' },
  ]);

  it('applies a word and an overlapping phrase without one clobbering the other', () => {
    const text = 'his service was noted in the service record';
    const out = applyMatches(text, scanAbbreviations(text, idx));
    // The standalone "service" -> svc; the phrase "service record" -> SR (NOT "svc record").
    expect(out).toBe('his svc was noted in the SR');
  });

  it('applying only one entry leaves the other phrase intact', () => {
    const text = 'the service record shows service';
    const matches = scanAbbreviations(text, idx).filter((m) => m.entry.word === 'service');
    // Only the standalone "service" span is replaced; the phrase is untouched.
    expect(applyMatches(text, matches)).toBe('the service record shows svc');
  });
});

import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from '@/lib/fuzzyMatch';

describe('fuzzyMatch — subsequence matching', () => {
  it('matches an acronym-style subsequence that substring search misses', () => {
    const m = fuzzyMatch('New Naval Letter', 'nnl');
    expect(m).not.toBeNull();
    // Greedy earliest match: N(0), N(4), then the first l — the "l" in "Naval" (8).
    expect(m!.indices).toEqual([0, 4, 8]);
  });

  it('matches a plain substring', () => {
    const m = fuzzyMatch('Save draft', 'draf');
    expect(m).not.toBeNull();
    expect(m!.indices).toEqual([5, 6, 7, 8]);
  });

  it('returns null when the characters are out of order', () => {
    expect(fuzzyMatch('Save draft', 'tfard')).toBeNull();
  });

  it('returns null when a character is absent', () => {
    expect(fuzzyMatch('Save draft', 'savez')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('Export DOCX', 'docx')).not.toBeNull();
    expect(fuzzyMatch('Export DOCX', 'DOCX')).not.toBeNull();
  });

  it('treats an empty query as a neutral match with no highlight', () => {
    expect(fuzzyMatch('anything', '')).toEqual({ score: 0, indices: [] });
  });
});

describe('fuzzyMatch — scoring quality', () => {
  it('ranks a start-of-string prefix above a mid-word hit', () => {
    const prefix = fuzzyMatch('Save draft', 'sa')!;
    const midword = fuzzyMatch('Undo save', 'sa')!;
    expect(prefix.score).toBeGreaterThan(midword.score);
  });

  it('ranks a contiguous run above a scattered subsequence', () => {
    const contiguous = fuzzyMatch('letter', 'let')!;
    const scattered = fuzzyMatch('leaflet stack', 'let')!;
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });

  it('rewards word-boundary starts (acronym scores well)', () => {
    const acronym = fuzzyMatch('New Naval Letter', 'nnl')!;
    // Three word-initial hits should out-score the same letters mid-word.
    const midword = fuzzyMatch('annulling', 'nnl')!;
    expect(acronym.score).toBeGreaterThan(midword.score);
  });
});

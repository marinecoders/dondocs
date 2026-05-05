/**
 * Property + canonical tests for `src/lib/paragraphUtils.ts`.
 *
 * This is the SECNAV labeling engine: every paragraph in a correspondence
 * body, every NAVMC sub-entry, every level/level transition flows through
 * `calculateLabels` and `getParagraphLabel`. A bug here renumbers the
 * entire document.
 *
 * Properties enforced:
 *   - Label patterns cycle correctly (Arabic → letter → Arabic-paren → letter-paren).
 *   - Counter resets correctly when paragraphs return to a shallower level.
 *   - Word counts ignore LaTeX formatting and whitespace runs.
 *   - Level validation is a pure threshold check.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  getParagraphLabel,
  calculateLabels,
  countWords,
  countTotalWords,
  getIndentString,
  formatParagraphAsText,
  paragraphsToPlainText,
  getMaxDepth,
  isValidLevel,
  clampLevel,
  canIndent,
  canOutdent,
  type ParagraphLike,
} from '@/lib/paragraphUtils';

const MAX_DEPTH = 7; // mirrors PARAGRAPH.MAX_DEPTH in src/lib/constants.ts

describe('getParagraphLabel — pattern cycling', () => {
  it('level 0 produces Arabic-with-period (1., 2., …)', () => {
    expect(getParagraphLabel(0, 1)).toBe('1.');
    expect(getParagraphLabel(0, 23)).toBe('23.');
  });

  it('level 1 produces lowercase-letter-with-period (a., b., …)', () => {
    expect(getParagraphLabel(1, 1)).toBe('a.');
    expect(getParagraphLabel(1, 26)).toBe('z.');
  });

  it('level 2 produces parenthesized-Arabic ((1), (2), …)', () => {
    expect(getParagraphLabel(2, 1)).toBe('(1)');
    expect(getParagraphLabel(2, 23)).toBe('(23)');
  });

  it('level 3 produces parenthesized-lowercase ((a), (b), …)', () => {
    expect(getParagraphLabel(3, 1)).toBe('(a)');
    expect(getParagraphLabel(3, 26)).toBe('(z)');
  });

  it('cycles back to Arabic at level 4 (deep nesting)', () => {
    // The implementation uses level % 4, so level 4 should produce the
    // same shape as level 0. SECNAV in practice doesn't go that deep, but
    // the cycling ensures graceful degradation rather than crashing.
    expect(getParagraphLabel(4, 1)).toBe('1.');
    expect(getParagraphLabel(7, 1)).toBe('(a)'); // 7 % 4 = 3 → letter-paren
  });

  it('never throws on any non-negative level / count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 26 }),
        (level, count) => {
          getParagraphLabel(level, count);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('calculateLabels — counter reset behavior', () => {
  it('flat list at level 0 → 1., 2., 3.', () => {
    const paras: ParagraphLike[] = [
      { level: 0, text: 'a' },
      { level: 0, text: 'b' },
      { level: 0, text: 'c' },
    ];
    expect(calculateLabels(paras)).toEqual(['1.', '2.', '3.']);
  });

  it('nested 0/1/0/1 → 1., a., 2., a. (sub-counter resets)', () => {
    const paras: ParagraphLike[] = [
      { level: 0 },
      { level: 1 },
      { level: 0 },
      { level: 1 },
    ];
    expect(calculateLabels(paras)).toEqual(['1.', 'a.', '2.', 'a.']);
  });

  it('canonical SECNAV nesting "1, a, b, 2" → 1., a., b., 2.', () => {
    const paras: ParagraphLike[] = [
      { level: 0 }, // 1.
      { level: 1 }, // a.
      { level: 1 }, // b.
      { level: 0 }, // 2.
    ];
    expect(calculateLabels(paras)).toEqual(['1.', 'a.', 'b.', '2.']);
  });

  it('three-deep nesting "1, a, (1), (2), b, 2" → labels reset correctly', () => {
    const paras: ParagraphLike[] = [
      { level: 0 }, // 1.
      { level: 1 }, // a.
      { level: 2 }, // (1)
      { level: 2 }, // (2)
      { level: 1 }, // b.
      { level: 0 }, // 2.
    ];
    expect(calculateLabels(paras)).toEqual(['1.', 'a.', '(1)', '(2)', 'b.', '2.']);
  });

  it('label count always equals paragraph count (property)', () => {
    const paragraphArb = fc.array(
      fc.record({
        level: fc.integer({ min: 0, max: MAX_DEPTH }),
        text: fc.string(),
      }),
      { minLength: 0, maxLength: 30 }
    );
    fc.assert(
      fc.property(paragraphArb, (paras) => {
        const labels = calculateLabels(paras);
        expect(labels.length).toBe(paras.length);
      }),
      { numRuns: 200 }
    );
  });

  it('a single-paragraph at level L always gets the count-1 label for that level', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_DEPTH }), (level) => {
        const labels = calculateLabels([{ level }]);
        expect(labels[0]).toBe(getParagraphLabel(level, 1));
      }),
      { numRuns: 100 }
    );
  });
});

describe('countWords / countTotalWords', () => {
  it('countWords("") === 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });

  it('countWords("hello world") === 2', () => {
    expect(countWords('hello world')).toBe(2);
  });

  it('countWords("hello   world") === 2 (multiple spaces collapse)', () => {
    expect(countWords('hello   world')).toBe(2);
    expect(countWords('  hello   world  ')).toBe(2);
  });

  it('countWords never throws on any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        countWords(s);
      }),
      { numRuns: 300 }
    );
  });

  it('countTotalWords sums across paragraphs', () => {
    expect(
      countTotalWords([
        { level: 0, text: 'one two' },
        { level: 0, text: 'three' },
        { level: 0, text: '' },
      ])
    ).toBe(3);
  });

  it('countTotalWords([]) === 0', () => {
    expect(countTotalWords([])).toBe(0);
  });
});

describe('getIndentString', () => {
  it('default 4-space indent matches SECNAV 0.25" convention', () => {
    expect(getIndentString(0)).toBe('');
    expect(getIndentString(1)).toBe('    ');
    expect(getIndentString(2)).toBe('        ');
    expect(getIndentString(3)).toBe('            ');
  });

  it('custom width', () => {
    expect(getIndentString(2, 2)).toBe('    ');
    expect(getIndentString(3, 1)).toBe('   ');
  });

  it('width is exactly level * spacesPerLevel (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 8 }),
        (level, spaces) => {
          const out = getIndentString(level, spaces);
          expect(out.length).toBe(level * spaces);
          expect(out).toBe(' '.repeat(level * spaces));
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('formatParagraphAsText / paragraphsToPlainText', () => {
  it('formatParagraphAsText composes "indent + label + 2 spaces + text"', () => {
    expect(formatParagraphAsText('hello', 0, '1.')).toBe('1.  hello');
    expect(formatParagraphAsText('hello', 1, 'a.')).toBe('    a.  hello');
    expect(formatParagraphAsText('hello', 2, '(1)')).toBe('        (1)  hello');
  });

  it('paragraphsToPlainText: each paragraph is on its own (double-newlined) block, labels come from calculateLabels', () => {
    const paras: ParagraphLike[] = [
      { level: 0, text: 'top' },
      { level: 1, text: 'sub' },
    ];
    expect(paragraphsToPlainText(paras)).toBe('1.  top\n\n    a.  sub');
  });

  it('output text contains every input paragraph text (property)', () => {
    const paragraphArb = fc
      .array(
        fc.record({
          level: fc.integer({ min: 0, max: MAX_DEPTH }),
          text: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        }),
        { minLength: 1, maxLength: 10 }
      );
    fc.assert(
      fc.property(paragraphArb, (paras) => {
        const out = paragraphsToPlainText(paras);
        for (const p of paras) {
          expect(out).toContain(p.text);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('getMaxDepth', () => {
  it('empty array → 0', () => {
    expect(getMaxDepth([])).toBe(0);
  });

  it('returns the largest level present', () => {
    expect(
      getMaxDepth([{ level: 0 }, { level: 3 }, { level: 1 }, { level: 2 }])
    ).toBe(3);
  });

  it('always returns a level that exists in the input (property)', () => {
    const paragraphArb = fc.array(
      fc.record({ level: fc.integer({ min: 0, max: MAX_DEPTH }) }),
      { minLength: 1, maxLength: 20 }
    );
    fc.assert(
      fc.property(paragraphArb, (paras) => {
        const maxDepth = getMaxDepth(paras);
        expect(paras.some((p) => p.level === maxDepth)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe('isValidLevel / clampLevel / canIndent / canOutdent', () => {
  it('isValidLevel: 0..MAX_DEPTH inclusive', () => {
    expect(isValidLevel(0)).toBe(true);
    expect(isValidLevel(MAX_DEPTH)).toBe(true);
    expect(isValidLevel(-1)).toBe(false);
    expect(isValidLevel(MAX_DEPTH + 1)).toBe(false);
  });

  it('clampLevel always returns a valid level (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), (level) => {
        const clamped = clampLevel(level);
        expect(isValidLevel(clamped)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('canIndent / canOutdent are inverse at the boundaries', () => {
    expect(canIndent(0)).toBe(true);
    expect(canOutdent(0)).toBe(false);
    expect(canIndent(MAX_DEPTH)).toBe(false);
    expect(canOutdent(MAX_DEPTH)).toBe(true);
  });
});

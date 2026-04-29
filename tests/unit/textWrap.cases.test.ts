/**
 * Canonical input/output table for `wrapTextForForm`.
 *
 * These are the SECNAV-formatting examples that the helper is contractually
 * obligated to handle. Each case is a small, hand-authored fixture: input
 * text + maxWidth → expected wrapped lines, against a 1-char-per-unit
 * monospace font (see tests/_helpers/monoFont.ts). When a future change to
 * the algorithm breaks any of these, the diff is human-readable.
 *
 * Migrated from `/tmp/wrap-test.ts` (the throwaway probe used during the
 * #24 / #65 fix work) so the same coverage now lives in CI.
 */
import { describe, it, expect } from 'vitest';
import { wrapTextForForm } from '@/services/pdf/textWrap';
import { monoFont } from '../_helpers/monoFont';

interface Case {
  name: string;
  input: string;
  maxWidth: number;
  expected: string[];
}

const cases: Case[] = [
  {
    name: 'no label, no leading WS, simple wrap',
    input: 'Just regular text that wraps once',
    maxWidth: 18,
    expected: ['Just regular text', 'that wraps once'],
  },
  {
    name: 'leading whitespace preserved on continuation',
    input: '  Plain paragraph long enough to wrap',
    maxWidth: 22,
    expected: ['  Plain paragraph long', '  enough to wrap'],
  },
  {
    name: 'level-1 label "1." → continuation hangs at text start',
    input: '1. This is the first level paragraph that should wrap',
    maxWidth: 22,
    expected: [
      '1. This is the first',
      '   level paragraph',
      '   that should wrap',
    ],
  },
  {
    name: 'level-2 label "  a." → continuation hangs after label',
    input: '  a. Second level long enough to wrap to a third line',
    maxWidth: 22,
    expected: [
      '  a. Second level long',
      '     enough to wrap to',
      '     a third line',
    ],
  },
  {
    name: 'level-3 label "    (1)" → continuation hangs after parens',
    input: '    (1) Third level paragraph wraps here',
    maxWidth: 22,
    expected: [
      '    (1) Third level',
      '        paragraph',
      '        wraps here',
    ],
  },
  {
    name: 'empty paragraph survives as a blank line',
    input: 'first\n\nsecond',
    maxWidth: 50,
    expected: ['first', '', 'second'],
  },
  {
    name: 'multiple paragraphs each carry their own indent',
    input: '1. Top.\n  a. Sub-paragraph long enough to wrap.',
    maxWidth: 18,
    expected: [
      '1. Top.',
      '  a. Sub-paragraph',
      '     long enough',
      '     to wrap.',
    ],
  },
  {
    name: 'leading tab → 4 spaces, label still detected',
    input: '\ta. Foo bar baz qux quux',
    maxWidth: 18,
    expected: ['    a. Foo bar baz', '       qux quux'],
  },
  {
    name: 'mid-line tab collapses to whitespace separator',
    input: 'foo\tbar\tbaz',
    maxWidth: 50,
    expected: ['foo bar baz'],
  },
  {
    name: 'two leading tabs = 8 spaces',
    input: '\t\t(1) Deep nested item',
    maxWidth: 50,
    expected: ['        (1) Deep nested item'],
  },
  {
    name: 'label-only paragraph "1. " preserves the prefix as a standalone line',
    input: '1. ',
    maxWidth: 50,
    expected: ['1. '],
  },
  {
    name: 'sub-label-only "   a. " preserves leading WS + label',
    input: '   a. ',
    maxWidth: 50,
    expected: ['   a. '],
  },
  {
    name: 'empty label between real paragraphs survives',
    input: '1. \n2. Real content',
    maxWidth: 50,
    expected: ['1. ', '2. Real content'],
  },
];

describe('wrapTextForForm — canonical SECNAV cases', () => {
  for (const c of cases) {
    it(c.name, () => {
      const got = wrapTextForForm(c.input, c.maxWidth, monoFont, 1);
      expect(got).toEqual(c.expected);
    });
  }
});

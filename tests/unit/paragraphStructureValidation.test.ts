/**
 * SECNAV M-5216.5 Ch 7 ¶13 (a subparagraph needs a sibling) and ¶13d (headings
 * consistent across siblings).
 *
 * The negatives matter as much as the positives here: a check that fires on a
 * clean letter is worse than no check, so the "must stay silent" cases are
 * asserted explicitly rather than left implied.
 */
import { describe, it, expect } from 'vitest';
import type { Paragraph } from '@/types/document';
import { validateParagraphStructure } from '@/lib/paragraphStructureValidation';
import { outlineParagraphs } from '@/services/latex/paragraphLabel';
import { EXAMPLE_DOCUMENTS } from '@/data/exampleDocuments';
import { LETTER_TEMPLATES } from '@/data/templates';

const p = (level: number, text = 'Body text.', header?: string): Paragraph =>
  header === undefined ? { level, text } : { level, text, header };

const messages = (paragraphs: Paragraph[]) =>
  validateParagraphStructure(paragraphs).map((f) => f.message);

describe('outlineParagraphs', () => {
  it('cites in the ¶13c form — no periods, parentheses kept', () => {
    const out = outlineParagraphs([0, 1, 2, 3]);
    expect(out.map((e) => e.citation)).toEqual(['1', '1a', '1a(1)', '1a(1)(a)']);
  });

  it('restarts each level under its own parent', () => {
    // 1, 1a, 1b, 2, 2a  —  "a" restarts under paragraph 2.
    const out = outlineParagraphs([0, 1, 1, 0, 1]);
    expect(out.map((e) => e.citation)).toEqual(['1', '1a', '1b', '2', '2a']);
  });

  it('records the parent each paragraph subdivides', () => {
    const out = outlineParagraphs([0, 1, 1, 0]);
    expect(out.map((e) => e.parentIndex)).toEqual([null, 0, 0, null]);
  });

  it('attaches a skipped level to the nearest shallower paragraph', () => {
    // Level 0 straight to level 2, with no level 1 between them.
    const out = outlineParagraphs([0, 2]);
    expect(out[1].parentIndex).toBe(0);
    expect(out[1].citation).toBe('1(1)');
  });

  it('handles an empty document', () => {
    expect(outlineParagraphs([])).toEqual([]);
  });
});

describe('¶13 — a subparagraph needs a sibling', () => {
  it('flags a lone 1a', () => {
    expect(messages([p(0), p(1)])).toEqual([
      expect.stringContaining('Paragraph 1a is the only subparagraph of 1'),
    ]);
  });

  it('accepts 1a with 1b', () => {
    expect(messages([p(0), p(1), p(1)])).toEqual([]);
  });

  it('flags a lone subparagraph at depth', () => {
    // 1, 1a, 1b, then a single level-2 under 1b — the deepest level is the
    // subdivision of one, and 1a/1b above it are a proper pair.
    const out = messages([p(0), p(1), p(1), p(2)]);
    expect(out).toEqual([expect.stringContaining('Paragraph 1b(1) is the only subparagraph of 1b')]);
  });

  it('does not flag a single top-level paragraph', () => {
    expect(messages([p(0)])).toEqual([]);
  });

  it('does not flag a body of top-level paragraphs only', () => {
    expect(messages([p(0), p(0), p(0)])).toEqual([]);
  });

  it('counts a blank row as the sibling it is', () => {
    // The drafter has made room for 1b but not typed into it yet. Warning here
    // would fire on every keystroke of a document being written normally.
    expect(messages([p(0), p(1), { level: 1, text: '' }])).toEqual([]);
  });

  it('flags each lone subparagraph separately', () => {
    // 1, 1a, 2, 2a — both subdivisions are of one.
    expect(messages([p(0), p(1), p(0), p(1)])).toHaveLength(2);
  });
});

describe('¶13d — headings consistent across siblings', () => {
  it('flags paragraph 1 headed and paragraph 2 bare', () => {
    expect(messages([p(0, 'a.', 'Background'), p(0)])).toEqual([
      expect.stringContaining('Paragraph 1 has a heading but paragraph 2 does not'),
    ]);
  });

  it('accepts both headed', () => {
    expect(messages([p(0, 'a.', 'Background'), p(0, 'b.', 'Action')])).toEqual([]);
  });

  it('accepts neither headed', () => {
    expect(messages([p(0), p(0)])).toEqual([]);
  });

  it('flags 1a headed and 1b bare', () => {
    const out = messages([p(0), p(1, 'x.', 'Scope'), p(1)]);
    expect(out).toEqual([expect.stringContaining('Paragraph 1a has a heading but paragraph 1b does not')]);
  });

  it('compares only true siblings, not every paragraph at the same level', () => {
    // 1 headed, 1a headed, 1b headed, 2 headed — consistent within each group.
    expect(
      messages([
        p(0, 'a.', 'One'),
        p(1, 'b.', 'Scope'),
        p(1, 'c.', 'Limits'),
        p(0, 'd.', 'Two'),
      ])
    ).toEqual([]);
  });

  it('names every bare sibling', () => {
    const [msg] = messages([p(0, 'a.', 'One'), p(0), p(0)]);
    expect(msg).toContain('paragraphs 2 and 3');
    expect(msg).toContain('do not');
  });

  it('ignores blank rows when comparing headings', () => {
    // A trailing empty row is not a paragraph that "needs a heading" yet.
    expect(messages([p(0, 'a.', 'One'), p(0, 'b.', 'Two'), { level: 0, text: '' }])).toEqual([]);
  });

  it('treats a heading with only whitespace as no heading', () => {
    expect(messages([p(0, 'a.', 'One'), p(0, 'b.', '   ')])).toEqual([
      expect.stringContaining('paragraph 2 does not'),
    ]);
  });
});

describe('shipped content stays silent', () => {
  // A check that fires on the app's own starter content would train drafters to
  // ignore it. These two assertions are the guard on that, and on any template
  // added later.
  it('every built-in example passes', () => {
    for (const example of EXAMPLE_DOCUMENTS) {
      expect(
        validateParagraphStructure(example.paragraphs).map((f) => f.message),
        `example "${example.name}"`
      ).toEqual([]);
    }
  });

  it('every letter template passes', () => {
    for (const template of LETTER_TEMPLATES) {
      expect(
        validateParagraphStructure(template.paragraphs).map((f) => f.message),
        `template "${template.name}"`
      ).toEqual([]);
    }
  });
});

describe('clean documents stay silent', () => {
  it('an empty body produces nothing', () => {
    expect(messages([])).toEqual([]);
  });

  it('a fully-formed letter produces nothing', () => {
    expect(
      messages([
        p(0, 'The command completed the evaluation.'),
        p(1, 'First finding.'),
        p(1, 'Second finding.'),
        p(0, 'Point of contact is the undersigned.'),
      ])
    ).toEqual([]);
  });
});

/**
 * Regression for the label-only-paragraph bug surfaced during PR #65's
 * final flaw-hunt.
 *
 * Fix: PR #65 commit 67e343f — when `body.split(/\s+/).filter(...)`
 * returns an empty array (i.e. the paragraph is just a label like
 * "1. " with no body words yet), push the leading prefix as a
 * standalone line instead of falling through to a no-op.
 *
 * Pre-fix trace for input "1. ":
 *   - leadingPrefix = "1. " (regex match)
 *   - body = "" (everything after the prefix is empty)
 *   - words = [].filter(...) → []
 *   - main loop body never runs
 *   - currentText stays "" → final `if (currentText)` push is skipped
 *   - return → the line is dropped from output entirely
 *
 * Real-world impact: a user mid-typing "1." then space (before they've
 * typed the body), or an intentional empty list item between content
 * paragraphs, would silently vanish from the rendered PDF. The
 * original inline `wrapText` preserved this case because it used
 * `' '.split(' ')` which produces a non-empty array even for trailing
 * spaces — when refactoring to the shared helper we tightened to
 * `\s+` + filter, accidentally removing the safety net.
 */
import { describe, it, expect } from 'vitest';
import { wrapTextForForm } from '@/services/pdf/textWrap';
import { monoFont } from '../_helpers/monoFont';

describe('regression #65 — label-only paragraph survives as a standalone line', () => {
  it('"1. " (level-1 label, no body) preserves the prefix', () => {
    expect(wrapTextForForm('1. ', 50, monoFont, 1)).toEqual(['1. ']);
  });

  it('"   a. " (level-2 label with leading WS, no body) preserves leading WS + label', () => {
    expect(wrapTextForForm('   a. ', 50, monoFont, 1)).toEqual(['   a. ']);
  });

  it('empty label between real content paragraphs survives', () => {
    // The bug's most user-visible form: a user mid-edits a paragraph
    // list, leaves an empty "1. " between two real content paragraphs,
    // and on save the empty entry vanishes — leaving "2. Real content"
    // visually re-numbered relative to what they typed.
    expect(wrapTextForForm('1. \n2. Real content', 50, monoFont, 1)).toEqual([
      '1. ',
      '2. Real content',
    ]);
  });
});

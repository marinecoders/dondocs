/**
 * Paragraph label construction, shared by the PDF and DOCX generators.
 *
 * Shared because the two must agree character for character, and they did not:
 * the PDF never underlined a label while the DOCX underlined the whole thing,
 * punctuation included. Both were wrong, so the rule lives in one place.
 *
 * SECNAV M-5216.5 Figure 7-8 (p. 7-23) shows eight levels — the four-mark cycle
 * run twice, the second time with the counter underlined:
 *
 *     1.  a.  (1)  (a)   <-  levels 0-3, plain
 *     1.  a.  (1)  (a)   <-  levels 4-7, counter underlined
 *
 * The underline covers the numeral or letter ONLY. The period and the
 * parentheses stay plain — visible in the figure, and the reason the delimiter
 * is applied outside the underline here rather than around the finished label.
 *
 * The figure marks its last level "Never subparagraph beyond this level", so
 * level 7 is the deepest the manual sanctions. Anything deeper keeps cycling
 * the marks and stays underlined, which at least reads as "still very deep"
 * rather than silently looking like a top-level paragraph again.
 */

/** Levels 1 and 3 of each cycle count in letters; 0 and 2 count in numerals. */
function isAlphabetic(level: number): boolean {
  return level % 2 === 1;
}

/**
 * The 1-based nth letter: a, b, ... z, aa, ab, ...
 *
 * The continuation past z is ours — Fig 7-8 never contemplates a 27th sibling,
 * and the manual's answer to a list that long is to re-paragraph rather than
 * keep subdividing. It still has to be *something*: the previous
 * `String.fromCharCode(96 + count)` walked straight out of the alphabet, so the
 * 27th subparagraph was labelled "{" and the 52nd got an unprintable character,
 * losing its label with nothing to show anything had gone wrong.
 */
function nthLetter(count: number): string {
  let remaining = count;
  let letters = '';
  while (remaining > 0) {
    letters = String.fromCharCode(97 + ((remaining - 1) % 26)) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/**
 * The bare counter for a level: "1", "a", "2", "b" — no punctuation.
 * `count` is 1-based, as `calculateLabels` produces it.
 */
export function paragraphMark(level: number, count: number): string {
  return isAlphabetic(level) ? nthLetter(count) : String(count);
}

/** Wrap a mark in its level's punctuation: "1." or "(1)". */
export function delimitParagraphMark(level: number, mark: string): string {
  return level % 4 >= 2 ? `(${mark})` : `${mark}.`;
}

/** Whether this level's counter is underlined — the second cycle of Fig 7-8. */
export function isUnderlinedLevel(level: number): boolean {
  return level >= 4;
}

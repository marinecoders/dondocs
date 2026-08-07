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

export interface ParagraphOutlineEntry {
  /**
   * How ¶13c says to cite this paragraph: "the numbers and letters without
   * periods or spaces", e.g. `2b(4)(a)`. This is the form a reader is told to
   * use, so it is the form findings quote back.
   */
  citation: string;
  level: number;
  /** Index of the paragraph this one subdivides, or null at the top level. */
  parentIndex: number | null;
}

/**
 * The document's paragraph tree: for each paragraph, its citation, its level,
 * and which paragraph it subdivides.
 *
 * The counter walk is the same one both generators run to number paragraphs,
 * but the output deliberately isn't: they build a rendered label (`\uline{1}.`,
 * `\mbox{a.}`) while this builds the ¶13c citation. Same traversal, different
 * artifact — which is why this doesn't try to replace `calculateLabels`.
 *
 * Levels are counted per parent rather than globally, so `1a` and `2a` both
 * exist and each restarts at "a". A level that skips one (a level-2 paragraph
 * directly under a level-0) attaches to the nearest shallower paragraph rather
 * than inventing a missing ancestor: the citation reads oddly because the
 * document is odd, but the walk can't leave a hole for a caller to trip over.
 */
export function outlineParagraphs(levels: number[]): ParagraphOutlineEntry[] {
  const out: ParagraphOutlineEntry[] = [];
  const open: { level: number; index: number; citation: string }[] = [];
  const counts = new Map<string, number>();

  levels.forEach((level, index) => {
    while (open.length > 0 && open[open.length - 1].level >= level) open.pop();
    const parent = open.length > 0 ? open[open.length - 1] : null;
    const parentIndex = parent ? parent.index : null;

    const key = `${parentIndex}:${level}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);

    const mark = paragraphMark(level, count);
    // ¶13c drops the period but keeps the parentheses — "2b(4)(a)".
    const cited = level % 4 >= 2 ? `(${mark})` : mark;
    const citation = (parent ? parent.citation : '') + cited;

    out.push({ citation, level, parentIndex });
    open.push({ level, index, citation });
  });

  return out;
}

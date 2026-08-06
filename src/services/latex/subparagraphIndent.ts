/**
 * How far a subparagraph's first line is indented.
 *
 * SECNAV M-5216.5 Figure 7-8 states the rule in its own text: "Indent each new
 * subdivision to align with the first letter of the paragraph above." The
 * figure's typography bears it out — measuring the label and text positions it
 * prints, each subdivision's label starts where its parent's text starts:
 *
 *     1.  at x=124.2, its text at 137.3   ->  a.  at 138.4
 *     a.  at x=138.4, its text at 150.7   ->  (1) at 154.3
 *     (1) at x=154.3, its text at 170.3   ->  (a) at 172.3
 *
 * So the step is the width of the parent's label plus the gap after it, not a
 * constant. The figure says so directly for the case that gives it away: "When
 * using two digits, continue to indent each new subdivision (paragraphs will
 * not line up)" — and under "10." it prints the first subdivision 1.7pt further
 * right than under "1.", because the label got one digit wider.
 *
 * We were using a flat 0.25in per level, which cannot do that. At Courier 12pt
 * it put level 1 at 2.5 character cells where the figure wants 7.
 *
 * Both generators call this so the PDF and the Word export land on the same
 * number; the Word path carries it as an indent marker, the PDF as \hspace*.
 */

/** The body faces DonDocs offers. Anything else falls back to Times metrics. */
export type LabelFont = 'times' | 'courier';

/**
 * Glyph widths in 1/1000 em, for the characters a paragraph label can contain:
 * digits, lowercase letters, parentheses and the period. These are the standard
 * Adobe core-font metrics, which both the LaTeX Times/Courier faces and Word's
 * Times New Roman / Courier New follow closely enough for a first-line indent.
 */
const TIMES: Record<string, number> = {
  ' ': 250, '.': 250, '(': 333, ')': 333,
  '0': 500, '1': 500, '2': 500, '3': 500, '4': 500,
  '5': 500, '6': 500, '7': 500, '8': 500, '9': 500,
  a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278,
  j: 278, k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333,
  s: 389, t: 278, u: 500, v: 500, w: 722, x: 500, y: 500, z: 444,
};

/** Courier is monospaced: every glyph, including the space, is 600/1000 em. */
const COURIER_ADVANCE = 600;

/** Width of one character in 1/1000 em. Unknown glyphs take the digit width,
 *  which is the commonest case in a label and never far off. */
function charWidth(ch: string, font: LabelFont): number {
  if (font === 'courier') return COURIER_ADVANCE;
  return TIMES[ch] ?? TIMES['0'];
}

/** Width of a whole label ("1.", "(12)", "a.") in 1/1000 em. */
export function labelWidthMilliEm(label: string, font: LabelFont): number {
  let total = 0;
  for (const ch of label) total += charWidth(ch, font);
  return total;
}

/** Spaces printed between a label and the text it introduces. Figure 7-8 shows
 *  two, and both generators emit two. */
export const GAP_SPACES = 2;

/**
 * First-line indent, in inches, for a paragraph whose ancestors carried
 * `ancestorLabels` (outermost first). A level-0 paragraph has none and sits
 * flush at the margin.
 *
 * Each ancestor contributes its own label plus the gap after it, which is
 * exactly where that ancestor's text — and so this paragraph's label — begins.
 */
export function subparagraphIndentIn(
  ancestorLabels: string[],
  font: LabelFont,
  fontSizePt: number,
): number {
  let milliEm = 0;
  for (const label of ancestorLabels) {
    milliEm += labelWidthMilliEm(label, font) + GAP_SPACES * charWidth(' ', font);
  }
  return (milliEm / 1000) * fontSizePt / 72;
}

/**
 * For each paragraph, the labels of the ancestors it sits under.
 *
 * `labels` is the already-computed label for every paragraph, in document
 * order, and `levels` their nesting depths. A paragraph's ancestors are
 * whichever labels were most recently used at each shallower level, so the
 * indent tracks the real "10." that precedes it rather than a nominal "1.".
 */
export function ancestorLabelsPerParagraph(
  labels: string[],
  levels: number[],
): string[][] {
  const current: string[] = [];
  return labels.map((label, i) => {
    const level = levels[i];
    current.length = level;
    // A document can open at a subparagraph with nothing above it, which
    // leaves holes in `current`. Those levels contribute no width, so drop
    // them rather than measuring an undefined label.
    const ancestors = current.slice(0, level).filter((l): l is string => typeof l === 'string');
    current[level] = label;
    return ancestors;
  });
}

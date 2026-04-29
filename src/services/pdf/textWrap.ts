/**
 * Shared text-wrap helper for NAVMC form PDF generators.
 *
 * Both NAVMC 10274 and NAVMC 118(11) overlay user-typed multi-paragraph
 * text into fixed-width boxes on a pre-printed PDF. Wrapping needs to
 * respect SECNAV M-5216.5 Ch 7 ¶13 and MCO 1070.12K paragraph rules
 * (which 1070.12K incorporates by reference for personnel-record entries):
 *
 *   "Do not indent the continuation lines of a subparagraph."
 *
 * Meaning the continuation of a wrapped paragraph aligns with the
 * START of the paragraph TEXT (the position immediately after the
 * paragraph label, not at the box's left margin). For typed text
 * with no SECNAV label, the continuation should at minimum preserve
 * the user's leading whitespace.
 *
 * Issue #24 — before this helper, both NAVMC generators had identical
 * `wrapText` functions that just did `currentLine = word` on wrap,
 * dropping any leading whitespace + label prefix on every continuation
 * line. Sub-paragraphs like "  a. Long text..." wrapped to "a." (level-2
 * indent) on line 1 and column-0 on line 2 — wrong per MCO 1070.12K.
 *
 * SECNAV labels recognized at the start of a line (after optional
 * leading whitespace):
 *
 *   "1." / "23."             — Arabic with period (level 1)
 *   "a." / "Z."              — single letter with period (level 2)
 *   "(1)" / "(23)"           — parenthesized arabic (level 3)
 *   "(a)" / "(Z)"            — parenthesized letter (level 4)
 *
 * Underlined-numeric labels (levels 5+) only appear in the LaTeX layer
 * (rendered via \uline{}); they don't show up in raw user-typed text in
 * a form textarea, so they're not detected here.
 */

interface PdfFontLike {
  widthOfTextAtSize(text: string, size: number): number;
}

const SECNAV_LABEL_REGEX = /^(\s*)((?:\d+\.|\([0-9a-zA-Z]+\)|[a-zA-Z]\.))(\s+)/;

/**
 * Tab → space normalization.
 *
 * pdf-lib's `widthOfTextAtSize` uses the embedded font's glyph table;
 * tab characters typically don't have a glyph and either render as
 * zero-width or get dropped silently — making the visual width
 * unpredictable. The hanging-indent algorithm below treats the leading
 * prefix as character-equivalent spaces, so a leading "\t" would be
 * counted as 1 space (visually wrong: a tab is wider than a space in
 * any font).
 *
 * Normalizing tab → 4 spaces up front gives:
 *   - predictable rendering width
 *   - correct hang-prefix computation
 *   - consistent behavior whether the user typed spaces or pasted
 *     tab-indented content from another editor
 *
 * 4 was picked as the common SECNAV-style sub-paragraph indent (Ch 7
 * ¶13: "Each level indents 0.25" from the previous"). Most editors
 * default to 4 too, so pasted content from Word / VSCode / etc.
 * round-trips cleanly. The constant is here in case a future tweak
 * (e.g. an 8-space convention for some forms) wants to override it.
 */
const TAB_AS_SPACES = '    ';

/**
 * Split `text` into rendered lines that fit within `maxWidth` at the
 * given font/size. Preserves SECNAV-style hanging indent on
 * continuation lines: the same number of leading spaces as the
 * original paragraph's `leading-whitespace + label + trailing-space`
 * prefix (or just the leading whitespace if no label is detected).
 *
 * Empty paragraphs (blank lines in the input) survive as empty
 * strings in the output, so the caller's `drawMultilineText` produces
 * a visible blank line.
 */
export function wrapTextForForm(
  text: string,
  maxWidth: number,
  font: PdfFontLike,
  fontSize: number
): string[] {
  const lines: string[] = [];
  // Normalize tabs to 4 spaces before any other processing — see
  // TAB_AS_SPACES doc comment above.
  const paragraphs = text.replace(/\t/g, TAB_AS_SPACES).split('\n');

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }

    // Compute the leading prefix and the hang prefix.
    //
    // labelMatch present  → leadingPrefix = "  a. " (whitespace + label
    //                                                + trailing space)
    //                       hangPrefix    = "     " (spaces, same width)
    //
    // No label, leading WS → leadingPrefix = hangPrefix = "  "
    //
    // No leading WS         → leadingPrefix = hangPrefix = ""
    const labelMatch = para.match(SECNAV_LABEL_REGEX);
    const leadingPrefix = labelMatch
      ? labelMatch[0]
      : (para.match(/^\s*/)?.[0] ?? '');
    const hangPrefix = ' '.repeat(leadingPrefix.length);

    // The body is everything after the leading prefix.
    const body = para.slice(leadingPrefix.length);
    const words = body.split(/\s+/).filter((w) => w.length > 0);

    // No body words after the leading prefix — typically a label-only
    // paragraph the user is mid-typing (e.g. "1. " or "   a. ") or an
    // intentional empty list item between content paragraphs. Preserve
    // the prefix as a standalone line; without this branch we'd drop
    // the line entirely and the user's "1." would silently vanish.
    if (words.length === 0) {
      lines.push(leadingPrefix);
      continue;
    }

    let currentPrefix = leadingPrefix;
    let currentText = '';

    for (const word of words) {
      const candidate = currentText ? `${currentText} ${word}` : word;
      const fullLine = currentPrefix + candidate;

      if (font.widthOfTextAtSize(fullLine, fontSize) > maxWidth && currentText) {
        // Wrap: push the current line, start a new continuation line.
        lines.push(currentPrefix + currentText);
        currentPrefix = hangPrefix;
        currentText = word;
      } else {
        currentText = candidate;
      }
    }

    if (currentText) {
      lines.push(currentPrefix + currentText);
    }
  }

  return lines;
}

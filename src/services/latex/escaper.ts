/**
 * Map non-ASCII symbols to LaTeX commands that render with the FONTS WE BUNDLE.
 *
 * Why this exists: the offline SwiftLaTeX engine ships a curated 85-file font
 * set (Computer Modern + Times + Courier). `textcomp` is loaded, which routes
 * symbols like `§` (U+00A7) to the TS1 ("text companion") encoding. But the TS1
 * Computer Modern metrics (`tcrm*.tfm`) are NOT in the bundle, so a single `§`
 * — e.g. a routine "5 U.S.C. § 552a" citation — makes pdfTeX abort with
 * `Font TS1/cmr/m/n/12=tcrm1200 ... Metric (TFM) file not found` and produces
 * NO PDF at all. (On the deployed site the engine would try to fetch the
 * missing metric and 404; on air-gap it fails outright.)
 *
 * Each mapping below targets a glyph in a font we DO ship:
 *   - § ¶ † ‡ use the EXPLICIT math-mode symbols (`\ensuremath{\mathsection}`
 *     etc.), which draw from `cmsy` (bundled). The text-mode shorthands
 *     (`\S`, `\P`, `\dag`, `\ddag`) must NOT be used here: on the modern
 *     LaTeX kernel the bundle ships (textcomp integrated, 2020+), they
 *     expand to `\textsection`/`\textparagraph`/… whose DEFAULT encoding is
 *     TS1 — landing on the exact missing-`tcrm*.tfm` crash this map exists
 *     to prevent. Verified empirically: a Times doc with `\S{}` loads
 *     `ts1ptm.fd` + requests TS1 fonts; `\ensuremath{\mathsection}` loads
 *     only `cmsy10`.
 *   - `\ensuremath{...}` symbols (°, ×, ÷, ±, µ, •, ·) come from cmsy/cmmi.
 *   - `\textcircled{c}` composes a circle (cmsy `\bigcirc`) + letter from the
 *     base font — verified to load no TS1 fonts.
 *   - Smart quotes / dashes / ellipsis map to their classic ASCII-LaTeX forms.
 *
 * Anything NOT mapped here that is also non-ASCII and not a letter/combining
 * mark is dropped by the fail-safe in `applyLatexSymbolFallback` — better to
 * lose one exotic glyph than to fatal the whole compile. Letters (incl.
 * accented: é, ü, ñ …) are preserved; inputenc composes them from the base
 * font. Extend SYMBOL_REPLACEMENTS as new symbols are reported — and when you
 * do, prove the new form requests no TS1 fonts (see
 * tests/integration/latex-compile-no-ts1.test.ts).
 *
 * NOTE: this is for the PDF (SwiftLaTeX) path only. The DOCX/pandoc path
 * (flat-generator.ts) handles Unicode natively and must NOT use this.
 */
const SYMBOL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/§/g, '\\ensuremath{\\mathsection}'],   // § section sign (cmsy, NOT \S — TS1)
  [/¶/g, '\\ensuremath{\\mathparagraph}'], // ¶ pilcrow (cmsy, NOT \P — TS1)
  [/†/g, '\\ensuremath{\\dagger}'],        // † dagger (cmsy, NOT \dag — TS1)
  [/‡/g, '\\ensuremath{\\ddagger}'],       // ‡ double dagger (cmsy, NOT \ddag — TS1)
  [/©/g, '\\textcircled{c}'], // © copyright
  [/®/g, '\\textcircled{r}'], // ® registered
  [/™/g, '\\textsuperscript{TM}'], // ™ trademark
  [/°/g, '\\ensuremath{^\\circ}'], // ° degree
  [/±/g, '\\ensuremath{\\pm}'],    // ± plus-minus
  [/×/g, '\\ensuremath{\\times}'], // × multiplication
  [/÷/g, '\\ensuremath{\\div}'],   // ÷ division
  [/µ/g, '\\ensuremath{\\mu}'],    // µ micro
  [/•/g, '\\ensuremath{\\bullet}'], // • bullet
  [/·/g, '\\ensuremath{\\cdot}'],  // · middle dot
  [/…/g, '\\ldots{}'],        // … ellipsis
  [/–/g, '--'],               // – en dash
  [/—/g, '---'],              // — em dash
  [/‘/g, '`'],                // ' left single quote
  [/’/g, "'"],                // ' right single quote / apostrophe
  [/“/g, '``'],               // " left double quote
  [/”/g, "''"],               // " right double quote
];

/**
 * Apply the bundled-font symbol map, then a fail-safe that strips any remaining
 * non-ASCII that is not a letter or combining mark — so an unmapped symbol can
 * never hard-fail the compile. Must run AFTER the special-char escaping phase
 * (the replacements introduce `\` and `{}` that must not be re-escaped).
 */
function applyLatexSymbolFallback(text: string): string {
  let out = text;
  for (const [re, rep] of SYMBOL_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  // Fail-safe: drop unmapped non-ASCII symbols/punctuation. ASCII (incl.
  // whitespace and the newlines body text relies on) is kept via \p{ASCII};
  // letters (\p{L}) and marks (\p{M}) are kept so accented names still render
  // via inputenc. Only stray non-ASCII *symbols* (emoji, exotic glyphs) are
  // removed — they have no bundled font and a raw one would fatal the compile.
  out = out.replace(/[^\p{ASCII}\p{L}\p{M}]/gu, '');
  return out;
}

/**
 * Escape special LaTeX characters (with placeholder support)
 */
export function escapeLatex(str: string | undefined | null): string {
  if (!str) return '';

  // First, extract and protect placeholders before escaping
  // Use keys without special chars (no underscores - they conflict with underline pattern)
  const placeholderMap: Record<string, string> = {};
  let placeholderIndex = 0;
  const protectedStr = str.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, name) => {
    const key = `ZZZVARPLACEHOLDER${placeholderIndex++}ZZZ`;
    placeholderMap[key] = name;
    return key;
  });

  // Escape LaTeX special chars
  // ORDER MATTERS: Replacements that introduce { } (like {\char36}, \textbackslash{})
  // must come AFTER the { and } escaping, or their braces get re-escaped.
  // Phase 1: Escape \ first (must be first to avoid double-escaping)
  // Phase 2: Escape simple chars that don't introduce braces
  // Phase 3: Escape { and } from the original text
  // Phase 4: Replacements that introduce new { } (safe now — won't be re-escaped)
  // codeql[js/incomplete-sanitization]: false positive — sentinel pattern
  // (Phase 1 below) escapes all `\` from input before subsequent replaces add their own.
  let result = protectedStr
    .replace(/\\/g, 'ZZZTEXTBACKSLASHZZZ')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\$/g, 'ZZZDOLLARZZZ')
    .replace(/~/g, 'ZZZTILDEZZZ')
    .replace(/\^/g, 'ZZZCARETZZZ')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/ZZZTEXTBACKSLASHZZZ/g, '\\textbackslash{}')
    .replace(/ZZZDOLLARZZZ/g, '{\\char36}')
    .replace(/ZZZTILDEZZZ/g, '\\textasciitilde{}')
    .replace(/ZZZCARETZZZ/g, '\\textasciicircum{}');

  // Phase 5: map non-ASCII symbols (§, ¶, ©, °, …) to bundled-font LaTeX so a
  // single such character can't fatal the offline compile. Runs after escaping
  // because it introduces `\` and `{}` that must not be re-escaped.
  result = applyLatexSymbolFallback(result);

  // Restore placeholders with highlighted LaTeX rendering
  // Escape underscores in the placeholder name for LaTeX text mode
  for (const [key, name] of Object.entries(placeholderMap)) {
    // codeql[js/incomplete-sanitization]: false positive — `name` is captured
    // from /\{\{([A-Za-z0-9_]+)\}\}/, which cannot contain `\`.
    const escapedName = name.replace(/_/g, '\\_');
    result = result.replace(key, `\\fcolorbox{orange}{yellow!30}{\\textsf{\\small ${escapedName}}}`);
  }

  return result;
}

/**
 * Wrap subject line at specified character limit without breaking words
 * Per SECNAV M-5216.5: Subject lines should wrap at approximately 57 characters
 * Returns array of lines that can be joined with LaTeX line breaks
 */
export function wrapSubjectLine(str: string | undefined | null, maxLength: number = 57): string[] {
  if (!str) return [];

  const lines: string[] = [];
  let i = 0;

  while (i < str.length) {
    let chunk = str.substring(i, i + maxLength);

    // Don't break words - find last space if we're not at the end
    if (i + maxLength < str.length && str[i + maxLength] !== ' ' && chunk.includes(' ')) {
      const lastSpaceIndex = chunk.lastIndexOf(' ');
      if (lastSpaceIndex > -1) {
        chunk = chunk.substring(0, lastSpaceIndex);
        i += chunk.length + 1; // +1 to skip the space
      } else {
        i += maxLength;
      }
    } else {
      i += maxLength;
    }

    lines.push(chunk.trim());
  }

  return lines;
}

/**
 * Format subject line for LaTeX with proper wrapping and escaping
 * Wraps at 57 characters and joins with LaTeX line breaks
 * Each line is escaped for LaTeX special characters
 * Uses \newline for breaks within tabular p{} columns (not \\ which creates new rows)
 */
export function formatSubjectForLatex(subject: string | undefined | null): string {
  const lines = wrapSubjectLine(subject, 57);
  if (lines.length === 0) return '';

  // Escape each line for LaTeX special characters
  const escapedLines = lines.map(line => escapeLatex(line));

  if (escapedLines.length === 1) return escapedLines[0];

  // Join with \newline for line breaks within tabular p{} column
  // \newline works within paragraph columns, while \\ would create new table rows
  return escapedLines.join('\\newline ');
}

/**
 * Format address line (From/To) for LaTeX with proper wrapping and escaping
 * Uses same wrapping logic as subject but for address fields
 */
export function formatAddressForLatex(address: string | undefined | null, maxLength: number = 57): string {
  const lines = wrapSubjectLine(address, maxLength);
  if (lines.length === 0) return '';

  // Escape each line for LaTeX special characters
  const escapedLines = lines.map(line => escapeLatex(line));

  if (escapedLines.length === 1) return escapedLines[0];

  // Join with \newline for line breaks within tabular p{} column
  return escapedLines.join('\\newline ');
}

/**
 * Escape URL for LaTeX before embedding it in `\href{...}{...}`.
 *
 * Threat model: the URL has been validated by `safeUrl()` (allowed
 * scheme, scheme injection prevented), but `safeUrl` preserves the
 * user-typed form including LaTeX-active characters. If we don't
 * escape them here, a URL like `https://example.com/has\xyzzy123`
 * compiles to `\href{https://example.com/has\xyzzy123}{link}` and
 * xelatex throws `! Undefined control sequence` on `\xyzzy123` —
 * a denial-of-service via a single user-supplied reference URL.
 *
 * Active chars in `\href` URL argument:
 *   `\` — LaTeX command introducer (THE main DoS vector)
 *   `%` — comment marker (eats rest of line)
 *   `#` — parameter substitution
 *   `&` — alignment tab
 *   `{` `}` — group delimiters (mismatch breaks compile)
 *   `$` — math mode toggle
 *   `^` `~` — superscript / non-breaking space (special in some macro contexts)
 *
 * `_` is NOT escaped: hyperref's `\href` detokenizes the URL argument,
 * so a literal `_` in the URL renders fine without escape (verified
 * with xelatex). Escaping `_` here would actually break URLs like
 * `https://example.com/my_path` because the URL string would contain
 * `\_` which xelatex would see as a literal-underscore command, but
 * `hyperref` would then encode the `\` as `%5C` in the link target —
 * silently corrupting every legitimate URL with an underscore.
 *
 * Order matters: backslash MUST be escaped first via the sentinel
 * pattern (same trick as `escapeLatex`). Otherwise the `\` we
 * introduce for `\&`, `\%`, etc. would itself match the backslash
 * regex and double-escape.
 */
export function escapeLatexUrl(url: string | undefined | null): string {
  if (!url) return '';
  // codeql[js/incomplete-sanitization]: false positive — sentinel pattern
  // (Phase 1 below) escapes all `\` from input before subsequent replaces add their own.
  return url
    // Phase 1: backslash → sentinel (so the escape `\` below don't recurse).
    .replace(/\\/g, 'ZZZURLBACKSLASHZZZ')
    // Phase 2: chars that don't introduce new `\`.
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    // Phase 3: chars whose escape introduces `\` — safe now since backslash
    // matching is on the sentinel, not a real `\`.
    .replace(/\$/g, 'ZZZURLDOLLARZZZ')
    .replace(/\^/g, 'ZZZURLCARETZZZ')
    .replace(/~/g, 'ZZZURLTILDEZZZ')
    // Phase 4: finalize sentinels to their LaTeX-safe forms.
    .replace(/ZZZURLBACKSLASHZZZ/g, '\\textbackslash{}')
    .replace(/ZZZURLDOLLARZZZ/g, '\\$')
    .replace(/ZZZURLCARETZZZ/g, '\\^{}')
    .replace(/ZZZURLTILDEZZZ/g, '\\~{}');
}

/**
 * Convert rich text markers to LaTeX commands
 * **bold** -> \textbf{bold}
 * *italic* -> \textit{italic}
 * __underline__ -> \uline{underline}
 * Enclosure (1) -> \enclref{1} (clickable link when hyperlinks enabled)
 * enclosure (1) -> \enclref{1}
 * Encl (1) -> \enclref{1}
 */
export function convertRichTextToLatex(text: string): string {
  let result = text;

  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');

  // Italic: *text* (but not **)
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '\\textit{$1}');

  // Underline: __text__
  // The inner group uses [^_]+? (not .+?) so a run of 3+ raw underscores
  // (fill-in-the-blank lines like `Signature: __________`) doesn't get
  // partially consumed as `\uline{_}` and produce a corrupted PDF.
  // See variable-chip-editor.tsx for the matching editor-side fix and
  // issue #14 for full context.
  result = result.replace(/__([^_]+?)__/g, '\\uline{$1}');

  // Enclosure references: "Enclosure (1)", "enclosure (1)", "Encl (1)", "encl (1)"
  // These get converted to \enclref{1} which creates clickable hyperlinks when enabled
  result = result.replace(/[Ee]nclosure\s*\((\d+)\)/g, '\\enclref{$1}');
  result = result.replace(/[Ee]ncl\s*\((\d+)\)/g, '\\enclref{$1}');

  // Also support "reference (a)" -> \ref{a} for document references
  // Note: \ref{} in our LaTeX template creates clickable links to references
  result = result.replace(/[Rr]eference\s*\(([a-zA-Z])\)/g, '\\reflink{$1}');
  result = result.replace(/[Rr]ef\s*\(([a-zA-Z])\)/g, '\\reflink{$1}');

  return result;
}

/**
 * Convert batch placeholders {{NAME}} to highlighted LaTeX display
 * Shows placeholders with yellow background so they're visible in preview
 */
export function highlightPlaceholders(text: string): string {
  // Match {{PLACEHOLDER_NAME}} pattern (case insensitive)
  return text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, name) => {
    // Escape underscores in the placeholder name for LaTeX text mode.
    // codeql[js/incomplete-sanitization]: false positive — `name` is captured
    // from /[A-Za-z0-9_]+/ above, which cannot contain `\`.
    const escapedName = name.replace(/_/g, '\\_');
    // Render as highlighted box with the placeholder name
    return `\\fcolorbox{orange}{yellow!30}{\\textsf{\\small ${escapedName}}}`;
  });
}

/**
 * Escape LaTeX and convert rich text markers
 */
export function processBodyText(text: string): string {
  // First, extract and protect placeholders before escaping
  // Use keys without special chars (no underscores - they conflict with underline pattern)
  const placeholderMap: Record<string, string> = {};
  let placeholderIndex = 0;
  const protectedText = text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, name) => {
    const key = `ZZZVARPLACEHOLDER${placeholderIndex++}ZZZ`;
    placeholderMap[key] = name;
    return key;
  });

  // Convert any legacy LaTeX formatting commands to markdown markers
  // (backward compatibility for previously saved content from old editor)
  let converted = protectedText;
  let prev = '';
  while (prev !== converted) {
    prev = converted;
    converted = converted
      .replace(/\\textbf\{([^{}]*)\}/g, '**$1**')
      .replace(/\\textit\{([^{}]*)\}/g, '*$1*')
      .replace(/\\underline\{([^{}]*)\}/g, '__$1__');
  }

  // Now escape LaTeX special chars (but not our markers)
  // ORDER MATTERS: Use placeholders for replacements that introduce { }
  // so they don't get re-escaped by the { } escaping step.
  // codeql[js/incomplete-sanitization]: false positive — sentinel pattern
  // (first replace) escapes all `\` from input before subsequent replaces add their own.
  let result = converted
    .replace(/\\/g, 'ZZZTEXTBACKSLASHZZZ')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/\$/g, 'ZZZDOLLARZZZ')
    .replace(/~/g, 'ZZZTILDEZZZ')
    .replace(/\^/g, 'ZZZCARETZZZ')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/ZZZTEXTBACKSLASHZZZ/g, '\\textbackslash{}')
    .replace(/ZZZDOLLARZZZ/g, '{\\char36}')
    .replace(/ZZZTILDEZZZ/g, '\\textasciitilde{}')
    .replace(/ZZZCARETZZZ/g, '\\textasciicircum{}');

  // Note: Don't escape _ or * as they're used for formatting
  // The rich text conversion will handle them

  // Map non-ASCII symbols (§, ¶, ©, °, …) to bundled-font LaTeX so a single
  // such character in a paragraph can't fatal the offline compile. Runs after
  // escaping (it introduces `\` and `{}`) but before the rich-text marker
  // conversion, which only touches `*` / `_` markers.
  result = applyLatexSymbolFallback(result);

  // Convert newlines to LaTeX line breaks so input line breaks appear in PDF
  result = result.replace(/\n/g, '\\\\\n');

  // Then convert rich text markers
  result = convertRichTextToLatex(result);

  // Restore placeholders with highlighted LaTeX rendering
  // Escape underscores in the placeholder name for LaTeX text mode
  for (const [key, name] of Object.entries(placeholderMap)) {
    // codeql[js/incomplete-sanitization]: false positive — `name` is captured
    // from /\{\{([A-Za-z0-9_]+)\}\}/, which cannot contain `\`.
    const escapedName = name.replace(/_/g, '\\_');
    result = result.replace(key, `\\fcolorbox{orange}{yellow!30}{\\textsf{\\small ${escapedName}}}`);
  }

  return result;
}

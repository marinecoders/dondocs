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

  // Restore placeholders with highlighted LaTeX rendering
  // Escape underscores in the placeholder name for LaTeX text mode
  for (const [key, name] of Object.entries(placeholderMap)) {
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
    // Escape underscores in the placeholder name for LaTeX text mode
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

  // Convert newlines to LaTeX line breaks so input line breaks appear in PDF
  result = result.replace(/\n/g, '\\\\\n');

  // Then convert rich text markers
  result = convertRichTextToLatex(result);

  // Restore placeholders with highlighted LaTeX rendering
  // Escape underscores in the placeholder name for LaTeX text mode
  for (const [key, name] of Object.entries(placeholderMap)) {
    const escapedName = name.replace(/_/g, '\\_');
    result = result.replace(key, `\\fcolorbox{orange}{yellow!30}{\\textsf{\\small ${escapedName}}}`);
  }

  return result;
}

/**
 * Escape special LaTeX characters (with placeholder support)
 */
export function escapeLatex(str: string | undefined | null): string {
  if (!str) return '';

  // First, extract and protect placeholders before escaping
  const placeholderMap: Record<string, string> = {};
  let placeholderIndex = 0;
  let protectedStr = str.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, name) => {
    const key = `__PLACEHOLDER_${placeholderIndex++}__`;
    placeholderMap[key] = name;
    return key;
  });

  // Escape LaTeX special chars
  let result = protectedStr
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');

  // Restore placeholders with highlighted LaTeX rendering
  for (const [key, name] of Object.entries(placeholderMap)) {
    result = result.replace(key, `\\fcolorbox{orange}{yellow!30}{\\textsf{\\small ${name}}}`);
  }

  return result;
}

/**
 * Escape URL for LaTeX (handle % and other special chars)
 */
export function escapeLatexUrl(url: string | undefined | null): string {
  if (!url) return '';
  return url
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/&/g, '\\&');
}

/**
 * Convert rich text markers to LaTeX commands
 * **bold** -> \textbf{bold}
 * *italic* -> \textit{italic}
 * __underline__ -> \underline{underline}
 */
export function convertRichTextToLatex(text: string): string {
  let result = text;

  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');

  // Italic: *text* (but not **)
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '\\textit{$1}');

  // Underline: __text__
  result = result.replace(/__(.+?)__/g, '\\underline{$1}');

  return result;
}

/**
 * Convert batch placeholders {{NAME}} to highlighted LaTeX display
 * Shows placeholders with yellow background so they're visible in preview
 */
export function highlightPlaceholders(text: string): string {
  // Match {{PLACEHOLDER_NAME}} pattern (case insensitive)
  return text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, name) => {
    // Render as highlighted box with the placeholder name
    return `\\fcolorbox{orange}{yellow!30}{\\textsf{\\small ${name}}}`;
  });
}

/**
 * Escape LaTeX and convert rich text markers
 */
export function processBodyText(text: string): string {
  // First, extract and protect placeholders before escaping
  const placeholderMap: Record<string, string> = {};
  let placeholderIndex = 0;
  let protectedText = text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, name) => {
    const key = `__PLACEHOLDER_${placeholderIndex++}__`;
    placeholderMap[key] = name;
    return key;
  });

  // Now escape LaTeX special chars (but not our markers)
  let result = protectedText
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');

  // Note: Don't escape _ or * as they're used for formatting
  // The rich text conversion will handle them

  // Then convert rich text markers
  result = convertRichTextToLatex(result);

  // Restore placeholders with highlighted LaTeX rendering
  for (const [key, name] of Object.entries(placeholderMap)) {
    result = result.replace(key, `\\fcolorbox{orange}{yellow!30}{\\textsf{\\small ${name}}}`);
  }

  return result;
}

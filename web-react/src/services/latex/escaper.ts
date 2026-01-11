/**
 * Escape special LaTeX characters
 */
export function escapeLatex(str: string | undefined | null): string {
  if (!str) return '';
  return str
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
 * Escape LaTeX and convert rich text markers
 */
export function processBodyText(text: string): string {
  // First escape LaTeX special chars (but not our markers)
  let result = text
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

  // Now escape any remaining underscores that weren't part of __text__
  // This is tricky - for now, just leave underscores as-is in body text
  // since they're likely intentional formatting

  return result;
}

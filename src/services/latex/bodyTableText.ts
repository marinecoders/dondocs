import { escapeLatex, highlightPlaceholders } from './escaper';

export const BREAKABLE_TEXT_COMMANDS = String.raw`\long\def\dondocsTableWord#1#2{\begingroup\setbox0=\hbox{#1}\ifdim\wd0>\linewidth #2\else #1\fi\endgroup}
\long\def\dondocsTableGlyph#1{\begingroup\setbox0=\hbox{#1}\ifdim\wd0>\linewidth\errmessage{DonDocs: a table column is too narrow for its font; widen the column}\fi #1\endgroup}
\long\def\dondocsTableAtomic#1{\begingroup\setbox0=\hbox{#1}\ifdim\wd0>\linewidth\errmessage{DonDocs: a table link or placeholder needs a wider column}\fi #1\endgroup}
`;

type Emphasis = 'bold' | 'italic' | 'underline';
const style = (value: string, marks: readonly Emphasis[]) => marks.reduce((text, mark) => `\\${mark === 'bold' ? 'textbf' : mark === 'italic' ? 'textit' : 'uline'}{${text}}`, value);
function graphemes(value: string): string[] {
  const result: string[] = [];
  for (const character of value) {
    if (/\p{M}/u.test(character) && result.length) result[result.length - 1] += character;
    else result.push(character);
  }
  return result;
}
/** Literal text only. Break points never enter generated commands or targets. */
export function bodyTableLiteral(value: string, marks: readonly Emphasis[] = []): string {
  return value.split(/(\s+)/u).map(token => {
    if (!token) return '';
    if (/^\s+$/u.test(token)) {
      const newlines = token.match(/\r\n?|\n/g);
      return newlines ? '\\newline '.repeat(newlines.length) : token.length > 1 ? '\\ \\ ' : ' ';
    }
    const escaped = graphemes(token).map(character => {
      const value = escapeLatex(character);
      if (!value && character.trim()) throw new Error('This text contains a character unavailable in the selected PDF fonts. Replace it with a supported character.');
      return value;
    });
    const whole = style(escaped.join(''), marks);
    const broken = escaped.map(character => `\\dondocsTableGlyph{${style(character, marks)}}`).join('\\allowbreak{}');
    return `\\dondocsTableWord{${whole}}{${broken}}`;
  }).join('');
}

/** Parse the native emphasis markers before escaping text. Each glyph keeps
 * its style when an overwide word needs to break, including underlined words. */
export function bodyTableText(value: string, marks: readonly Emphasis[] = [], depth = 0, protectedTokens: readonly string[] = []): string {
  if (depth > 16) throw new Error('Table emphasis is nested too deeply.');
  const normalized = value.replace(/\r\n?/g, '\n')
    .replace(/\\textbf\{([^{}]*)\}/g, '**$1**').replace(/\\textit\{([^{}]*)\}/g, '*$1*').replace(/\\underline\{([^{}]*)\}/g, '__$1__');
  const pattern = /\*\*(.+?)\*\*|(?<!\*)\*([^*]+)\*(?!\*)|_{3,}|__([^_]+?)__|\{\{[A-Za-z0-9_]+\}\}|ZZZPUBLICATIONLINKX*\d+ZZZ|(?:[Rr]eference|[Rr]ef)\s*\(([a-zA-Z])\)|(?:[Ee]nclosure|[Ee]ncl)\s*\((\d+)\)/g;
  const protectedSet = new Set(protectedTokens);
  let cursor = 0, output = '';
  for (const match of normalized.matchAll(pattern)) {
    output += bodyTableLiteral(normalized.slice(cursor, match.index), marks);
    if (match[1] !== undefined || match[2] !== undefined || match[3] !== undefined) {
      const mark: Emphasis = match[1] !== undefined ? 'bold' : match[2] !== undefined ? 'italic' : 'underline';
      output += bodyTableText(match[1] ?? match[2] ?? match[3], [...marks, mark], depth + 1, protectedTokens);
    } else if (protectedSet.has(match[0])) output += style(match[0], marks);
    else if (match[0].startsWith('{{')) output += `\\dondocsTableAtomic{${highlightPlaceholders(match[0])}}`;
    else if (match[4] || match[5]) output += `\\dondocsTableAtomic{${style(match[4] ? `\\reflink{${match[4]}}` : `\\enclref{${match[5]}}`, marks)}}`;
    else output += bodyTableLiteral(match[0], marks);
    cursor = match.index! + match[0].length;
  }
  return output + bodyTableLiteral(normalized.slice(cursor), marks);
}

export const renderBreakableRichText = bodyTableText;

import { citationProtectedRanges } from './referenceCitations';
import { maskProtectedRanges } from './protectedCodeRanges';
import { plainInlineText } from './inlineText';

export interface EnclosureCitationIssue {
  id: string;
  title: string;
  message: string;
}

/** Inspect explicit numeric clauses without rewriting or expanding a range. */
export function inspectEnclosureCitations(
  input: string,
  list: { first: number; count: number; inherited: boolean },
  onCitation?: (first: number, last: number) => void,
): EnclosureCitationIssue[] {
  // A non-space mask prevents inventing a citation across a protected literal,
  // such as enclosure "example" (2), when native emphasis is removed.
  const mask = '\uFFFC';
  const text = plainInlineText(maskProtectedRanges(input, citationProtectedRanges(input), mask));
  const issues = new Map<string, EnclosureCitationIssue>();
  const minimum = list.inherited ? 1 : list.first;
  const maximum = list.first + list.count - 1;
  const knownBounds = Number.isSafeInteger(minimum) && Number.isSafeInteger(maximum);
  const tokenAt = (offset: number) => /^\(\s*(\d+)\s*\)/.exec(text.slice(offset));
  const manual = (position: number, detail: string) => {
    const id = `manual:${position}`;
    issues.set(id, { id, title: 'Review the enclosure citation', message: `${detail} Confirm every enclosure target manually.` });
  };
  const check = (first: number, last: number, position: number, range: boolean) => {
    if (!knownBounds || !Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
      manual(position, 'This citation uses a number outside the supported integer range.');
      return;
    }
    if (first > last) {
      manual(position, 'This enclosure range runs backward.');
      return;
    }
    onCitation?.(first, last);
    const missing = first < minimum ? first : last > maximum ? Math.max(first, maximum + 1) : undefined;
    if (missing === undefined) return;
    const id = range ? `range:${first}:${last}` : String(first);
    issues.set(id, { id,
      title: range ? `Check enclosure range (${first})–(${last})` : `Check enclosure (${first})`,
      message: range
        ? `This range includes enclosure (${missing}), which has no entry in this document’s enclosure list. Confirm each target before delivery.`
        : 'This explicit citation has no entry in this document’s enclosure list. Confirm its target before delivery.',
    });
  };

  for (const clause of text.matchAll(/\b(?:enclosures?|encls?\.?)\s*(?=\()/gi)) {
    let cursor = clause.index + clause[0].length;
    for (;;) {
      const token = tokenAt(cursor);
      if (!token) {
        if (/^\(\s*[+-]?\d/.test(text.slice(cursor))) manual(clause.index, 'This numeric enclosure label has unsupported syntax.');
        break;
      }
      const first = Number(token[1]);
      cursor += token[0].length;
      const range = /^\s*(?:[-\u2010-\u2015]|(?:through|thru|to)\b)\s*(?=\(?\s*[+-]?\d|\uFFFC)/i.exec(text.slice(cursor));
      if (range) {
        cursor += range[0].length;
        const endpoint = tokenAt(cursor);
        if (!endpoint) {
          check(first, first, clause.index, false);
          if (text[cursor] !== mask) manual(clause.index, 'This enclosure range needs explicit parenthesized endpoints.');
          break;
        }
        check(first, Number(endpoint[1]), clause.index, true);
        cursor += endpoint[0].length;
      } else check(first, first, clause.index, false);
      const suffix = text.slice(cursor);
      const separator = /^(?:\s*[,;]\s*(?:(?:and|or)\s+)?|\s+(?:and|or|&)\s+)(?=\()/i.exec(suffix);
      if (!separator) {
        if (/^\s*(?:(?:[:/]|[-\u2010-\u2015]|(?:through|thru|to)\b)\s*)?(?=\(\s*[+-]?\d)/i.test(suffix)) manual(clause.index, 'This enclosure list uses an unsupported separator.');
        break;
      }
      cursor += separator[0].length;
    }
  }
  return [...issues.values()];
}

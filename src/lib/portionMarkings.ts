import type { Paragraph, PortionMarking } from '@/types/document';
import { plainInlineText } from './inlineText';

// A native Word baseline keeps its visible prefix so review offsets remain
// exact. Interpret that prefix for marking checks without rewriting the text
// or adding a second rendered portion marker.
const LEADING_PORTION = /^\s*\((U|CUI|FOUO|C|S|TS)\)/;
export function leadingPortionMarking(text: string): PortionMarking | undefined {
  // Match the native editor's emphasis interpretation, including formatting
  // split inside a prefix, e.g. **(**S) or (**S**). Saved text stays untouched.
  const plain = plainInlineText(text)
    // A formatted printed designator may remain in an exact Word baseline.
    .replace(/^\s*(?:\d+\.|[a-z]\.|\(\d+\)|\([a-z]\))\s+/, '');
  return LEADING_PORTION.exec(plain)?.[1] as PortionMarking | undefined;
}

type MarkedParagraph = Pick<Paragraph, 'portionMarking' | 'figure'> & Partial<Pick<Paragraph, 'text' | 'header' | 'bodyTable'>>;

/** Structured and preserved visible markings both contribute; neither can
 * silently lower the other when an imported baseline is edited. */
export function paragraphPortionMarkings(paragraph: MarkedParagraph): PortionMarking[] {
  const marks = [paragraph.portionMarking, paragraph.figure?.portionMarking];
  for (const text of [paragraph.header, paragraph.text, ...(paragraph.bodyTable?.rows.flat() ?? [])]) {
    if (text) for (const line of text.split(/\r?\n/)) marks.push(leadingPortionMarking(line));
  }
  return marks.filter((mark): mark is PortionMarking => mark !== undefined);
}

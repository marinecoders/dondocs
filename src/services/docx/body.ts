import { Paragraph as DocxParagraph, convertInchesToTwip } from 'docx';
import type { Paragraph } from '@/types/document';
import type { FontProps } from './styles';
import { SPACING, getIndentTwips } from './styles';
import { calculateLabels, parseRichText, toTitleCase, styledRun } from './utils';

export function buildBody(
  paragraphs: Paragraph[],
  fp: FontProps,
  opts: { numberedParagraphs: boolean; isBusinessLetter: boolean }
): DocxParagraph[] {
  const labels = calculateLabels(paragraphs);
  const result: DocxParagraph[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const label = opts.numberedParagraphs ? labels[i] : '';
    const headerText = para.header?.trim();
    const indent = getIndentTwips(para.level, opts.isBusinessLetter);

    // Build the children runs for this paragraph
    const children = [];

    if (opts.isBusinessLetter && para.level === 0) {
      // Business letter: 0.5" first-line indent, no label
      if (headerText) {
        const formattedHeader = toTitleCase(headerText);
        children.push(styledRun(formattedHeader, fp, { underline: {} }));
        children.push(styledRun('.  ', fp));
        children.push(...parseRichText(para.text, fp));
      } else {
        children.push(...parseRichText(para.text, fp));
      }

      result.push(
        new DocxParagraph({
          children,
          indent: { firstLine: convertInchesToTwip(0.5) },
          spacing: { before: para.level === 0 ? SPACING.small : 0, after: SPACING.normal },
        })
      );
    } else {
      // Standard paragraph with label
      // Portion marking prefix
      const portionPrefix = para.portionMarking ? `(${para.portionMarking}) ` : '';

      if (headerText) {
        const formattedHeader = toTitleCase(headerText);
        if (label) children.push(styledRun(`${label}  `, fp));
        children.push(styledRun(portionPrefix, fp));
        children.push(styledRun(formattedHeader, fp, { underline: {} }));
        children.push(styledRun('.  ', fp));
        children.push(...parseRichText(para.text, fp));
      } else {
        if (label) children.push(styledRun(`${label}  `, fp));
        children.push(styledRun(portionPrefix, fp));
        children.push(...parseRichText(para.text, fp));
      }

      result.push(
        new DocxParagraph({
          children,
          indent: indent > 0 ? { left: indent } : undefined,
          spacing: {
            before: para.level === 0 ? SPACING.small : 60,
            after: SPACING.normal,
          },
        })
      );
    }
  }

  return result;
}

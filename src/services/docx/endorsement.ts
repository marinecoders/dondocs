import { Paragraph as DocxParagraph, AlignmentType } from 'docx';
import type { FontProps } from './styles';
import { SPACING } from './styles';
import { styledRun } from './utils';

// Ordinal suffix for endorsement numbering (1st, 2nd, 3rd, etc.)
function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Same-page endorsement: horizontal rule separator + ordinal endorsement header
export function buildSamePageEndorsementHeader(endorsementNumber: number, fp: FontProps): DocxParagraph[] {
  return [
    // Horizontal rule (using underscores as separator)
    new DocxParagraph({
      children: [styledRun('_'.repeat(72), fp)],
      spacing: { before: SPACING.large },
    }),
    // Endorsement header
    new DocxParagraph({
      children: [styledRun(`${getOrdinal(endorsementNumber).toUpperCase()} ENDORSEMENT`, fp, { bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { before: SPACING.normal, after: SPACING.large },
    }),
  ];
}

// New-page endorsement header (letterhead is handled separately, this is just the designation)
export function buildNewPageEndorsementHeader(endorsementNumber: number, fp: FontProps): DocxParagraph[] {
  return [
    new DocxParagraph({
      children: [styledRun(`${getOrdinal(endorsementNumber).toUpperCase()} ENDORSEMENT`, fp, { bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: SPACING.large },
    }),
  ];
}

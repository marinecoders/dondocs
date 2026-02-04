import { Paragraph as DocxParagraph, AlignmentType } from 'docx';
import type { FontProps } from './styles';
import { SPACING, SINGLE_SPACING } from './styles';
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
    new DocxParagraph({
      children: [styledRun('_'.repeat(72), fp)],
      spacing: { ...SINGLE_SPACING, before: SPACING.line },
    }),
    new DocxParagraph({
      children: [styledRun(`${getOrdinal(endorsementNumber).toUpperCase()} ENDORSEMENT`, fp, { bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { ...SINGLE_SPACING, before: SPACING.half, after: SPACING.line },
    }),
  ];
}

// New-page endorsement header
export function buildNewPageEndorsementHeader(endorsementNumber: number, fp: FontProps): DocxParagraph[] {
  return [
    new DocxParagraph({
      children: [styledRun(`${getOrdinal(endorsementNumber).toUpperCase()} ENDORSEMENT`, fp, { bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { ...SINGLE_SPACING, after: SPACING.line },
    }),
  ];
}

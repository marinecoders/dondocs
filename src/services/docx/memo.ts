import { Paragraph as DocxParagraph, AlignmentType } from 'docx';
import type { FontProps } from './styles';
import { SPACING } from './styles';
import { styledRun } from './utils';

// Memo header variants by document type
export function buildMemoHeader(docType: string, fp: FontProps): DocxParagraph[] {
  const result: DocxParagraph[] = [];

  switch (docType) {
    case 'mfr':
      result.push(
        new DocxParagraph({
          children: [styledRun('MEMORANDUM FOR THE RECORD', fp, { bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: SPACING.large },
        })
      );
      break;

    case 'mf':
      // "MEMORANDUM FOR [addressee]" - left-aligned
      result.push(
        new DocxParagraph({
          children: [styledRun('MEMORANDUM FOR', fp, { bold: true })],
          spacing: { after: SPACING.normal },
        })
      );
      break;

    case 'plain_paper_memorandum':
    case 'letterhead_memorandum':
      result.push(
        new DocxParagraph({
          children: [styledRun('MEMORANDUM', fp, { bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: SPACING.large },
        })
      );
      break;

    case 'decision_memorandum':
      result.push(
        new DocxParagraph({
          children: [styledRun('MEMORANDUM', fp, { bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: SPACING.large },
        })
      );
      break;

    case 'executive_memorandum':
      // "ACTION MEMO" or "INFO MEMO" centered, Times New Roman
      result.push(
        new DocxParagraph({
          children: [styledRun('ACTION MEMO', fp, { bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: SPACING.large },
        })
      );
      break;

    case 'joint_memorandum':
      result.push(
        new DocxParagraph({
          children: [styledRun('JOINT MEMORANDUM', fp, { bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: SPACING.large },
        })
      );
      break;
  }

  return result;
}

// Decision memorandum: decision block at end (Approved/Disapproved/Other)
export function buildDecisionBlock(fp: FontProps): DocxParagraph[] {
  return [
    new DocxParagraph({
      children: [],
      spacing: { before: SPACING.large },
    }),
    new DocxParagraph({
      children: [styledRun('DECISION:', fp, { bold: true })],
      spacing: { after: SPACING.normal },
    }),
    new DocxParagraph({
      children: [styledRun('_____ Approved', fp)],
    }),
    new DocxParagraph({
      children: [styledRun('_____ Disapproved', fp)],
    }),
    new DocxParagraph({
      children: [styledRun('_____ Other: ________________________________', fp)],
      spacing: { after: SPACING.large },
    }),
  ];
}

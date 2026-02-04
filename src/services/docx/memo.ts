import { Paragraph as DocxParagraph, AlignmentType } from 'docx';
import type { FontProps } from './styles';
import { SPACING, SINGLE_SPACING } from './styles';
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
          spacing: { ...SINGLE_SPACING, after: SPACING.line },
        })
      );
      break;

    case 'mf':
      result.push(
        new DocxParagraph({
          children: [styledRun('MEMORANDUM FOR', fp, { bold: true })],
          spacing: { ...SINGLE_SPACING, after: SPACING.line },
        })
      );
      break;

    case 'plain_paper_memorandum':
    case 'letterhead_memorandum':
    case 'decision_memorandum':
      result.push(
        new DocxParagraph({
          children: [styledRun('MEMORANDUM', fp, { bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { ...SINGLE_SPACING, after: SPACING.line },
        })
      );
      break;

    case 'executive_memorandum':
      result.push(
        new DocxParagraph({
          children: [styledRun('ACTION MEMO', fp, { bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { ...SINGLE_SPACING, after: SPACING.line },
        })
      );
      break;

    case 'joint_memorandum':
      result.push(
        new DocxParagraph({
          children: [styledRun('JOINT MEMORANDUM', fp, { bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { ...SINGLE_SPACING, after: SPACING.line },
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
      children: [styledRun('DECISION:', fp, { bold: true })],
      spacing: { ...SINGLE_SPACING, before: SPACING.line, after: SPACING.half },
    }),
    new DocxParagraph({
      children: [styledRun('_____ Approved', fp)],
      spacing: { ...SINGLE_SPACING },
    }),
    new DocxParagraph({
      children: [styledRun('_____ Disapproved', fp)],
      spacing: { ...SINGLE_SPACING },
    }),
    new DocxParagraph({
      children: [styledRun('_____ Other: ________________________________', fp)],
      spacing: { ...SINGLE_SPACING, after: SPACING.line },
    }),
  ];
}

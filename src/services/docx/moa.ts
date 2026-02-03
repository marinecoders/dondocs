import {
  Paragraph as DocxParagraph,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
} from 'docx';
import type { DocumentData } from '@/types/document';
import type { FontProps } from './styles';
import { SPACING } from './styles';
import { styledRun } from './utils';

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

// MOA/MOU: Dual SSIC blocks side-by-side (2-column invisible-border Table)
export function buildMOASSICBlock(data: Partial<DocumentData>, fp: FontProps): Table[] {
  const halfWidth = convertInchesToTwip(3);

  const ssicTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      // SSIC row
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.juniorSSIC || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.seniorSSIC || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
      // Serial row
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.juniorSerial || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.seniorSerial || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
      // Date row
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.juniorDate || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.seniorDate || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
    ],
  });

  return [ssicTable];
}

// MOA/MOU centered title block
export function buildMOATitle(data: Partial<DocumentData>, docType: string, fp: FontProps): DocxParagraph[] {
  const title = docType === 'moa' ? 'MEMORANDUM OF AGREEMENT' : 'MEMORANDUM OF UNDERSTANDING';

  return [
    new DocxParagraph({
      children: [styledRun(title, fp, { bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { before: SPACING.large },
    }),
    new DocxParagraph({
      children: [styledRun('BETWEEN', fp, { bold: true })],
      alignment: AlignmentType.CENTER,
    }),
    new DocxParagraph({
      children: [styledRun(data.seniorCommandName || '', fp, { bold: true })],
      alignment: AlignmentType.CENTER,
    }),
    new DocxParagraph({
      children: [styledRun('AND', fp, { bold: true })],
      alignment: AlignmentType.CENTER,
    }),
    new DocxParagraph({
      children: [styledRun(data.juniorCommandName || '', fp, { bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: SPACING.large },
    }),
  ];
}

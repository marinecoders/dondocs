import {
  Paragraph as DocxParagraph,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
  convertInchesToTwip,
} from 'docx';
import type { DocumentData } from '@/types/document';
import type { FontProps } from './styles';
import { SINGLE_SPACING, NO_BORDERS } from './styles';
import { getDepartmentName, styledRun } from './utils';

// Resolve seal filename from sealType and letterheadColor
function getSealFilename(sealType: string | undefined, letterheadColor: string | undefined): string {
  const type = sealType || 'dow';
  const isBlack = letterheadColor === 'black';
  return isBlack ? `${type}-seal-bw.png` : `${type}-seal.png`;
}

export function buildLetterhead(
  data: Partial<DocumentData>,
  fp: FontProps,
  sealImageData?: Uint8Array
): (DocxParagraph | Table)[] {
  const result: (DocxParagraph | Table)[] = [];

  // Build the text paragraphs for the letterhead
  const textParagraphs: DocxParagraph[] = [];

  textParagraphs.push(
    new DocxParagraph({
      children: [styledRun(getDepartmentName(data.department), fp, { bold: true, allCaps: true })],
      alignment: AlignmentType.CENTER,
      spacing: { ...SINGLE_SPACING },
    })
  );

  if (data.unitLine1) {
    textParagraphs.push(
      new DocxParagraph({
        children: [styledRun(data.unitLine1.toUpperCase(), fp, { bold: true })],
        alignment: AlignmentType.CENTER,
        spacing: { ...SINGLE_SPACING },
      })
    );
  }

  if (data.unitLine2) {
    textParagraphs.push(
      new DocxParagraph({
        children: [styledRun(data.unitLine2.toUpperCase(), fp)],
        alignment: AlignmentType.CENTER,
        spacing: { ...SINGLE_SPACING },
      })
    );
  }

  if (data.unitAddress) {
    textParagraphs.push(
      new DocxParagraph({
        children: [styledRun(data.unitAddress.toUpperCase(), fp)],
        alignment: AlignmentType.CENTER,
        spacing: { ...SINGLE_SPACING },
      })
    );
  }

  // If seal image data is available, use a 2-column table layout
  if (sealImageData) {
    const sealWidth = convertInchesToTwip(0.85);
    const textWidth = convertInchesToTwip(5.65);

    const sealTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            // Seal column
            new TableCell({
              children: [
                new DocxParagraph({
                  children: [
                    new ImageRun({
                      data: sealImageData,
                      transformation: { width: 60, height: 60 },
                      type: 'png',
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                }),
              ],
              width: { size: sealWidth, type: WidthType.DXA },
              borders: NO_BORDERS,
            }),
            // Text column
            new TableCell({
              children: textParagraphs,
              width: { size: textWidth, type: WidthType.DXA },
              borders: NO_BORDERS,
            }),
          ],
        }),
      ],
    });

    result.push(sealTable);
  } else {
    // No seal — just use centered text
    result.push(...textParagraphs);
  }

  // Blank line after letterhead
  result.push(
    new DocxParagraph({
      children: [],
      spacing: { ...SINGLE_SPACING },
    })
  );

  return result;
}

export { getSealFilename };

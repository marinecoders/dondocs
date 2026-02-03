import { Paragraph as DocxParagraph, AlignmentType } from 'docx';
import type { DocumentData } from '@/types/document';
import type { FontProps } from './styles';
import { SPACING } from './styles';
import { getDepartmentName, styledRun } from './utils';

export function buildLetterhead(data: Partial<DocumentData>, fp: FontProps): DocxParagraph[] {
  const paragraphs: DocxParagraph[] = [];

  // Department name (centered, bold, all caps)
  paragraphs.push(
    new DocxParagraph({
      children: [styledRun(getDepartmentName(data.department), fp, { bold: true, allCaps: true })],
      alignment: AlignmentType.CENTER,
    })
  );

  // Unit line 1 (centered, bold)
  if (data.unitLine1) {
    paragraphs.push(
      new DocxParagraph({
        children: [styledRun(data.unitLine1.toUpperCase(), fp, { bold: true })],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  // Unit line 2 (centered)
  if (data.unitLine2) {
    paragraphs.push(
      new DocxParagraph({
        children: [styledRun(data.unitLine2.toUpperCase(), fp)],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  // Unit address (centered, extra spacing after)
  if (data.unitAddress) {
    paragraphs.push(
      new DocxParagraph({
        children: [styledRun(data.unitAddress.toUpperCase(), fp)],
        alignment: AlignmentType.CENTER,
        spacing: { after: SPACING.large },
      })
    );
  }

  return paragraphs;
}

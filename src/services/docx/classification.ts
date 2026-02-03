import {
  Paragraph as DocxParagraph,
  TextRun,
  AlignmentType,
  Header as DocxHeader,
  Footer as DocxFooter,
  PageNumber,
} from 'docx';
import type { DocumentData } from '@/types/document';
import type { FontProps } from './styles';
import { SPACING } from './styles';
import { getClassificationMarking, styledRun } from './utils';

// Build classification header/footer for the document section
export function buildClassificationHeaders(
  data: Partial<DocumentData>,
  fp: FontProps,
  pageNumbering: string
): { headers?: { default: DocxHeader }; footers?: { default: DocxFooter } } {
  const classMarking = getClassificationMarking(data.classLevel, data.customClassification);

  // Build footer children: classification marking + optional page number
  const footerChildren: DocxParagraph[] = [];

  if (classMarking) {
    footerChildren.push(
      new DocxParagraph({
        children: [styledRun(classMarking, fp, { bold: true })],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  // Page numbering in footer
  if (pageNumbering && pageNumbering !== 'none') {
    const pageNumChildren: TextRun[] = [];
    if (pageNumbering === 'x_of_y') {
      pageNumChildren.push(
        styledRun('Page ', fp),
        new TextRun({ children: [PageNumber.CURRENT], font: fp.font, size: fp.size }),
        styledRun(' of ', fp),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: fp.font, size: fp.size }),
      );
    } else {
      pageNumChildren.push(
        new TextRun({ children: [PageNumber.CURRENT], font: fp.font, size: fp.size }),
      );
    }
    footerChildren.push(
      new DocxParagraph({
        children: pageNumChildren,
        alignment: AlignmentType.CENTER,
      })
    );
  }

  const headers = classMarking
    ? {
        default: new DocxHeader({
          children: [
            new DocxParagraph({
              children: [styledRun(classMarking, fp, { bold: true })],
              alignment: AlignmentType.CENTER,
            }),
          ],
        }),
      }
    : undefined;

  const footers = footerChildren.length > 0
    ? { default: new DocxFooter({ children: footerChildren }) }
    : undefined;

  return { headers, footers };
}

// CUI info block (appears at bottom of first page)
export function buildCUIBlock(data: Partial<DocumentData>, fp: FontProps): DocxParagraph[] {
  if (data.classLevel !== 'cui') return [];

  const result: DocxParagraph[] = [];

  result.push(
    new DocxParagraph({
      children: [],
      spacing: { before: SPACING.large },
    })
  );

  const lines = [
    data.cuiControlledBy ? `Controlled By: ${data.cuiControlledBy}` : null,
    data.cuiCategory ? `CUI Category: ${data.cuiCategory}` : null,
    data.cuiDissemination ? `Distribution/Dissemination Control: ${data.cuiDissemination}` : null,
    data.pocEmail ? `POC: ${data.pocEmail}` : null,
  ].filter(Boolean) as string[];

  for (const line of lines) {
    result.push(
      new DocxParagraph({
        children: [styledRun(line, fp, { size: fp.size - 4 })], // slightly smaller
      })
    );
  }

  return result;
}

// Classified info block (appears at bottom of first page)
export function buildClassifiedBlock(data: Partial<DocumentData>, fp: FontProps): DocxParagraph[] {
  const classLevel = data.classLevel;
  if (!classLevel || classLevel === 'unclassified' || classLevel === 'cui' || classLevel === 'custom') return [];

  const result: DocxParagraph[] = [];

  result.push(
    new DocxParagraph({
      children: [],
      spacing: { before: SPACING.large },
    })
  );

  const lines = [
    data.classifiedBy ? `Classified By: ${data.classifiedBy}` : null,
    data.derivedFrom ? `Derived From: ${data.derivedFrom}` : null,
    data.declassifyOn ? `Declassify On: ${data.declassifyOn}` : null,
    data.classReason ? `Reason: ${data.classReason}` : null,
    data.classifiedPocEmail ? `POC: ${data.classifiedPocEmail}` : null,
  ].filter(Boolean) as string[];

  for (const line of lines) {
    result.push(
      new DocxParagraph({
        children: [styledRun(line, fp, { size: fp.size - 4 })],
      })
    );
  }

  return result;
}

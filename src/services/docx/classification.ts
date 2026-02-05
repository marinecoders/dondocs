import {
  Paragraph as DocxParagraph,
  TextRun,
  AlignmentType,
  Header as DocxHeader,
  Footer as DocxFooter,
  PageNumber,
  TabStopType,
} from 'docx';
import type { DocumentData } from '@/types/document';
import type { FontProps } from './styles';
import { SPACING, SINGLE_SPACING } from './styles';
import { getClassificationMarking, styledRun, wrapText } from './utils';

interface ClassificationResult {
  headers?: { first?: DocxHeader; default: DocxHeader };
  footers?: { first?: DocxFooter; default: DocxFooter };
}

// Build classification header/footer for the document section
// Includes subject line on subsequent pages per SECNAV M-5216.5
export function buildClassificationHeaders(
  data: Partial<DocumentData>,
  fp: FontProps,
  pageNumbering: string,
  opts?: { subject?: string; startingPageNumber?: number }
): ClassificationResult {
  const classMarking = getClassificationMarking(data.classLevel, data.customClassification);
  const subject = opts?.subject?.toUpperCase();
  const startPage = opts?.startingPageNumber || 1;

  // --- Default header (pages 2+): subject line + classification marking ---
  const defaultHeaderChildren: DocxParagraph[] = [];

  // Subject line on subsequent pages
  if (subject) {
    const subjLines = wrapText(subject, 57);
    subjLines.forEach((line, index) => {
      defaultHeaderChildren.push(
        new DocxParagraph({
          children: [
            styledRun(index === 0 ? 'Subj:\t' : '\t', fp),
            styledRun(line, fp),
          ],
          tabStops: [{ type: TabStopType.LEFT, position: 720 }],
          spacing: { ...SINGLE_SPACING },
        })
      );
    });
    // Blank line after subject
    defaultHeaderChildren.push(
      new DocxParagraph({ children: [], spacing: { ...SINGLE_SPACING } })
    );
  }

  if (classMarking) {
    defaultHeaderChildren.push(
      new DocxParagraph({
        children: [styledRun(classMarking, fp, { bold: true })],
        alignment: AlignmentType.CENTER,
        spacing: { ...SINGLE_SPACING },
      })
    );
  }

  // --- First page header: classification marking only (no subject) ---
  const firstHeaderChildren: DocxParagraph[] = [];
  if (classMarking) {
    firstHeaderChildren.push(
      new DocxParagraph({
        children: [styledRun(classMarking, fp, { bold: true })],
        alignment: AlignmentType.CENTER,
        spacing: { ...SINGLE_SPACING },
      })
    );
  }

  // --- Footer: classification marking + page numbers ---
  const footerChildren: DocxParagraph[] = [];

  if (classMarking) {
    footerChildren.push(
      new DocxParagraph({
        children: [styledRun(classMarking, fp, { bold: true })],
        alignment: AlignmentType.CENTER,
        spacing: { ...SINGLE_SPACING },
      })
    );
  }

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
        spacing: { ...SINGLE_SPACING },
      })
    );
  }

  // When subject is present, use distinct first-page header (titlePage mode)
  const hasSubjectOrDistinctFirst = !!subject || startPage > 1;

  const headers = (defaultHeaderChildren.length > 0 || hasSubjectOrDistinctFirst)
    ? {
        first: new DocxHeader({ children: firstHeaderChildren.length > 0 ? firstHeaderChildren : [] }),
        default: new DocxHeader({ children: defaultHeaderChildren }),
      }
    : undefined;

  // First-page footer: suppress page number when starting at page 1 (standard letters)
  // Show page number when starting at page > 1 (endorsements)
  const firstFooterChildren: DocxParagraph[] = [];
  if (classMarking) {
    firstFooterChildren.push(
      new DocxParagraph({
        children: [styledRun(classMarking, fp, { bold: true })],
        alignment: AlignmentType.CENTER,
        spacing: { ...SINGLE_SPACING },
      })
    );
  }
  if (startPage > 1 && pageNumbering && pageNumbering !== 'none') {
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
    firstFooterChildren.push(
      new DocxParagraph({
        children: pageNumChildren,
        alignment: AlignmentType.CENTER,
        spacing: { ...SINGLE_SPACING },
      })
    );
  }

  const footers = (footerChildren.length > 0 || firstFooterChildren.length > 0)
    ? {
        first: new DocxFooter({ children: firstFooterChildren }),
        default: new DocxFooter({ children: footerChildren }),
      }
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
      spacing: { ...SINGLE_SPACING, before: SPACING.line },
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
        children: [styledRun(line, fp, { size: fp.size - 4 })],
        spacing: { ...SINGLE_SPACING },
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
      spacing: { ...SINGLE_SPACING, before: SPACING.line },
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
        spacing: { ...SINGLE_SPACING },
      })
    );
  }

  return result;
}

import { Paragraph as DocxParagraph, AlignmentType } from 'docx';
import type { DocumentData } from '@/types/document';
import type { FontProps, FontType } from './styles';
import { SSIC_INDENT, SPACING, getCourierSpacing, getTimesTabStop } from './styles';
import { styledRun, wrapText } from './utils';

// Joint letter: centered header with both commands and ZIP codes
export function buildJointLetterhead(data: Partial<DocumentData>, fp: FontProps): DocxParagraph[] {
  const result: DocxParagraph[] = [];

  // Senior command
  if (data.jointSeniorName) {
    result.push(
      new DocxParagraph({
        children: [styledRun(data.jointSeniorName.toUpperCase(), fp, { bold: true })],
        alignment: AlignmentType.CENTER,
      })
    );
  }
  if (data.jointSeniorZip) {
    result.push(
      new DocxParagraph({
        children: [styledRun(data.jointSeniorZip, fp)],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  // Junior command
  if (data.jointJuniorName) {
    result.push(
      new DocxParagraph({
        children: [styledRun(data.jointJuniorName.toUpperCase(), fp, { bold: true })],
        alignment: AlignmentType.CENTER,
      })
    );
  }
  if (data.jointJuniorZip) {
    result.push(
      new DocxParagraph({
        children: [styledRun(data.jointJuniorZip, fp)],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  // Common location
  if (data.jointCommonLocation) {
    result.push(
      new DocxParagraph({
        children: [styledRun(data.jointCommonLocation, fp)],
        alignment: AlignmentType.CENTER,
        spacing: { after: SPACING.large },
      })
    );
  }

  // "JOINT LETTER" designation
  result.push(
    new DocxParagraph({
      children: [styledRun('JOINT LETTER', fp, { bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: SPACING.normal },
    })
  );

  return result;
}

// Joint letter SSIC block (uses junior command's SSIC/Serial/Date)
export function buildJointSSICBlock(data: Partial<DocumentData>, fp: FontProps): DocxParagraph[] {
  const paragraphs: DocxParagraph[] = [];

  if (data.jointJuniorSSIC) {
    paragraphs.push(
      new DocxParagraph({
        children: [styledRun(data.jointJuniorSSIC, fp)],
        indent: { left: SSIC_INDENT },
      })
    );
  }

  if (data.jointJuniorSerial) {
    paragraphs.push(
      new DocxParagraph({
        children: [styledRun(data.jointJuniorSerial, fp)],
        indent: { left: SSIC_INDENT },
      })
    );
  }

  paragraphs.push(
    new DocxParagraph({
      children: [styledRun(data.jointJuniorDate || '', fp)],
      indent: { left: SSIC_INDENT },
      spacing: { after: SPACING.large },
    })
  );

  return paragraphs;
}

// Joint letter: dual From lines
export function buildJointFromLines(data: Partial<DocumentData>, fp: FontProps, fontType: FontType): DocxParagraph[] {
  const isCourier = fontType === 'courier';
  const result: DocxParagraph[] = [];

  // Senior From
  if (data.jointSeniorFrom) {
    const lines = wrapText(data.jointSeniorFrom, 57);
    lines.forEach((line, i) => {
      result.push(
        new DocxParagraph({
          children: [
            styledRun(i === 0 ? 'From:' : '', fp),
            styledRun(isCourier ? getCourierSpacing('from') : '\t', fp),
            styledRun(line, fp),
          ],
          tabStops: isCourier ? undefined : [getTimesTabStop()],
        })
      );
    });
  }

  // Junior From (continuation)
  if (data.jointJuniorFrom) {
    const lines = wrapText(data.jointJuniorFrom, 57);
    lines.forEach((line) => {
      result.push(
        new DocxParagraph({
          children: [
            styledRun('', fp),
            styledRun(isCourier ? ' '.repeat(8) : '\t', fp),
            styledRun(line, fp),
          ],
          tabStops: isCourier ? undefined : [getTimesTabStop()],
        })
      );
    });
  }

  return result;
}

// Joint letter: To and Subject using joint-specific fields
export function buildJointToLine(data: Partial<DocumentData>, fp: FontProps, fontType: FontType): DocxParagraph[] {
  const isCourier = fontType === 'courier';
  const toLines = wrapText(data.jointTo, 57);
  if (toLines.length === 0) return [];

  const result: DocxParagraph[] = [];
  toLines.forEach((line, i) => {
    result.push(
      new DocxParagraph({
        children: [
          styledRun(i === 0 ? 'To:' : '', fp),
          styledRun(isCourier ? getCourierSpacing('to') : '\t', fp),
          styledRun(line, fp),
        ],
        tabStops: isCourier ? undefined : [getTimesTabStop()],
      })
    );
  });
  return result;
}

export function buildJointSubjectLine(data: Partial<DocumentData>, fp: FontProps, fontType: FontType): DocxParagraph[] {
  const isCourier = fontType === 'courier';
  const subjectText = (data.jointSubject || '').toUpperCase();
  const subjLines = wrapText(subjectText, 57);
  if (subjLines.length === 0) return [];

  const result: DocxParagraph[] = [];
  subjLines.forEach((line, i) => {
    const isLast = i === subjLines.length - 1;
    result.push(
      new DocxParagraph({
        children: [
          styledRun(i === 0 ? 'Subj:' : '', fp),
          styledRun(isCourier ? getCourierSpacing('subj') : '\t', fp),
          styledRun(line, fp),
        ],
        tabStops: isCourier ? undefined : [getTimesTabStop()],
        spacing: isLast ? { after: SPACING.normal } : undefined,
      })
    );
  });
  return result;
}

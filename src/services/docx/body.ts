import { Paragraph as DocxParagraph, TabStopType, AlignmentType, convertInchesToTwip, TextRun } from 'docx';
import type { Paragraph } from '@/types/document';
import type { FontProps, FontType } from './styles';
import { SPACING, SINGLE_SPACING, NAVAL_TAB_STOPS } from './styles';
import { calculateLabels, parseRichText, toTitleCase, styledRun, buildCitationRuns } from './utils';

export function buildBody(
  paragraphs: Paragraph[],
  fp: FontProps,
  opts: { numberedParagraphs: boolean; isBusinessLetter: boolean; fontType?: FontType }
): DocxParagraph[] {
  const labels = calculateLabels(paragraphs);
  const result: DocxParagraph[] = [];
  const isCourier = opts.fontType === 'courier' || fp.font === 'Courier New';

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const label = opts.numberedParagraphs ? labels[i] : '';
    const headerText = para.header?.trim();

    if (opts.isBusinessLetter && para.level === 0) {
      // Business letter: 0.5" first-line indent, no label, no tab stops
      result.push(buildBusinessParagraph(para, headerText, fp));
    } else if (isCourier) {
      // Courier: use non-breaking spaces for alignment
      result.push(buildCourierParagraph(para, label, headerText, fp));
    } else {
      // Times New Roman: use tab stops for proper SECNAV M-5216.5 alignment
      result.push(buildTimesParagraph(para, label, headerText, fp));
    }
  }

  return result;
}

// Business letter paragraph: first-line indent, no labels
function buildBusinessParagraph(
  para: Paragraph,
  headerText: string | undefined,
  fp: FontProps
): DocxParagraph {
  const children: TextRun[] = [];

  if (headerText) {
    children.push(styledRun(toTitleCase(headerText), fp, { underline: {} }));
    children.push(styledRun('.  ', fp));
    children.push(...parseRichText(para.text, fp));
  } else {
    children.push(...parseRichText(para.text, fp));
  }

  return new DocxParagraph({
    children,
    indent: { firstLine: convertInchesToTwip(0.5) },
    spacing: { ...SINGLE_SPACING, before: SPACING.line },
  });
}

// Courier paragraph: non-breaking spaces for monospace alignment
function buildCourierParagraph(
  para: Paragraph,
  label: string,
  headerText: string | undefined,
  fp: FontProps
): DocxParagraph {
  const { level } = para;
  const portionPrefix = para.portionMarking ? `(${para.portionMarking}) ` : '';

  // Non-breaking spaces for indentation: 4 per level
  const indentSpaces = '\u00A0'.repeat(level * 4);

  // Spacing after citation: 2 spaces for period-ending, 1 for parenthesis-ending
  const spacesAfterCitation = label
    ? (label.endsWith('.') ? '\u00A0\u00A0' : '\u00A0')
    : '';

  const children: TextRun[] = [];

  // Indent spaces
  if (level > 0) {
    children.push(styledRun(indentSpaces, fp));
  }

  // Citation (with underline handling for levels 4-7)
  if (label) {
    children.push(...buildCitationRuns(label, level, fp));
    children.push(styledRun(spacesAfterCitation, fp));
  }

  // Portion marking
  if (portionPrefix) {
    children.push(styledRun(portionPrefix, fp));
  }

  // Header (bold, uppercase, underlined)
  if (headerText) {
    children.push(styledRun(toTitleCase(headerText).toUpperCase() + '.', fp, { bold: true }));
    if (para.text) children.push(styledRun('\u00A0\u00A0', fp));
  }

  // Body text
  children.push(...parseRichText(para.text, fp));

  return new DocxParagraph({
    children,
    alignment: AlignmentType.LEFT,
    spacing: {
      ...SINGLE_SPACING,
      before: level === 0 ? SPACING.line : SPACING.half,
    },
  });
}

// Times New Roman paragraph: tab stops for SECNAV M-5216.5 alignment
function buildTimesParagraph(
  para: Paragraph,
  label: string,
  headerText: string | undefined,
  fp: FontProps
): DocxParagraph {
  const { level } = para;
  const spec = NAVAL_TAB_STOPS[level] || NAVAL_TAB_STOPS[0];
  const portionPrefix = para.portionMarking ? `(${para.portionMarking}) ` : '';

  const children: TextRun[] = [];

  if (level === 0) {
    // Level 0: citation at left margin, tab to text position
    if (label) {
      children.push(...buildCitationRuns(label, level, fp));
      children.push(styledRun('\t', fp));
    }
  } else {
    // Levels 1-7: tab to citation position, citation, tab to text position
    children.push(styledRun('\t', fp)); // Tab to citation position
    if (label) {
      children.push(...buildCitationRuns(label, level, fp));
      children.push(styledRun('\t', fp)); // Tab to text position
    }
  }

  // Portion marking
  if (portionPrefix) {
    children.push(styledRun(portionPrefix, fp));
  }

  // Header (title-cased, underlined, followed by ".  ")
  if (headerText) {
    children.push(styledRun(toTitleCase(headerText), fp, { underline: {} }));
    children.push(styledRun('.  ', fp));
  }

  // Body text
  children.push(...parseRichText(para.text, fp));

  // Build tab stops array
  const tabStops = level === 0
    ? [{ type: TabStopType.LEFT, position: spec.text }]
    : [
        { type: TabStopType.LEFT, position: spec.citation },
        { type: TabStopType.LEFT, position: spec.text },
      ];

  return new DocxParagraph({
    children,
    tabStops,
    alignment: AlignmentType.JUSTIFIED,
    indent: label ? { left: spec.text, hanging: spec.text } : { left: spec.text },
    spacing: {
      ...SINGLE_SPACING,
      before: level === 0 ? SPACING.line : SPACING.half,
    },
  });
}

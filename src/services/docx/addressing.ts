import { Paragraph as DocxParagraph, ExternalHyperlink } from 'docx';
import type { DocumentData, Reference, Enclosure } from '@/types/document';
import type { FontProps, FontType } from './styles';
import { SSIC_INDENT, SPACING, getCourierSpacing, getTimesTabStop, COURIER_CONTINUATION_INDENT } from './styles';
import { wrapText, styledRun } from './utils';

// SSIC / Serial / Date block (right-aligned via indent)
export function buildSSICBlock(data: Partial<DocumentData>, fp: FontProps): DocxParagraph[] {
  const paragraphs: DocxParagraph[] = [];

  if (data.ssic) {
    paragraphs.push(
      new DocxParagraph({
        children: [styledRun(data.ssic, fp)],
        indent: { left: SSIC_INDENT },
      })
    );
  }

  if (data.serial) {
    paragraphs.push(
      new DocxParagraph({
        children: [styledRun(data.serial, fp)],
        indent: { left: SSIC_INDENT },
      })
    );
  }

  paragraphs.push(
    new DocxParagraph({
      children: [styledRun(data.date || '', fp)],
      indent: { left: SSIC_INDENT },
      spacing: { after: SPACING.large },
    })
  );

  return paragraphs;
}

// In Reply Refer To line
export function buildInReplyTo(data: Partial<DocumentData>, fp: FontProps): DocxParagraph[] {
  if (!data.inReplyTo || !data.inReplyToText) return [];
  return [
    new DocxParagraph({
      children: [
        styledRun('In reply refer to:', fp),
        styledRun(' ', fp),
        styledRun(data.inReplyToText, fp),
      ],
      indent: { left: SSIC_INDENT },
    }),
  ];
}

// Helper: build a labeled line (From:, To:, Via:, Subj:, Ref:, Encl:) with wrapping
function buildLabeledLine(
  label: string,
  element: string,
  text: string | undefined,
  fp: FontProps,
  fontType: FontType,
  opts?: { isFirstEntry?: boolean; prefix?: string; maxLength?: number; spacingAfter?: number }
): DocxParagraph[] {
  const maxLen = opts?.maxLength ?? 57;
  const lines = wrapText(text, maxLen);
  if (lines.length === 0) return [];

  const isCourier = fontType === 'courier';
  const paragraphs: DocxParagraph[] = [];

  // First line with label
  const showLabel = opts?.isFirstEntry !== false;
  paragraphs.push(
    new DocxParagraph({
      children: [
        styledRun(showLabel ? label : '', fp),
        styledRun(isCourier ? getCourierSpacing(element) : '\t', fp),
        styledRun((opts?.prefix || '') + lines[0], fp),
      ],
      tabStops: isCourier ? undefined : [getTimesTabStop()],
    })
  );

  // Continuation lines
  for (let i = 1; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    paragraphs.push(
      new DocxParagraph({
        children: [
          styledRun(isCourier ? ' '.repeat(COURIER_CONTINUATION_INDENT) : '\t', fp),
          styledRun(lines[i], fp),
        ],
        tabStops: isCourier ? undefined : [getTimesTabStop()],
        spacing: isLast && opts?.spacingAfter ? { after: opts.spacingAfter } : undefined,
      })
    );
  }

  // If only one line and spacing requested
  if (lines.length === 1 && opts?.spacingAfter) {
    paragraphs[0] = new DocxParagraph({
      children: [
        styledRun(showLabel ? label : '', fp),
        styledRun(isCourier ? getCourierSpacing(element) : '\t', fp),
        styledRun((opts?.prefix || '') + lines[0], fp),
      ],
      tabStops: isCourier ? undefined : [getTimesTabStop()],
      spacing: { after: opts.spacingAfter },
    });
  }

  return paragraphs;
}

// From line
export function buildFromLine(data: Partial<DocumentData>, fp: FontProps, fontType: FontType): DocxParagraph[] {
  return buildLabeledLine('From:', 'from', data.from, fp, fontType);
}

// To line
export function buildToLine(data: Partial<DocumentData>, fp: FontProps, fontType: FontType): DocxParagraph[] {
  return buildLabeledLine('To:', 'to', data.to, fp, fontType);
}

// Via lines (multiple entries separated by newlines)
export function buildViaLines(data: Partial<DocumentData>, fp: FontProps, fontType: FontType): DocxParagraph[] {
  if (!data.via?.trim()) return [];

  const isCourier = fontType === 'courier';
  const viaEntries = data.via.split('\n').filter(v => v.trim());
  const paragraphs: DocxParagraph[] = [];

  viaEntries.forEach((via, index) => {
    const viaLines = wrapText(via, 57);
    viaLines.forEach((line, lineIndex) => {
      const isFirstLineOfEntry = lineIndex === 0;
      const isFirstEntry = index === 0;
      paragraphs.push(
        new DocxParagraph({
          children: [
            styledRun(isFirstLineOfEntry && isFirstEntry ? 'Via:' : '', fp),
            styledRun(
              isFirstLineOfEntry
                ? (isCourier ? getCourierSpacing('via') : '\t') + `(${index + 1}) `
                : (isCourier ? ' '.repeat(12) : '\t\t'),
              fp
            ),
            styledRun(line, fp),
          ],
          tabStops: isCourier ? undefined : [getTimesTabStop()],
        })
      );
    });
  });

  return paragraphs;
}

// Subject line (ALL CAPS per SECNAV M-5216.5)
export function buildSubjectLine(data: Partial<DocumentData>, fp: FontProps, fontType: FontType): DocxParagraph[] {
  const subjectText = (data.subject || '').toUpperCase();
  return buildLabeledLine('Subj:', 'subj', subjectText, fp, fontType, { spacingAfter: SPACING.normal });
}

// References section (with optional hyperlinks)
export function buildReferences(
  references: Reference[],
  fp: FontProps,
  fontType: FontType,
  includeHyperlinks: boolean = false
): DocxParagraph[] {
  if (references.length === 0) return [];

  const isCourier = fontType === 'courier';
  const paragraphs: DocxParagraph[] = [];

  references.forEach((ref, index) => {
    const refLines = wrapText(ref.title, 50);
    refLines.forEach((line, lineIndex) => {
      const isFirstLine = lineIndex === 0;
      const isFirstRef = index === 0;

      if (isFirstLine) {
        // Build the reference text, optionally as a hyperlink
        const refText = `(${ref.letter}) ${line}`;
        const hasUrl = includeHyperlinks && ref.url?.trim();

        const children = [
          styledRun(isFirstRef ? 'Ref:' : '', fp),
          styledRun(
            isCourier
              ? (isFirstRef ? getCourierSpacing('ref') : ' '.repeat(7))
              : '\t',
            fp
          ),
          ...(hasUrl
            ? [new ExternalHyperlink({
                children: [styledRun(refText, fp, { color: '0563C1', underline: {} })],
                link: ref.url!,
              })]
            : [styledRun(refText, fp)]),
        ];

        paragraphs.push(
          new DocxParagraph({
            children,
            tabStops: isCourier ? undefined : [getTimesTabStop()],
          })
        );
      } else {
        paragraphs.push(
          new DocxParagraph({
            children: [
              styledRun(isCourier ? ' '.repeat(12) : '\t\t', fp),
              styledRun(line, fp),
            ],
            tabStops: isCourier ? undefined : [getTimesTabStop()],
          })
        );
      }
    });
  });

  paragraphs.push(new DocxParagraph({ children: [], spacing: { after: SPACING.normal } }));
  return paragraphs;
}

// Enclosures section
export function buildEnclosures(enclosures: Enclosure[], fp: FontProps, fontType: FontType): DocxParagraph[] {
  if (enclosures.length === 0) return [];

  const isCourier = fontType === 'courier';
  const paragraphs: DocxParagraph[] = [];

  enclosures.forEach((encl, index) => {
    const enclLines = wrapText(encl.title, 50);
    enclLines.forEach((line, lineIndex) => {
      const isFirstLine = lineIndex === 0;
      const isFirstEncl = index === 0;

      if (isFirstLine) {
        paragraphs.push(
          new DocxParagraph({
            children: [
              styledRun(isFirstEncl ? 'Encl:' : '', fp),
              styledRun(
                isCourier
                  ? (isFirstEncl ? getCourierSpacing('encl') : ' '.repeat(7))
                  : '\t',
                fp
              ),
              styledRun(`(${index + 1}) ${line}`, fp),
            ],
            tabStops: isCourier ? undefined : [getTimesTabStop()],
          })
        );
      } else {
        paragraphs.push(
          new DocxParagraph({
            children: [
              styledRun(isCourier ? ' '.repeat(12) : '\t\t', fp),
              styledRun(line, fp),
            ],
            tabStops: isCourier ? undefined : [getTimesTabStop()],
          })
        );
      }
    });
  });

  paragraphs.push(new DocxParagraph({ children: [], spacing: { after: SPACING.large } }));
  return paragraphs;
}

// Business letter recipient address block (multi-line, left-aligned)
export function buildRecipientAddress(data: Partial<DocumentData>, fp: FontProps): DocxParagraph[] {
  if (!data.to?.trim()) return [];

  const lines = data.to.split(/\r?\n/).filter(l => l.trim());
  const paragraphs: DocxParagraph[] = [];

  lines.forEach((line, i) => {
    paragraphs.push(
      new DocxParagraph({
        children: [styledRun(line.trim(), fp)],
        spacing: i === lines.length - 1 ? { after: SPACING.normal } : undefined,
      })
    );
  });

  return paragraphs;
}

// Business letter salutation
export function buildSalutation(data: Partial<DocumentData>, fp: FontProps): DocxParagraph[] {
  const salutation = data.salutation || 'Dear Sir or Madam:';
  return [
    new DocxParagraph({
      children: [styledRun(salutation, fp)],
      spacing: { after: SPACING.normal },
    }),
  ];
}

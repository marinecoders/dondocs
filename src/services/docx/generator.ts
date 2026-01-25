import {
  Document,
  Packer,
  Paragraph as DocxParagraph,
  TextRun,
  AlignmentType,
  Header as DocxHeader,
  Footer as DocxFooter,
  TabStopType,
  convertInchesToTwip,
} from 'docx';
import type { DocumentData, Reference, Enclosure, Paragraph, CopyTo } from '@/types/document';
import { wrapSubjectLine } from '@/services/latex/escaper';

interface DocumentStore {
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
}

// Font type for spacing calculations
type FontType = 'times' | 'courier';

// SECNAV M-5216.5 spacing requirements (in spaces)
// Courier: fixed-width, use exact space counts
// Times: use tab stops for proportional alignment
const SPACING = {
  courier: {
    from: 2,   // "From:  " - 2 spaces after colon
    to: 4,     // "To:    " - 4 spaces (aligns with From text)
    via: 3,    // "Via:   " - 3 spaces
    subj: 2,   // "Subj:  " - 2 spaces
    ref: 3,    // "Ref:   " - 3 spaces
    encl: 2,   // "Encl:  " - 2 spaces
  },
  times: {
    // Tab positions in inches for Times New Roman (proportional font)
    labelTab: 0.75, // Tab stop after labels (From:/To:/etc.)
  },
};

// Get spacing string for Courier font
function getCourierSpacing(element: keyof typeof SPACING.courier): string {
  return ' '.repeat(SPACING.courier[element]);
}

// Create tab stop for Times font alignment
function getTimesTabStop(): { type: typeof TabStopType.LEFT; position: number } {
  return {
    type: TabStopType.LEFT,
    position: convertInchesToTwip(SPACING.times.labelTab),
  };
}

// Wrap text at specified character limit without breaking words
function wrapText(text: string | undefined, maxLength: number = 57): string[] {
  if (!text) return [];
  return wrapSubjectLine(text, maxLength);
}

// Parse LaTeX-style formatting to TextRun array
function parseFormattedText(text: string): TextRun[] {
  const runs: TextRun[] = [];

  // Regular expression to match LaTeX commands
  const regex = /\\(textbf|textit|underline)\{([^}]*)\}|([^\\]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      // Matched a command
      const command = match[1];
      const content = match[2];
      runs.push(
        new TextRun({
          text: content,
          bold: command === 'textbf',
          italics: command === 'textit',
          underline: command === 'underline' ? {} : undefined,
        })
      );
    } else if (match[3]) {
      // Regular text
      runs.push(new TextRun({ text: match[3] }));
    }
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text }));
  }

  return runs;
}

// Get paragraph label based on level and count
function getParagraphLabel(level: number, count: number): string {
  const patterns = [
    (n: number) => `${n}.`,
    (n: number) => `${String.fromCharCode(96 + n)}.`,
    (n: number) => `(${n})`,
    (n: number) => `(${String.fromCharCode(96 + n)})`,
  ];
  const pattern = patterns[level % 4];
  return pattern(count);
}

// Calculate labels for all paragraphs
function calculateLabels(paragraphs: Paragraph[]): string[] {
  const labels: string[] = [];
  const counters = [0, 0, 0, 0, 0, 0, 0, 0];

  for (const para of paragraphs) {
    for (let i = para.level + 1; i < 8; i++) {
      counters[i] = 0;
    }
    counters[para.level]++;
    labels.push(getParagraphLabel(para.level, counters[para.level]));
  }

  return labels;
}

// Get classification marking for header/footer
function getClassificationMarking(
  classLevel: string | undefined,
  customClassification?: string
): string | undefined {
  if (!classLevel || classLevel === 'unclassified') return undefined;

  // Handle custom classification
  if (classLevel === 'custom' && customClassification) {
    return customClassification;
  }

  const markingMap: Record<string, string> = {
    cui: 'CUI',
    confidential: 'CONFIDENTIAL',
    secret: 'SECRET',
    top_secret: 'TOP SECRET',
    top_secret_sci: 'TOP SECRET//SCI',
  };

  return markingMap[classLevel];
}

export async function generateDocx(store: DocumentStore): Promise<Uint8Array> {
  const data = store.formData;
  const labels = calculateLabels(store.paragraphs);
  const classMarking = getClassificationMarking(data.classLevel, data.customClassification);
  const fontType: FontType = (data.fontFamily as FontType) || 'courier';
  const isCourier = fontType === 'courier';

  // Build document sections
  const sections: DocxParagraph[] = [];

  // Classification header (if applicable)
  if (classMarking) {
    sections.push(
      new DocxParagraph({
        children: [
          new TextRun({
            text: classMarking,
            bold: true,
            allCaps: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    );
  }

  // Letterhead
  sections.push(
    new DocxParagraph({
      children: [
        new TextRun({
          text: getDepartmentName(data.department),
          bold: true,
          allCaps: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
    })
  );

  if (data.unitLine1) {
    sections.push(
      new DocxParagraph({
        children: [
          new TextRun({
            text: data.unitLine1.toUpperCase(),
            bold: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  if (data.unitLine2) {
    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: data.unitLine2.toUpperCase() })],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  if (data.unitAddress) {
    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: data.unitAddress.toUpperCase() })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );
  }

  // Document identification (SSIC block) - positioned at 5.5" from left margin per SECNAV
  // Using indent to push content to the right side
  const ssicIndent = convertInchesToTwip(4.5); // 4.5" from content left = 5.5" from page left

  if (data.ssic) {
    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: data.ssic })],
        indent: { left: ssicIndent },
      })
    );
  }

  if (data.serial) {
    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: data.serial })],
        indent: { left: ssicIndent },
      })
    );
  }

  sections.push(
    new DocxParagraph({
      children: [new TextRun({ text: data.date || '' })],
      indent: { left: ssicIndent },
      spacing: { after: 400 },
    })
  );

  // From line with font-specific spacing and wrapping
  const fromLines = wrapText(data.from, 57);
  if (fromLines.length > 0) {
    // First line with label
    sections.push(
      new DocxParagraph({
        children: [
          new TextRun({ text: 'From:' }),
          new TextRun({ text: isCourier ? getCourierSpacing('from') : '\t' }),
          new TextRun({ text: fromLines[0] }),
        ],
        tabStops: isCourier ? undefined : [getTimesTabStop()],
      })
    );
    // Continuation lines (indented to align with text)
    for (let i = 1; i < fromLines.length; i++) {
      sections.push(
        new DocxParagraph({
          children: [
            new TextRun({ text: isCourier ? ' '.repeat(8) : '\t' }),
            new TextRun({ text: fromLines[i] }),
          ],
          tabStops: isCourier ? undefined : [getTimesTabStop()],
        })
      );
    }
  }

  // To line with font-specific spacing and wrapping
  const toLines = wrapText(data.to, 57);
  if (toLines.length > 0) {
    // First line with label
    sections.push(
      new DocxParagraph({
        children: [
          new TextRun({ text: 'To:' }),
          new TextRun({ text: isCourier ? getCourierSpacing('to') : '\t' }),
          new TextRun({ text: toLines[0] }),
        ],
        tabStops: isCourier ? undefined : [getTimesTabStop()],
      })
    );
    // Continuation lines
    for (let i = 1; i < toLines.length; i++) {
      sections.push(
        new DocxParagraph({
          children: [
            new TextRun({ text: isCourier ? ' '.repeat(8) : '\t' }),
            new TextRun({ text: toLines[i] }),
          ],
          tabStops: isCourier ? undefined : [getTimesTabStop()],
        })
      );
    }
  }

  // Via lines (if present) with font-specific spacing
  if (data.via?.trim()) {
    const viaEntries = data.via.split('\n').filter(v => v.trim());
    viaEntries.forEach((via, index) => {
      const viaLines = wrapText(via, 57);
      viaLines.forEach((line, lineIndex) => {
        const isFirstLineOfEntry = lineIndex === 0;
        const isFirstEntry = index === 0;
        sections.push(
          new DocxParagraph({
            children: [
              new TextRun({
                text: isFirstLineOfEntry && isFirstEntry ? 'Via:' : ''
              }),
              new TextRun({
                text: isFirstLineOfEntry
                  ? (isCourier ? getCourierSpacing('via') : '\t') + `(${index + 1}) `
                  : (isCourier ? ' '.repeat(12) : '\t\t')
              }),
              new TextRun({ text: line }),
            ],
            tabStops: isCourier ? undefined : [getTimesTabStop()],
          })
        );
      });
    });
  }

  // Subject line with font-specific spacing and wrapping (ALL CAPS per SECNAV)
  const subjectText = (data.subject || '').toUpperCase();
  const subjLines = wrapText(subjectText, 57);
  if (subjLines.length > 0) {
    // First line with label
    sections.push(
      new DocxParagraph({
        children: [
          new TextRun({ text: 'Subj:' }),
          new TextRun({ text: isCourier ? getCourierSpacing('subj') : '\t' }),
          new TextRun({ text: subjLines[0] }),
        ],
        tabStops: isCourier ? undefined : [getTimesTabStop()],
      })
    );
    // Continuation lines
    for (let i = 1; i < subjLines.length; i++) {
      sections.push(
        new DocxParagraph({
          children: [
            new TextRun({ text: isCourier ? ' '.repeat(8) : '\t' }),
            new TextRun({ text: subjLines[i] }),
          ],
          tabStops: isCourier ? undefined : [getTimesTabStop()],
          spacing: i === subjLines.length - 1 ? { after: 200 } : undefined,
        })
      );
    }
    // Add spacing after subject if only one line
    if (subjLines.length === 1) {
      sections[sections.length - 1] = new DocxParagraph({
        children: [
          new TextRun({ text: 'Subj:' }),
          new TextRun({ text: isCourier ? getCourierSpacing('subj') : '\t' }),
          new TextRun({ text: subjLines[0] }),
        ],
        tabStops: isCourier ? undefined : [getTimesTabStop()],
        spacing: { after: 200 },
      });
    }
  }

  // References (if any) with font-specific spacing
  if (store.references.length > 0) {
    store.references.forEach((ref, index) => {
      const refLines = wrapText(ref.title, 50); // Shorter wrap for ref content
      refLines.forEach((line, lineIndex) => {
        const isFirstLine = lineIndex === 0;
        const isFirstRef = index === 0;

        if (isFirstLine) {
          sections.push(
            new DocxParagraph({
              children: [
                new TextRun({ text: isFirstRef ? 'Ref:' : '' }),
                new TextRun({
                  text: isCourier
                    ? (isFirstRef ? getCourierSpacing('ref') : ' '.repeat(7))
                    : '\t'
                }),
                new TextRun({ text: `(${ref.letter}) ${line}` }),
              ],
              tabStops: isCourier ? undefined : [getTimesTabStop()],
            })
          );
        } else {
          // Continuation lines for long references
          sections.push(
            new DocxParagraph({
              children: [
                new TextRun({ text: isCourier ? ' '.repeat(12) : '\t\t' }),
                new TextRun({ text: line }),
              ],
              tabStops: isCourier ? undefined : [getTimesTabStop()],
            })
          );
        }
      });
    });

    sections.push(
      new DocxParagraph({
        children: [],
        spacing: { after: 200 },
      })
    );
  }

  // Enclosures (if any) with font-specific spacing
  if (store.enclosures.length > 0) {
    store.enclosures.forEach((encl, index) => {
      const enclLines = wrapText(encl.title, 50); // Shorter wrap for encl content
      enclLines.forEach((line, lineIndex) => {
        const isFirstLine = lineIndex === 0;
        const isFirstEncl = index === 0;

        if (isFirstLine) {
          sections.push(
            new DocxParagraph({
              children: [
                new TextRun({ text: isFirstEncl ? 'Encl:' : '' }),
                new TextRun({
                  text: isCourier
                    ? (isFirstEncl ? getCourierSpacing('encl') : ' '.repeat(7))
                    : '\t'
                }),
                new TextRun({ text: `(${index + 1}) ${line}` }),
              ],
              tabStops: isCourier ? undefined : [getTimesTabStop()],
            })
          );
        } else {
          // Continuation lines for long enclosure titles
          sections.push(
            new DocxParagraph({
              children: [
                new TextRun({ text: isCourier ? ' '.repeat(12) : '\t\t' }),
                new TextRun({ text: line }),
              ],
              tabStops: isCourier ? undefined : [getTimesTabStop()],
            })
          );
        }
      });
    });

    sections.push(
      new DocxParagraph({
        children: [],
        spacing: { after: 400 },
      })
    );
  }

  // Body paragraphs
  store.paragraphs.forEach((para, idx) => {
    const indent = para.level * 720; // 0.5 inch per level in twips
    sections.push(
      new DocxParagraph({
        children: [
          new TextRun({ text: `${labels[idx]}  ` }),
          ...parseFormattedText(para.text),
        ],
        indent: { left: indent },
        spacing: { after: 200 },
      })
    );
  });

  // Signature block
  sections.push(
    new DocxParagraph({
      children: [],
      spacing: { before: 400, after: 200 },
    })
  );

  // Build signature name
  const sigName = [data.sigFirst, data.sigMiddle, data.sigLast?.toUpperCase()]
    .filter(Boolean)
    .join(' ');

  if (data.byDirection && data.byDirectionAuthority) {
    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: `By direction of ${data.byDirectionAuthority}` })],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  // Signature lines
  sections.push(
    new DocxParagraph({
      children: [],
      spacing: { before: 600 }, // Space for signature
    })
  );

  sections.push(
    new DocxParagraph({
      children: [new TextRun({ text: sigName })],
    })
  );

  if (data.sigRank) {
    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: data.sigRank })],
      })
    );
  }

  if (data.sigTitle) {
    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: data.sigTitle })],
      })
    );
  }

  // Copy-to section
  if (store.copyTos.length > 0) {
    sections.push(
      new DocxParagraph({
        children: [],
        spacing: { before: 400 },
      })
    );

    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: 'Copy to:', bold: true })],
      })
    );

    store.copyTos.forEach((ct) => {
      sections.push(
        new DocxParagraph({
          children: [new TextRun({ text: ct.text })],
          indent: { left: 720 },
        })
      );
    });
  }

  // Classification footer (if applicable)
  if (classMarking) {
    sections.push(
      new DocxParagraph({
        children: [],
        spacing: { before: 400 },
      })
    );
    sections.push(
      new DocxParagraph({
        children: [
          new TextRun({
            text: classMarking,
            bold: true,
            allCaps: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  // Create document
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch in twips
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        headers: classMarking
          ? {
              default: new DocxHeader({
                children: [
                  new DocxParagraph({
                    children: [
                      new TextRun({
                        text: classMarking,
                        bold: true,
                      }),
                    ],
                    alignment: AlignmentType.CENTER,
                  }),
                ],
              }),
            }
          : undefined,
        footers: classMarking
          ? {
              default: new DocxFooter({
                children: [
                  new DocxParagraph({
                    children: [
                      new TextRun({
                        text: classMarking,
                        bold: true,
                      }),
                    ],
                    alignment: AlignmentType.CENTER,
                  }),
                ],
              }),
            }
          : undefined,
        children: sections,
      },
    ],
  });

  // Generate and return the document as Uint8Array
  // Use toBlob() for browser compatibility (toBuffer() is Node.js only)
  const blob = await Packer.toBlob(doc);
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

function getDepartmentName(dept: string | undefined): string {
  switch (dept) {
    case 'usmc':
      return 'UNITED STATES MARINE CORPS';
    case 'navy':
      return 'DEPARTMENT OF THE NAVY';
    case 'dod':
      return 'DEPARTMENT OF DEFENSE';
    default:
      return 'UNITED STATES MARINE CORPS';
  }
}

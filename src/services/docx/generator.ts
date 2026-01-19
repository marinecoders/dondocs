import {
  Document,
  Packer,
  Paragraph as DocxParagraph,
  TextRun,
  AlignmentType,
  Header as DocxHeader,
  Footer as DocxFooter,
} from 'docx';
import type { DocumentData, Reference, Enclosure, Paragraph, CopyTo } from '@/types/document';

interface DocumentStore {
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
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

  // Document identification (right-aligned block)
  sections.push(
    new DocxParagraph({
      children: [new TextRun({ text: `${data.ssic || '5216'}` })],
      alignment: AlignmentType.RIGHT,
    })
  );

  if (data.serial) {
    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: data.serial })],
        alignment: AlignmentType.RIGHT,
      })
    );
  }

  sections.push(
    new DocxParagraph({
      children: [new TextRun({ text: data.date || '' })],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 400 },
    })
  );

  // From line
  sections.push(
    new DocxParagraph({
      children: [
        new TextRun({ text: 'From:\t', bold: true }),
        new TextRun({ text: data.from || '' }),
      ],
    })
  );

  // To line
  sections.push(
    new DocxParagraph({
      children: [
        new TextRun({ text: 'To:\t', bold: true }),
        new TextRun({ text: data.to || '' }),
      ],
    })
  );

  // Via line (if present)
  if (data.via?.trim()) {
    sections.push(
      new DocxParagraph({
        children: [
          new TextRun({ text: 'Via:\t', bold: true }),
          new TextRun({ text: data.via }),
        ],
      })
    );
  }

  // Subject line
  sections.push(
    new DocxParagraph({
      children: [
        new TextRun({ text: 'Subj:\t', bold: true }),
        new TextRun({ text: data.subject || '', bold: true }),
      ],
      spacing: { after: 200 },
    })
  );

  // References (if any)
  if (store.references.length > 0) {
    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: 'Ref:', bold: true })],
      })
    );

    store.references.forEach((ref) => {
      sections.push(
        new DocxParagraph({
          children: [new TextRun({ text: `\t(${ref.letter}) ${ref.title}` })],
        })
      );
    });

    sections.push(
      new DocxParagraph({
        children: [],
        spacing: { after: 200 },
      })
    );
  }

  // Enclosures (if any)
  if (store.enclosures.length > 0) {
    sections.push(
      new DocxParagraph({
        children: [new TextRun({ text: 'Encl:', bold: true })],
      })
    );

    store.enclosures.forEach((encl, idx) => {
      sections.push(
        new DocxParagraph({
          children: [new TextRun({ text: `\t(${idx + 1}) ${encl.title}` })],
        })
      );
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

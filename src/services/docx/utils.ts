import { TextRun } from 'docx';
import type { Paragraph } from '@/types/document';
import { wrapSubjectLine } from '@/services/latex/escaper';
import type { FontProps } from './styles';

// Wrap text at specified character limit without breaking words
export function wrapText(text: string | undefined, maxLength: number = 57): string[] {
  if (!text) return [];
  return wrapSubjectLine(text, maxLength);
}

// Parse LaTeX-style formatting to TextRun array with font properties applied
export function parseFormattedText(text: string, fp: FontProps): TextRun[] {
  const runs: TextRun[] = [];

  // Match LaTeX commands or plain text segments
  const regex = /\\(textbf|textit|underline)\{([^}]*)\}|([^\\]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      const command = match[1];
      const content = match[2];
      runs.push(
        new TextRun({
          text: content,
          font: fp.font,
          size: fp.size,
          bold: command === 'textbf',
          italics: command === 'textit',
          underline: command === 'underline' ? {} : undefined,
        })
      );
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], font: fp.font, size: fp.size }));
    }
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: fp.font, size: fp.size }));
  }

  return runs;
}

// Convert rich text markers (markdown-like) to formatted text
// **bold**, *italic*, __underline__
export function parseRichText(text: string, fp: FontProps): TextRun[] {
  const runs: TextRun[] = [];
  // Process segments: split on formatting markers
  const regex = /\*\*(.+?)\*\*|(?<!\*)\*([^*]+)\*(?!\*)|__(.+?)__|([^*_]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      // Bold
      runs.push(new TextRun({ text: match[1], font: fp.font, size: fp.size, bold: true }));
    } else if (match[2]) {
      // Italic
      runs.push(new TextRun({ text: match[2], font: fp.font, size: fp.size, italics: true }));
    } else if (match[3]) {
      // Underline
      runs.push(new TextRun({ text: match[3], font: fp.font, size: fp.size, underline: {} }));
    } else if (match[4]) {
      // Plain text
      runs.push(new TextRun({ text: match[4], font: fp.font, size: fp.size }));
    }
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: fp.font, size: fp.size }));
  }

  return runs;
}

// Get paragraph label based on level and count (8-level numbering)
export function getParagraphLabel(level: number, count: number): string {
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
export function calculateLabels(paragraphs: Paragraph[]): string[] {
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

// Build citation TextRuns with SECNAV M-5216.5 level 4-7 underline handling
// Levels 0-3: plain text citation
// Levels 4-7: underline the number/letter only, NOT the punctuation
export function buildCitationRuns(label: string, level: number, fp: FontProps): TextRun[] {
  if (level < 4) {
    return [new TextRun({ text: label, font: fp.font, size: fp.size })];
  }

  // Levels 4-7 use underlined numbers/letters per SECNAV M-5216.5
  if (label.startsWith('(')) {
    // Parenthesized: "(1)" or "(a)" — underline only the inner character
    const inner = label.replace(/[()]/g, '');
    return [
      new TextRun({ text: '(', font: fp.font, size: fp.size }),
      new TextRun({ text: inner, font: fp.font, size: fp.size, underline: {} }),
      new TextRun({ text: ')', font: fp.font, size: fp.size }),
    ];
  }

  // Dotted: "1." or "a." — underline the number/letter, not the period
  const numberOrLetter = label.slice(0, -1);
  return [
    new TextRun({ text: numberOrLetter, font: fp.font, size: fp.size, underline: {} }),
    new TextRun({ text: '.', font: fp.font, size: fp.size }),
  ];
}

// Get classification marking text for header/footer
export function getClassificationMarking(
  classLevel: string | undefined,
  customClassification?: string
): string | undefined {
  if (!classLevel || classLevel === 'unclassified') return undefined;

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

// Convert header to Title Case per SECNAV M-5216.5 Ch 7 Para 13d
export function toTitleCase(str: string): string {
  const lowercaseWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet'];
  return str.split(' ').map((word, index) => {
    const lower = word.toLowerCase();
    if (index === 0 || !lowercaseWords.includes(lower)) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    return lower;
  }).join(' ');
}

// Capitalize first letter of each word (for names)
export function capitalizeWord(word: string | undefined): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Build abbreviated name: "J. M. LASTNAME"
export function abbreviateName(first: string | undefined, middle: string | undefined, last: string | undefined): string {
  const parts: string[] = [];
  if (first) parts.push(`${first[0].toUpperCase()}.`);
  if (middle) parts.push(`${middle[0].toUpperCase()}.`);
  if (last) parts.push(last.toUpperCase());
  return parts.join(' ');
}

// Build full name: "John Michael LASTNAME"
export function buildFullName(first: string | undefined, middle: string | undefined, last: string | undefined): string {
  return [
    capitalizeWord(first),
    capitalizeWord(middle),
    last?.toUpperCase() || '',
  ].filter(Boolean).join(' ');
}

// Department name lookup
export function getDepartmentName(dept: string | undefined): string {
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

// Create a styled TextRun with font props
export function styledRun(text: string, fp: FontProps, overrides?: Record<string, unknown>): TextRun {
  return new TextRun({
    text,
    font: fp.font,
    size: fp.size,
    ...overrides,
  } as ConstructorParameters<typeof TextRun>[0]);
}

// Convert base64 to Uint8Array (for signature images)
export function base64ToUint8Array(base64: string): Uint8Array {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch {
    console.warn('Invalid base64 string for signature image');
    return new Uint8Array(0);
  }
}

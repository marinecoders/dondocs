import { convertInchesToTwip, TabStopType } from 'docx';

// Font type for spacing calculations
export type FontType = 'times' | 'courier';

// Font properties for TextRun objects
export interface FontProps {
  font: string;
  size: number; // half-points (24 = 12pt)
}

export function getFontProps(fontType: FontType, fontSize: string = '12pt'): FontProps {
  const sizeMap: Record<string, number> = {
    '10pt': 20,
    '11pt': 22,
    '12pt': 24,
  };
  return {
    font: fontType === 'courier' ? 'Courier New' : 'Times New Roman',
    size: sizeMap[fontSize] || 24,
  };
}

// Page margins in twips (1440 twips = 1 inch)
export const PAGE_MARGINS = {
  top: 1440,
  right: 1440,
  bottom: 1440,
  left: 1440,
} as const;

// SSIC block indent (pushed to 5.5" from left edge = 4.5" from content left)
export const SSIC_INDENT = convertInchesToTwip(4.5);

// Paragraph spacing in twips
export const SPACING = {
  none: 0,
  small: 120,     // ~6pt
  normal: 200,    // ~10pt
  large: 400,     // ~20pt
  sigGap: 600,    // space for handwritten signature
  lineSpacing: 240, // single line spacing (12pt)
} as const;

// Per-level indent for subparagraphs (0.25" per level for standard, 0.5" for business)
export function getIndentTwips(level: number, isBusinessLetter: boolean): number {
  const perLevel = isBusinessLetter ? 720 : 360; // 0.5" or 0.25"
  return level * perLevel;
}

// SECNAV M-5216.5 spacing requirements for label alignment
// Courier: fixed-width, use exact space counts
// Times: use tab stops for proportional alignment
export const COURIER_LABEL_SPACING: Record<string, number> = {
  from: 2,   // "From:  " - 2 spaces after colon
  to: 4,     // "To:    " - 4 spaces (aligns with From text)
  via: 3,    // "Via:   " - 3 spaces
  subj: 2,   // "Subj:  " - 2 spaces
  ref: 3,    // "Ref:   " - 3 spaces
  encl: 2,   // "Encl:  " - 2 spaces
};

// Tab position for Times label alignment
export const TIMES_LABEL_TAB = convertInchesToTwip(0.75);

export function getCourierSpacing(element: string): string {
  return ' '.repeat(COURIER_LABEL_SPACING[element] || 2);
}

export function getTimesTabStop() {
  return {
    type: TabStopType.LEFT,
    position: TIMES_LABEL_TAB,
  };
}

// Continuation line indent (aligns with text after label)
export const COURIER_CONTINUATION_INDENT = 8; // spaces

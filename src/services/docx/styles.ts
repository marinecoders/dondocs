import { convertInchesToTwip, TabStopType, LineRuleType, BorderStyle } from 'docx';

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

// Single-line spacing for all paragraphs (prevents Word's default 1.15 line spacing)
// 240 twips = exactly 12pt = single spaced at 12pt font
export const SINGLE_SPACING = {
  line: 240,
  lineRule: LineRuleType.EXACT,
} as const;

// Paragraph spacing in twips — matched to LaTeX \vspace{} values
export const SPACING = {
  none: 0,
  line: 240,      // 12pt — one blank line (matches \vspace{12pt})
  half: 120,      // 6pt — half line (matches \vspace{6pt})
  sigGap: 480,    // ~4 lines for handwritten signature space
} as const;

// Per-level indent for subparagraphs (0.25" per level for standard, 0.5" for business)
export function getIndentTwips(level: number, isBusinessLetter: boolean): number {
  const perLevel = isBusinessLetter ? 720 : 360; // 0.5" or 0.25"
  return level * perLevel;
}

// SECNAV M-5216.5 paragraph tab stops per nesting level (0-based)
// citation = where the label sits, text = where paragraph text begins
// Each level is offset by 0.25" (360 twips)
export const NAVAL_TAB_STOPS: Record<number, { citation: number; text: number }> = {
  0: { citation: 0,    text: 360 },   // "1." at 0",     text at 0.25"
  1: { citation: 360,  text: 720 },   // "a." at 0.25",  text at 0.5"
  2: { citation: 720,  text: 1080 },  // "(1)" at 0.5",  text at 0.75"
  3: { citation: 1080, text: 1440 },  // "(a)" at 0.75", text at 1.0"
  4: { citation: 1440, text: 1800 },  // "1." at 1.0",   text at 1.25"
  5: { citation: 1800, text: 2160 },  // "a." at 1.25",  text at 1.5"
  6: { citation: 2160, text: 2520 },  // "(1)" at 1.5",  text at 1.75"
  7: { citation: 2520, text: 2880 },  // "(a)" at 1.75", text at 2.0"
};

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

// Invisible table borders (reused across letterhead, signature, MOA modules)
export const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
} as const;

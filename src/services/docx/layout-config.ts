/**
 * SECNAV M-5216.5 Layout Configuration
 *
 * Single source of truth for all layout proportions used in the
 * flat-LaTeX → pandoc WASM → DOCX pipeline.
 *
 * All proportions are fractions of the 6.5in text width
 * (8.5in letter page − 2 × 1in margins).
 *
 * Consumed by:
 *   flat-generator.ts   → builds LaTeX table column widths
 *   pandoc-converter.ts → passes proportions as pandoc metadata
 *   dondocs.lua         → reads metadata, sets DOCX table column widths
 */

export const TEXT_WIDTH_IN = 6.5;

export interface LayoutProportions {
  /** 3-col letterhead: seal | centered org text | right spacer */
  letterhead: { sealCol: number; centerCol: number; spacerCol: number };
  /** 2-col SSIC block: left spacer | right-aligned content */
  ssic: { leftCol: number; rightCol: number };
  /** 2-col address block: label (From:/To:/Subj:) | content */
  address: { labelCol: number; contentCol: number };
  /** 2-col copy-to block: label (Copy to:) | content — wider label than address */
  copyTo: { labelCol: number; contentCol: number };
  /** 2-col signature: left spacer | signature content */
  signature: { leftCol: number; rightCol: number };
  /** 2-col dual signature: junior | senior */
  dualSignature: { leftCol: number; rightCol: number };
}

const SEAL_COL_IN = 1.25; // 1in seal + 0.25in padding
const SIG_INDENT_IN = 3.25; // SECNAV spec signature indent
const COPYTO_LABEL_IN = 0.66; // Copy to: label + gap (tighter, matches PDF auto-fit)

/**
 * Width of the widest address label, as a multiple of the point size.
 *
 * The PDF sets this column as `l`, so it fits whichever of "From:", "To:",
 * "Via:" and "Subj:" is widest once its padding spaces are counted (2, 6, 5
 * and 3). Word's column is fixed, so the width is worked out here — and it
 * cannot be a single number: Times pads the four to about the same width,
 * while Courier is monospaced at 0.6em, which puts "To:" and its six spaces at
 * nearly twice that.
 *
 * From the font metrics, per em: in Times "From:" is 2.5 plus two spaces at
 * 0.25, so 3.0 exactly — which at 12pt is 36pt, the full half inch the column
 * used to be, with nothing left over. In Courier every glyph and space is 0.6,
 * so "To:" with six spaces is 5.4.
 */
const LABEL_WIDTH_PER_PT: Record<string, number> = {
  times: 3.0,
  courier: 5.4,
};

/** Slack, so rounding cannot push a label onto a second line in its own cell. */
const LABEL_SLACK_PT = 2;

/** The address label column, as a fraction of the text width. */
export function addressLabelFraction(fontFamily?: string, fontSizePt = 12): number {
  const perPt = LABEL_WIDTH_PER_PT[fontFamily ?? 'times'] ?? LABEL_WIDTH_PER_PT.times;
  return (perPt * fontSizePt + LABEL_SLACK_PT) / 72 / TEXT_WIDTH_IN;
}

export const LAYOUT: LayoutProportions = {
  letterhead: {
    sealCol: SEAL_COL_IN / TEXT_WIDTH_IN,
    centerCol: 1 - 2 * (SEAL_COL_IN / TEXT_WIDTH_IN),
    spacerCol: SEAL_COL_IN / TEXT_WIDTH_IN,
  },
  ssic: {
    leftCol: 0.75,
    rightCol: 0.25,
  },
  address: {
    labelCol: addressLabelFraction(),
    contentCol: 1 - addressLabelFraction(),
  },
  copyTo: {
    labelCol: COPYTO_LABEL_IN / TEXT_WIDTH_IN,
    contentCol: 1 - COPYTO_LABEL_IN / TEXT_WIDTH_IN,
  },
  signature: {
    leftCol: SIG_INDENT_IN / TEXT_WIDTH_IN,
    rightCol: 1 - SIG_INDENT_IN / TEXT_WIDTH_IN,
  },
  dualSignature: {
    leftCol: 0.50,
    rightCol: 0.50,
  },
};

/**
 * Convert layout proportions to a flat metadata object for pandoc.
 * Keys use kebab-case to match pandoc metadata conventions.
 * Values are stringified numbers (pandoc metadata is always strings).
 */
export function layoutToMetadata(
  layout: LayoutProportions = LAYOUT,
  font?: { family?: string; sizePt?: number },
): Record<string, string> {
  // Sized to the chosen face when one is known; the stored proportion is the
  // Times fallback for callers that have no font to hand.
  const addrLabel = font ? addressLabelFraction(font.family, font.sizePt) : layout.address.labelCol;
  return {
    'lh-seal': layout.letterhead.sealCol.toFixed(3),
    'lh-center': layout.letterhead.centerCol.toFixed(3),
    'lh-spacer': layout.letterhead.spacerCol.toFixed(3),
    'ssic-left': layout.ssic.leftCol.toFixed(3),
    'ssic-right': layout.ssic.rightCol.toFixed(3),
    'addr-label': addrLabel.toFixed(3),
    'addr-content': (1 - addrLabel).toFixed(3),
    'copyto-label': layout.copyTo.labelCol.toFixed(3),
    'copyto-content': layout.copyTo.contentCol.toFixed(3),
    'sig-left': layout.signature.leftCol.toFixed(3),
    'sig-right': layout.signature.rightCol.toFixed(3),
    'dual-sig-left': layout.dualSignature.leftCol.toFixed(3),
    'dual-sig-right': layout.dualSignature.rightCol.toFixed(3),
  };
}

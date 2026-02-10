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
const ADDR_LABEL_IN = 0.50; // From:/To:/Subj: label + gap (tighter, matches PDF auto-fit)
const COPYTO_LABEL_IN = 0.66; // Copy to: label + gap (tighter, matches PDF auto-fit)

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
    labelCol: ADDR_LABEL_IN / TEXT_WIDTH_IN,
    contentCol: 1 - ADDR_LABEL_IN / TEXT_WIDTH_IN,
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
export function layoutToMetadata(layout: LayoutProportions = LAYOUT): Record<string, string> {
  return {
    'lh-seal': layout.letterhead.sealCol.toFixed(3),
    'lh-center': layout.letterhead.centerCol.toFixed(3),
    'lh-spacer': layout.letterhead.spacerCol.toFixed(3),
    'ssic-left': layout.ssic.leftCol.toFixed(3),
    'ssic-right': layout.ssic.rightCol.toFixed(3),
    'addr-label': layout.address.labelCol.toFixed(3),
    'addr-content': layout.address.contentCol.toFixed(3),
    'copyto-label': layout.copyTo.labelCol.toFixed(3),
    'copyto-content': layout.copyTo.contentCol.toFixed(3),
    'sig-left': layout.signature.leftCol.toFixed(3),
    'sig-right': layout.signature.rightCol.toFixed(3),
    'dual-sig-left': layout.dualSignature.leftCol.toFixed(3),
    'dual-sig-right': layout.dualSignature.rightCol.toFixed(3),
  };
}

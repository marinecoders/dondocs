/**
 * Shared signature model for the NAVMC forms (NAVMC 10274 and 118(11)).
 *
 * Both forms render through pdf-lib and place a signer's block the same way: an
 * optional statement above a signing gap, the typed name below it, and — per
 * the chosen style — a scanned signature image drawn into the gap or an empty
 * CAC-signable AcroForm field placed there. Keeping one shape (and one set of
 * pdf-lib primitives) for both forms stops the two from drifting apart.
 *
 * The naval letter renders through LaTeX, a different engine, so it keeps its
 * own `SignatureType`/`signatureImage` fields — but speaks the same vocabulary:
 * `SignatureStyle` here mirrors the letter's `'typed' | 'image' | 'digital'`
 * choice (the letter historically spells "typed" as `'none'`).
 */

export type SignatureStyle = 'typed' | 'image' | 'digital';

export interface FormSignatureBlock {
  /** Typed name printed on the signing line (initials + SURNAME). */
  name: string;
  /** Optional statement printed above the signing space ("Acknowledged:"). */
  statement: string;
  /**
   * How the signature is produced. Defaults to `'typed'` (name only).
   * `'image'` draws `image` into the signing gap; `'digital'` places an empty
   * CAC-signable AcroForm field there for signing later in Acrobat.
   */
  style?: SignatureStyle;
  /** Base64 data URL of the scanned signature, used only when style === 'image'. */
  image?: string;
}

/** True when a block wants a digital (CAC) AcroForm field placed in its gap. */
export function isDigital(block: { style?: SignatureStyle }): boolean {
  return block.style === 'digital';
}

/** True when a block wants a scanned image drawn in its gap. */
export function isImage(block: { style?: SignatureStyle; image?: string }): boolean {
  return block.style === 'image' && !!block.image;
}

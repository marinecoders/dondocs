/**
 * The four I-Type flavours. They share one skeleton and differ in the type
 * name the cover and authentication page carry, and in whether completion is
 * recorded -- that applies to modifications alone.
 */

export type PublicationTypeCode = 'MI' | 'SI' | 'TI' | 'LI';

export const PUBLICATION_TYPES: Record<PublicationTypeCode, string> = {
  MI: 'Modification Instruction',
  SI: 'Supply Instruction',
  TI: 'Technical Instruction',
  LI: 'Lubrication Instruction',
};

export const publicationTypeName = (code: string | undefined): string =>
  PUBLICATION_TYPES[code as PublicationTypeCode] ?? PUBLICATION_TYPES.MI;

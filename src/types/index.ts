/**
 * Types barrel export
 *
 * Central export point for all TypeScript types.
 * Import from '@/types' instead of individual files.
 */

// Document types
export type {
  DocumentMode,
  Reference,
  Enclosure,
  EnclosurePageStyle,
  Paragraph,
  CopyTo,
  DocumentData,
  Profile,
  SignatureImage,
  SignatureType,
  PortionMarking,
  DocTypeConfig,
} from './document';

// Document type configuration
export {
  DOC_TYPE_CONFIG,
  DOC_TYPE_LABELS,
  DOC_TYPE_CATEGORIES,
} from './document';

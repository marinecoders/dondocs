/**
 * Services barrel export
 *
 * Central export point for all document generation services.
 * Import from '@/services' instead of individual files.
 */

// LaTeX generation
export {
  generateDocumentTex,
  generateLetterheadTex,
  generateSignatoryTex,
  generateFlagsTex,
  generateReferencesTex,
  generateReferenceUrlsTex,
  generateEnclosuresTex,
  generateCopyToTex,
  generateBodyTex,
  generateClassificationTex,
} from './latex/generator';

export {
  escapeLatex,
  escapeLatexUrl,
  convertRichTextToLatex,
  highlightPlaceholders,
  processBodyText,
} from './latex/escaper';

// PDF processing
export {
  addSignatureField,
  addDualSignatureFields,
  type SignatureFieldConfig,
} from './pdf/addSignatureField';

export {
  mergeEnclosures,
  type EnclosureData,
  type ReferenceUrlData,
  type ClassificationInfo,
} from './pdf/mergeEnclosures';

// PII detection
export {
  detectPII,
  getPIITypeLabel,
  getPIITypeSeverity,
  type PIIType,
  type PIIFinding,
  type PIIDetectionResult,
} from './pii/detector';

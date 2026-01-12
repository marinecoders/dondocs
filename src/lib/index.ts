/**
 * Lib barrel export
 *
 * Central export point for all utility libraries.
 * Import from '@/lib' instead of individual files.
 */

// Constants
export {
  TIMING,
  PARAGRAPH,
  CLASSIFICATION,
  DOC_TYPES,
  FILE_LIMITS,
  FILE_TYPES,
  LATEX,
  ERROR_CODES,
  type ClassificationLevel,
  type DocType,
} from './constants';

// Debug utilities
export { debug } from './debug';

// Encoding utilities
export {
  base64ToUint8Array,
  uint8ArrayToBase64,
  arrayBufferToUint8Array,
  blobToUint8Array,
  uint8ArrayToBlob,
  readFileAsArrayBuffer,
  readFileAsText,
  readFileAsDataURL,
  extractBase64FromDataURL,
  triggerDownload,
} from './encoding';

// Paragraph utilities
export {
  getParagraphLabel,
  calculateLabels,
  countWords,
  countTotalWords,
  getIndentString,
  formatParagraphAsText,
  paragraphsToPlainText,
  getMaxDepth,
  isValidLevel,
  type ParagraphLike,
} from './paragraphUtils';

// General utilities
export { cn } from './utils';

/**
 * Application Constants for DONDOCS
 *
 * Centralizes all magic numbers, timing values, and configuration constants.
 * Update values here instead of scattered throughout the codebase.
 */

/**
 * Timing constants (in milliseconds)
 */
export const TIMING = {
  // Engine initialization
  ENGINE_SCRIPT_LOAD_WAIT: 100,
  ENGINE_PRELOAD_WAIT: 2000, // Increased for slower browsers (iPad/iOS Chrome)

  // Compilation
  COMPILE_DEBOUNCE: 1500,
  COMPILE_RETRY_DELAY: 500,

  // UI feedback
  STATUS_MESSAGE_DURATION: 2000,
  SAVE_INDICATOR_DURATION: 2000,

  // Downloads
  BATCH_DOWNLOAD_DELAY: 200,
  URL_REVOKE_DELAY: 100,

  // Auto-save
  HISTORY_SNAPSHOT_DEBOUNCE: 500,
} as const;

/**
 * Paragraph structure constants
 */
export const PARAGRAPH = {
  MAX_DEPTH: 7,
  DEFAULT_LEVEL: 0,
  LABEL_FORMATS: ['1', 'a', '(1)', '(a)', '1)', 'a)', '(1)'] as const,
} as const;

/**
 * Classification levels and their display properties
 */
export const CLASSIFICATION = {
  UNCLASSIFIED: {
    label: 'UNCLASSIFIED',
    color: 'bg-green-600',
    textColor: 'text-white',
    bannerText: 'UNCLASSIFIED',
  },
  CUI: {
    label: 'CUI',
    color: 'bg-purple-700',
    textColor: 'text-white',
    bannerText: 'CUI',
  },
  CONFIDENTIAL: {
    label: 'CONFIDENTIAL',
    color: 'bg-blue-600',
    textColor: 'text-white',
    bannerText: 'CONFIDENTIAL',
  },
  SECRET: {
    label: 'SECRET',
    color: 'bg-red-600',
    textColor: 'text-white',
    bannerText: 'SECRET',
  },
  TOP_SECRET: {
    label: 'TOP SECRET',
    color: 'bg-orange-500',
    textColor: 'text-black',
    bannerText: 'TOP SECRET',
  },
} as const;

export type ClassificationLevel = keyof typeof CLASSIFICATION;

/**
 * Document type configurations
 */
export const DOC_TYPES = {
  naval_letter: {
    label: 'Naval Letter',
    description: 'Standard naval correspondence',
    hasLetterhead: true,
    hasSignatureBlock: true,
  },
  nav1070_613: {
    label: 'NAV 1070-613',
    description: 'Administrative remarks',
    hasLetterhead: true,
    hasSignatureBlock: true,
  },
  memorandum: {
    label: 'Memorandum',
    description: 'Internal memo format',
    hasLetterhead: true,
    hasSignatureBlock: true,
  },
  'nsn-7530-00-927-9525': {
    label: 'Business Letter (7530-00-927-9525)',
    description: 'Official business correspondence',
    hasLetterhead: true,
    hasSignatureBlock: true,
  },
  '11a': {
    label: '11A',
    description: 'Performance evaluation',
    hasLetterhead: true,
    hasSignatureBlock: true,
  },
  endorsement_letter: {
    label: 'Endorsement Letter',
    description: 'Letter with endorsements',
    hasLetterhead: true,
    hasSignatureBlock: true,
  },
} as const;

export type DocType = keyof typeof DOC_TYPES;

/**
 * File size limits
 */
export const FILE_LIMITS = {
  MAX_ENCLOSURE_SIZE_MB: 10,
  MAX_SIGNATURE_SIZE_MB: 2,
  MAX_BATCH_ROWS: 100,
  MAX_TOTAL_ENCLOSURE_SIZE_MB: 50,
} as const;

/**
 * Supported file types
 */
export const FILE_TYPES = {
  PDF: ['application/pdf'],
  IMAGE: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  EXCEL: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ],
  JSON: ['application/json'],
} as const;

/**
 * LaTeX engine constants
 */
export const LATEX = {
  MAIN_FILE: 'main.tex',
  TEXLIVE_FORMATS: {
    TEXT: 0, // .cls, .sty, .cfg
    VF: 2, // Virtual fonts
    TFM: 3, // Font metrics
    TYPE1: 4, // PostScript fonts
    CONFIG: 10,
    MAP: 11,
    DEF: 32,
    CLO: 39,
  },
  SEAL_FILES: ['dod-seal.png', 'dow-seal.png', 'dod-seal-bw.png', 'dow-seal-bw.png'],
  MEMFS_DIRECTORIES: ['formats', 'attachments', 'enclosures', 'templates'],
} as const;

/**
 * Error codes for better error handling
 */
export const ERROR_CODES = {
  // Engine errors
  ENGINE_NOT_READY: 'ENGINE_NOT_READY',
  ENGINE_LOAD_FAILED: 'ENGINE_LOAD_FAILED',
  ENGINE_RESET_NEEDED: 'ENGINE_RESET_NEEDED',

  // Compilation errors
  COMPILE_FAILED: 'COMPILE_FAILED',
  COMPILE_TIMEOUT: 'COMPILE_TIMEOUT',
  LATEX_SYNTAX_ERROR: 'LATEX_SYNTAX_ERROR',

  // File errors
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_INVALID_TYPE: 'FILE_INVALID_TYPE',
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',

  // PDF errors
  PDF_INVALID: 'PDF_INVALID',
  PDF_MERGE_FAILED: 'PDF_MERGE_FAILED',
  PDF_CORRUPTED: 'PDF_CORRUPTED',

  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  SCRIPT_LOAD_ERROR: 'SCRIPT_LOAD_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Local storage keys
 */
export const STORAGE_KEYS = {
  DEBUG: 'DONDOCS_DEBUG',
  PROFILES: 'dondocs-profiles',
  SELECTED_PROFILE: 'dondocs-selected-profile',
  THEME: 'dondocs-theme',
  LAST_DOC_TYPE: 'dondocs-last-doc-type',
} as const;

/**
 * Keyboard shortcuts
 */
export const SHORTCUTS = {
  TOGGLE_DEBUG: { key: 'D', ctrl: true, shift: true },
  SAVE: { key: 's', ctrl: true },
  COMPILE: { key: 'Enter', ctrl: true },
  UNDO: { key: 'z', ctrl: true },
  REDO: { key: 'y', ctrl: true },
} as const;

/**
 * Application info
 */
export const APP_INFO = {
  NAME: 'DONDOCS',
  FULL_NAME: 'DoN Correspondence Generator',
  VERSION: '1.0.0',
  GITHUB_URL: 'https://github.com/marinecoders/dondocs',
} as const;

/**
 * Batch generation placeholder variables
 * Just 2 examples to get started - users can create custom variables by typing @ANYTHING
 */
export const BATCH_PLACEHOLDERS = [
  { name: 'NAME', label: 'Name', category: 'Examples', example: 'John Smith' },
  { name: 'DATE', label: 'Date', category: 'Examples', example: '15 Jan 25' },
] as const;

export type BatchPlaceholder = typeof BATCH_PLACEHOLDERS[number];

export interface CustomVariable {
  name: string;
  label: string;
  category: string;
  example: string;
}

/**
 * Form-specific batch placeholders for NAVMC 10274
 * Just examples - users can create custom variables by typing @ANYTHING
 */
export const NAVMC_10274_PLACEHOLDERS = [
  { name: 'NAME', label: 'Name', category: 'Examples', example: 'DOE, JOHN M.' },
  { name: 'DATE', label: 'Date', category: 'Examples', example: '2025-01-25' },
] as const;

/**
 * Form-specific batch placeholders for NAVMC 118(11) / 6105
 * Just examples - users can create custom variables by typing @ANYTHING
 */
export const NAVMC_118_11_PLACEHOLDERS = [
  { name: 'NAME', label: 'Name', category: 'Examples', example: 'DOE, JOHN MICHAEL' },
  { name: 'DATE', label: 'Date', category: 'Examples', example: '2025-01-25' },
] as const;

/**
 * Application Constants for LIBO-SECURED
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
  DEBUG: 'LIBO_DEBUG',
  PROFILES: 'libo-secured-profiles',
  SELECTED_PROFILE: 'libo-secured-selected-profile',
  THEME: 'libo-secured-theme',
  LAST_DOC_TYPE: 'libo-secured-last-doc-type',
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
  NAME: 'LIBO-SECURED',
  FULL_NAME: 'USMC Correspondence Generator',
  VERSION: '1.0.0',
  GITHUB_URL: 'https://github.com/rchiofalo/libo-secured',
} as const;

/**
 * Batch generation placeholder variables
 * Common placeholders for S-1/Admin use cases
 */
export const BATCH_PLACEHOLDERS = [
  // 1st Person (Primary subject of document)
  { name: 'NAME_1', label: 'Full Name (1st)', category: '1st Person', example: 'John A. Smith' },
  { name: 'LAST_NAME_1', label: 'Last Name (1st)', category: '1st Person', example: 'Smith' },
  { name: 'FIRST_NAME_1', label: 'First Name (1st)', category: '1st Person', example: 'John' },
  { name: 'MI_1', label: 'Middle Initial (1st)', category: '1st Person', example: 'A.' },
  { name: 'RANK_1', label: 'Rank (1st)', category: '1st Person', example: 'Cpl' },
  { name: 'RANK_NAME_1', label: 'Rank + Name (1st)', category: '1st Person', example: 'Cpl Smith' },
  { name: 'EDIPI_1', label: 'EDIPI/DoD ID (1st)', category: '1st Person', example: '1234567890' },
  { name: 'MOS_1', label: 'MOS (1st)', category: '1st Person', example: '0311' },
  { name: 'BILLET_1', label: 'Billet/Position (1st)', category: '1st Person', example: 'Team Leader' },

  // 2nd Person (Witness, Reporting Senior, etc.)
  { name: 'NAME_2', label: 'Full Name (2nd)', category: '2nd Person', example: 'Jane B. Doe' },
  { name: 'LAST_NAME_2', label: 'Last Name (2nd)', category: '2nd Person', example: 'Doe' },
  { name: 'FIRST_NAME_2', label: 'First Name (2nd)', category: '2nd Person', example: 'Jane' },
  { name: 'MI_2', label: 'Middle Initial (2nd)', category: '2nd Person', example: 'B.' },
  { name: 'RANK_2', label: 'Rank (2nd)', category: '2nd Person', example: 'SSgt' },
  { name: 'RANK_NAME_2', label: 'Rank + Name (2nd)', category: '2nd Person', example: 'SSgt Doe' },
  { name: 'BILLET_2', label: 'Billet/Position (2nd)', category: '2nd Person', example: 'Squad Leader' },

  // 3rd Person (Reviewer, Commander, etc.)
  { name: 'NAME_3', label: 'Full Name (3rd)', category: '3rd Person', example: 'Michael C. Jones' },
  { name: 'LAST_NAME_3', label: 'Last Name (3rd)', category: '3rd Person', example: 'Jones' },
  { name: 'FIRST_NAME_3', label: 'First Name (3rd)', category: '3rd Person', example: 'Michael' },
  { name: 'MI_3', label: 'Middle Initial (3rd)', category: '3rd Person', example: 'C.' },
  { name: 'RANK_3', label: 'Rank (3rd)', category: '3rd Person', example: 'Capt' },
  { name: 'RANK_NAME_3', label: 'Rank + Name (3rd)', category: '3rd Person', example: 'Capt Jones' },
  { name: 'BILLET_3', label: 'Billet/Position (3rd)', category: '3rd Person', example: 'Company Commander' },

  // Dates & Times
  { name: 'DATE', label: 'Document Date', category: 'Dates', example: '15 Jan 25' },
  { name: 'EVENT_DATE', label: 'Event/Incident Date', category: 'Dates', example: '10 Jan 25' },
  { name: 'START_DATE', label: 'Start Date', category: 'Dates', example: '1 Jan 25' },
  { name: 'END_DATE', label: 'End Date', category: 'Dates', example: '31 Jan 25' },
  { name: 'TIME', label: 'Time', category: 'Dates', example: '0800' },

  // Location & Contact
  { name: 'EMAIL', label: 'Email Address', category: 'Contact', example: 'john.smith@usmc.mil' },
  { name: 'PHONE', label: 'Phone Number', category: 'Contact', example: '(760) 555-1234' },
  { name: 'ADDRESS', label: 'Full Address', category: 'Contact', example: '123 Main St, City, ST 12345' },
  { name: 'UNIT', label: 'Unit', category: 'Contact', example: '1st Bn, 6th Marines' },
  { name: 'LOCATION', label: 'Location', category: 'Contact', example: 'Camp Pendleton, CA' },

  // Document & Admin
  { name: 'SERIAL', label: 'Serial Number', category: 'Document', example: '001' },
  { name: 'CASE_NUM', label: 'Case/Reference #', category: 'Document', example: '2025-00123' },
  { name: 'AMOUNT', label: 'Amount/Value', category: 'Document', example: '$500.00' },
  { name: 'REASON', label: 'Reason/Justification', category: 'Document', example: 'Outstanding performance' },
  { name: 'AWARD', label: 'Award Type', category: 'Document', example: 'Navy Achievement Medal' },
  { name: 'COURSE', label: 'Course/Training', category: 'Document', example: 'Corporals Course' },
  { name: 'CHARGE', label: 'Charge/Violation', category: 'Document', example: 'Article 92, UCMJ' },
] as const;

export type BatchPlaceholder = typeof BATCH_PLACEHOLDERS[number];

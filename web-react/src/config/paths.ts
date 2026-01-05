/**
 * Centralized path configuration for libo-secured
 *
 * All file paths and URLs should be defined here to prevent
 * scattered hardcoded paths throughout the codebase.
 *
 * When file locations change, update them here only.
 */

// Base path from Vite (handles /libo-secured/ in production)
export const BASE_PATH = import.meta.env.BASE_URL || '/';

// Remove trailing slash for path joining
const basePathClean = BASE_PATH.replace(/\/$/, '');

/**
 * Library paths - SwiftLaTeX engine and related files
 */
export const LIB_PATHS = {
  // Main engine files
  pdfTeXEngine: '/lib/PdfTeXEngine.js',
  swiftLatexWorker: '/lib/swiftlatexpdftex.js',

  // Template and package files
  latexTemplates: '/lib/latex-templates.js',
  texlivePackages: '/lib/texlive-packages.js',

  // Texlive endpoint for fetching packages
  texliveEndpoint: `${basePathClean}/lib/texlive/`,
} as const;

/**
 * Asset paths - Images, seals, and other static assets
 */
export const ASSET_PATHS = {
  // Seal images for letterhead
  dodSeal: '/attachments/dod-seal.png',
  dowSeal: '/attachments/dow-seal.png',

  // Get full path with base
  getAssetPath: (relativePath: string) => `${basePathClean}${relativePath}`,
} as const;

/**
 * Generated file names - Files created during compilation
 */
export const GENERATED_FILES = {
  // Main LaTeX file
  mainTex: 'main.tex',

  // Config files (loaded in preamble)
  document: 'document.tex',
  letterhead: 'letterhead.tex',
  signatory: 'signatory.tex',
  flags: 'flags.tex',
  references: 'references.tex',
  referenceUrls: 'reference-urls.tex',
  enclConfig: 'encl-config.tex',
  copytoConfig: 'copyto-config.tex',
  body: 'body.tex',
  classification: 'classification.tex',

  // Signature image
  signatureImage: 'attachments/signature.png',
} as const;

/**
 * Template placeholders - Markers in templates that get replaced
 */
export const TEMPLATE_PLACEHOLDERS = {
  bodyContent: '%%BODY_CONTENT%%',
} as const;

/**
 * Virtual filesystem directories
 */
export const MEMFS_DIRECTORIES = [
  'formats',
  'attachments',
  'enclosures',
  'templates',
] as const;

/**
 * Helper to get full URL path for a library file
 */
export function getLibPath(path: string): string {
  return `${basePathClean}${path}`;
}

/**
 * Helper to get full URL path for an asset
 */
export function getAssetPath(path: string): string {
  return `${basePathClean}${path}`;
}

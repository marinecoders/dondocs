/**
 * Centralized Path Configuration for Naval Correspondence Generator
 *
 * This file serves as the single source of truth for all file paths and URLs
 * throughout the application. When file locations change, update them here only.
 *
 * Project Structure:
 * ==================
 * dondocs/
 * ├── .github/                           # GitHub Actions workflows
 * ├── tex/                               # LaTeX source templates (standalone)
 * │   ├── main.tex                       # Main template
 * │   └── templates/                     # Document type templates
 * │
 * ├── public/                            # Static assets served directly
 * │   ├── _headers                       # Cloudflare headers config
 * │   ├── _redirects                     # Cloudflare routing rules
 * │   ├── _routes.json                   # Cloudflare routes config
 * │   ├── attachments/                   # Seal images (dod-seal.png, dow-seal.png)
 * │   └── lib/                           # SwiftLaTeX engine files
 * │       ├── PdfTeXEngine.js            # Engine wrapper
 * │       ├── swiftlatexpdftex.js        # WebAssembly worker
 * │       ├── latex-templates.js         # LaTeX template strings
 * │       ├── texlive-packages.js        # TeX package preload list
 * │       └── texlive/                   # TeX Live distribution files
 * │
 * ├── src/                               # Application source code
 * │   ├── App.tsx                        # Main application component
 * │   ├── main.tsx                       # Entry point
 * │   ├── index.css                      # Global styles (Tailwind)
 * │   │
 * │   ├── components/                    # React components
 * │   │   ├── index.ts                   # Barrel export
 * │   │   ├── editor/                    # Form editor components
 * │   │   │   ├── index.ts               # Barrel export
 * │   │   │   ├── AddressingSection.tsx
 * │   │   │   ├── ClassificationSection.tsx
 * │   │   │   ├── CopyToManager.tsx
 * │   │   │   ├── DocumentStats.tsx
 * │   │   │   ├── DocumentTypeSelector.tsx
 * │   │   │   ├── EnclosuresManager.tsx
 * │   │   │   ├── LetterheadSection.tsx
 * │   │   │   ├── MOASection.tsx
 * │   │   │   ├── ParagraphsEditor.tsx
 * │   │   │   ├── ProfileBar.tsx
 * │   │   │   ├── ReferencesManager.tsx
 * │   │   │   ├── RichTextToolbar.tsx
 * │   │   │   └── SignatureSection.tsx
 * │   │   │
 * │   │   ├── layout/                    # Page layout components
 * │   │   │   ├── index.ts               # Barrel export
 * │   │   │   ├── FormPanel.tsx
 * │   │   │   ├── Header.tsx
 * │   │   │   └── PreviewPanel.tsx
 * │   │   │
 * │   │   ├── modals/                    # Modal dialogs
 * │   │   │   ├── index.ts               # Barrel export
 * │   │   │   ├── AboutModal.tsx
 * │   │   │   ├── BatchModal.tsx
 * │   │   │   ├── FindReplaceModal.tsx
 * │   │   │   ├── LogViewerModal.tsx
 * │   │   │   ├── MobilePreviewModal.tsx
 * │   │   │   ├── NISTComplianceModal.tsx
 * │   │   │   ├── OfficeCodeLookupModal.tsx
 * │   │   │   ├── PIIWarningModal.tsx
 * │   │   │   ├── ProfileModal.tsx
 * │   │   │   ├── ReferenceLibraryModal.tsx
 * │   │   │   ├── SSICLookupModal.tsx
 * │   │   │   ├── TemplateLoaderModal.tsx
 * │   │   │   ├── UnitLookupModal.tsx
 * │   │   │   └── WelcomeModal.tsx
 * │   │   │
 * │   │   └── ui/                        # Base UI components (shadcn/ui)
 * │   │       ├── index.ts               # Barrel export
 * │   │       └── [shadcn components]
 * │   │
 * │   ├── config/                        # Configuration
 * │   │   └── paths.ts                   # This file - path mappings
 * │   │
 * │   ├── data/                          # Military reference data
 * │   │   ├── index.ts                   # Barrel export
 * │   │   ├── form-templates.json        # Pre-built letter templates
 * │   │   ├── office-codes.json          # Military office codes (S-1, G-3, etc.)
 * │   │   ├── officeCodes.ts             # Office codes TypeScript wrapper
 * │   │   ├── ranks.ts                   # Military ranks (USMC, Navy)
 * │   │   ├── references.json            # Reference library (MCO, SECNAVINST)
 * │   │   ├── ssic.json                  # SSIC codes raw data
 * │   │   ├── ssicCodes.ts               # SSIC codes TypeScript wrapper
 * │   │   ├── units.json                 # Unit directory raw data
 * │   │   └── unitDirectory.ts           # Unit directory TypeScript wrapper
 * │   │
 * │   ├── hooks/                         # Custom React hooks
 * │   │   ├── index.ts                   # Barrel export
 * │   │   ├── useLatexEngine.ts          # SwiftLaTeX engine hook
 * │   │   └── useStatusMessage.ts        # Status message hook
 * │   │
 * │   ├── lib/                           # Utility libraries
 * │   │   ├── index.ts                   # Barrel export
 * │   │   ├── PdfTeXEngine.js            # Engine class (copied to public/)
 * │   │   ├── constants.ts               # Application constants
 * │   │   ├── debug.ts                   # Debug logging utilities
 * │   │   ├── encoding.ts                # Base64/binary encoding utils
 * │   │   ├── latex-templates.js         # LaTeX templates (copied to public/)
 * │   │   ├── paragraphUtils.ts          # Paragraph labeling utilities
 * │   │   ├── texlive-packages.js        # TeX packages (copied to public/)
 * │   │   └── utils.ts                   # General utilities (cn)
 * │   │
 * │   ├── services/                      # Document generation services
 * │   │   ├── index.ts                   # Barrel export
 * │   │   ├── docx/
 * │   │   │   └── generator.ts           # DOCX document generation
 * │   │   ├── latex/
 * │   │   │   ├── escaper.ts             # LaTeX string escaping
 * │   │   │   └── generator.ts           # LaTeX source generation
 * │   │   ├── pdf/
 * │   │   │   ├── addSignatureField.ts   # PDF signature fields
 * │   │   │   └── mergeEnclosures.ts     # PDF enclosure merging
 * │   │   └── pii/
 * │   │       └── detector.ts            # PII/PHI detection
 * │   │
 * │   ├── stores/                        # Zustand state stores
 * │   │   ├── index.ts                   # Barrel export
 * │   │   ├── documentStore.ts           # Main document state
 * │   │   ├── historyStore.ts            # Undo/redo history
 * │   │   ├── logStore.ts                # Debug log state
 * │   │   ├── profileStore.ts            # User profiles
 * │   │   └── uiStore.ts                 # UI preferences
 * │   │
 * │   ├── types/                         # TypeScript type definitions
 * │   │   ├── index.ts                   # Barrel export
 * │   │   └── document.ts                # Document-related types
 * │   │
 * │   └── utils/                         # Additional utilities
 * │       └── downloadPdf.ts             # PDF download handling
 * │
 * ├── index.html                         # HTML entry point
 * ├── package.json                       # NPM dependencies
 * ├── vite.config.ts                     # Vite configuration
 * ├── tsconfig.json                      # TypeScript configuration
 * ├── eslint.config.js                   # ESLint configuration
 * ├── components.json                    # shadcn/ui configuration
 * ├── Makefile                           # Build commands
 * └── README.md                          # Project documentation
 */

// Base path from Vite (handles deployment path prefixes)
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
  distributionConfig: 'distribution-config.tex',
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

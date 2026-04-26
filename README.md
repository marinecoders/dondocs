# DonDocs — Naval Correspondence & Form Generator

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![SECNAV M-5216.5](https://img.shields.io/badge/SECNAV-M--5216.5-blue)](https://www.secnav.navy.mil/doni/SECNAV%20Manuals1/5216.5%20DON%20Correspondence%20Manual.pdf)
[![MCO 5216.20B](https://img.shields.io/badge/MCO-5216.20B-red)](https://www.marines.mil/News/Publications/MCPEL/Electronic-Library-Display/Article/899678/mco-521620/)
[![NIST 800-171](https://img.shields.io/badge/NIST-800--171-green)](https://csrc.nist.gov/publications/detail/sp/800-171/rev-2/final)

**DonDocs** is a browser-based naval correspondence and form generator that produces publication-quality documents compliant with **SECNAV M-5216.5** (Department of the Navy Correspondence Manual) and **MCO 5216.20B** (Marine Corps Supplement).

**All processing happens locally in your browser - no data is ever sent to any server.**

## Table of Contents

- [Getting Started](#getting-started)
- [Features](#features)
- [Document Types](#document-types)
- [Compliance Mode](#compliance-mode)
- [Security & Classification](#security--classification)
- [User Interface](#user-interface)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Technology Stack](#technology-stack)
- [Form Templates](#form-templates)
- [Development](#development)
- [License](#license)

---

## Getting Started

### Quick Start
1. Open the application in your browser
2. Set up your letterhead and addressing
3. Fill in required fields (From, To, Subject)
4. Add paragraphs to the body
5. Preview your document in real-time
6. Download as PDF, DOCX, or LaTeX

### First-Time Setup
1. Click **Profiles** to create your unit profile
2. Enter your unit information, rank, name, and signature image
3. Save the profile for quick reuse
4. Your information auto-fills on future documents

---

## Features

DonDocs uses a WebAssembly LaTeX compiler to produce publication-quality PDFs that match official military typesetting — pixel-perfect spacing, kerning, and margins per SECNAV specifications. Everything runs locally in the browser; nothing is ever sent to a server.

### Export Formats
- **PDF** — full-featured with enclosures, signatures, and classification markings
- **DOCX** — editable Microsoft Word output with matching layout
- **LaTeX** — source files for advanced customization

### Core Functionality
- **Real-time PDF Preview** - See your document as you type (1.5s debounce)
- **20 Document Types** - All selectable from the document type dropdown with full SECNAV M-5216.5 compliance
- **Dynamic UI Sections** - Form panels adapt per document type: sections gray out with "Not used by this document type" indicators when inapplicable, and specialized panels appear for dual-command formats (MOA/MOU, Joint, Executive)
- **SECNAV M-5216.5 Compliant** - Automatic formatting per Navy/Marine Corps regulations
- **PDF/DOCX Parity** - Both export formats produce matching layouts with identical SECNAV-standard spacing
- **PWA/Offline Mode** - Install as an app and work offline with cached TeX Live packages
- **Compliant vs Custom Modes** - Strict regulation mode or customizable fonts and formatting (see [Compliance Mode](#compliance-mode) for details)
- **Full Quality Preview** - Optional toggle to include enclosures, hyperlinks, and signatures in the live preview (Settings > Preview)

### Document Management
- **Profiles System** - Save and reuse unit information and signature images
- **Template Library** - 11 auditor-approved letter templates for common correspondence
- **Clear Fields** - Reset all content while preserving letterhead for quick new document creation
- **Reference Library** - 107 searchable military references with one-click insert
- **Unit Directory** - 3,139 units searchable by name, abbreviation, MCC, or location
- **Office Codes** - 74 standard military position codes for signature blocks
- **SSIC Lookup** - 2,240 codes searchable by number or description
- **Batch Generation** - Generate multiple documents with 28 built-in placeholders and Insert Variable button
- **Find & Replace** - Search and replace text across your document
- **Undo/Redo** - 50-level history with keyboard shortcuts
- **Document Statistics** - Real-time word count, character count, paragraph count

### Security Features
- **PII/PHI Detection** - Pre-download warning for sensitive data:
  - Social Security Numbers (SSN)
  - DoD ID Numbers (EDIPI)
  - Dates of Birth
  - Phone numbers
  - Personal email addresses
  - 95+ medical/PHI keywords
- **Digital Signature Fields** - CAC/PIV compatible signature boxes in PDF
- **Classification Markings** - Unclassified through TOP SECRET//SCI
- **CUI Handling** - 10 categories with distribution statements (A-F)
- **Portion Markings** - Per-paragraph classification indicators

### Document Elements
- **Hierarchical Paragraphs** - 8 levels with automatic labeling (1., a., (1), (a), etc.)
- **References** - Auto-lettered with optional hyperlinks
- **Enclosures** - PDF attachments with cover pages and 3 page styles
- **Copy To** - Distribution list for information recipients
- **Distribution** - Action addressee list per SECNAV Ch 8
- **Continuation Subject** - Optional subject line on page 2+ headers
- **Signature Images** - Upload and embed your signature
- **Drag & Drop** - Reorder paragraphs, references, and enclosures

### User Experience
- **Welcome Modal** - Interactive onboarding with feature highlights and rotating tips
- **Browser Compatibility Detection** - Warns users in in-app browsers (Google, Facebook, Instagram, Twitter, LinkedIn) about limited functionality
- **Mobile Responsive** - Hamburger menu, touch-friendly controls, full-screen preview on mobile
- **Installable PWA** - Add to home screen for native app-like experience

### Batch Generation
Generate multiple personalized documents from a single template using the **Insert Variable** button or `{{PLACEHOLDER}}` syntax.

**28 Built-in Placeholders across 6 categories:**

| Category | Placeholders |
|----------|-------------|
| **Subject** | NAME, LAST_NAME, FIRST_NAME, MI, RANK, RANK_NAME, EDIPI, MOS, BILLET |
| **2nd Person** | NAME_2, RANK_2, RANK_NAME_2, BILLET_2 |
| **3rd Person** | NAME_3, RANK_3, RANK_NAME_3, BILLET_3 |
| **Dates** | DATE, EVENT_DATE, START_DATE, END_DATE, TIME |
| **Contact** | EMAIL, PHONE, ADDRESS, UNIT, LOCATION |
| **Document** | SERIAL, CASE_NUM, AMOUNT, REASON, AWARD, COURSE, CHARGE |

**Use Cases for S-1/Admin:**
- Awards packages (NAME, RANK, AWARD, REASON)
- Counseling/disciplinary (NAME, CHARGE, EVENT_DATE, NAME_2 for witness)
- Training requests (NAME, COURSE, START_DATE, END_DATE)
- Mass notifications (NAME, RANK_NAME, EMAIL, UNIT)
- Multi-party documents (subject, witness, reviewing officer)

**Preview Support:** Placeholders display as highlighted yellow boxes in the PDF preview so you can see where variables will be inserted.

**Excel/CSV Import:** Upload a spreadsheet with columns matching placeholder names to generate documents for each row.

---

## Document Types

### 20 Format Definitions

| Category | Types |
|----------|-------|
| Letters | Naval Letter, Standard Letter, Business Letter, Multiple Address Letter, Joint Letter |
| Endorsements | Same-Page Endorsement, New-Page Endorsement |
| Memoranda | MFR, Memorandum For, Plain Paper, Letterhead, Decision, Executive, Joint Memorandum |
| Agreements | MOA, MOU |
| Executive | Executive Correspondence, Standard Memorandum, Action Memorandum, Information Memorandum |

All 20 types are selectable in the document type dropdown with full SECNAV M-5216.5 compliance.

### Pre-Built Templates (11)
| Template | Category |
|----------|----------|
| PFT Waiver | Personnel |
| Humanitarian Transfer | Personnel |
| NAM Award | Awards |
| Letter of Appreciation | Awards |
| Command Interest | Leadership |
| Appointment: Collateral Duty | Administrative |
| Appointment: Board Member | Administrative |
| Appointment: Safety Officer | Administrative |
| Report of Findings | Investigations |
| Appointment: Investigating Officer | Investigations |
| Letter of Instruction | Operations |

---

## Compliance Mode

DonDocs offers two modes for each document type:

### Compliant Mode (Default)
Enforces strict SECNAV M-5216.5 formatting rules. Certain features are locked or restricted based on the document type to ensure regulation compliance.

### Custom Mode
Unlocks all features for non-official use, drafting, or situations where deviation from regulations is acceptable. Custom mode allows:
- Any font size (10pt, 11pt, 12pt, 14pt)
- Any font family (Times, Courier)
- Flexible formatting options

### Compliance Restrictions by Document Type

| Document Type | Numbered Paragraphs | References Section | Enclosures Section | Salutation | Complimentary Close | Date Format |
|---------------|:-------------------:|:------------------:|:------------------:|:----------:|:-------------------:|:-----------:|
| **Naval Letter** | Yes | Yes | Yes | No | No | Military (4 Jan 26) |
| **Standard Letter** | Yes | Yes | Yes | No | No | Military |
| **Business Letter** | No | No* | No* | Required | Required | Spelled (January 4, 2026) |
| **Multiple Address Letter** | Yes | Yes | Yes | No | No | Military |
| **Joint Letter** | Yes | Yes | Yes | No | No | Military |
| **Endorsements** | No | Yes | Yes | No | No | Military |
| **All Memoranda** | Yes | Yes | Yes | No | No | Military |
| **MOA/MOU** | Yes | Yes | Yes | No | No | Military |
| **Executive Correspondence** | Yes | Yes | Yes | No | No | Military |
| **Standard Memorandum** | No | No | No | No | No | Spelled |
| **Action Memorandum** | No | No | No | No | No | Spelled |
| **Information Memorandum** | No | No | No | No | No | Spelled |

*Business Letters: References and enclosures must be mentioned in the body text rather than in formal sections (per SECNAV M-5216.5 Ch 11).

### What Each Restriction Means

| Restriction | Description |
|-------------|-------------|
| **Numbered Paragraphs** | When enabled, paragraphs use hierarchical numbering (1., a., (1), (a), etc.). When disabled, paragraphs have no numbering. |
| **References Section** | When enabled, formal "Ref:" section appears. When disabled, references can only be mentioned in body text. |
| **Enclosures Section** | When enabled, formal "Encl:" section with attachments. When disabled, enclosures mentioned in body only. |
| **Salutation** | When required, document must include "Dear Mr./Ms./Dr.:" line per business letter format. |
| **Complimentary Close** | When required, document must include "Sincerely," or similar closing per business letter format. |
| **Date Format** | Military format "4 Jan 26" vs spelled format "January 4, 2026". |

### Dual Signature Documents

The following document types require two signature blocks (one for each command/party):
- Joint Letter
- Joint Memorandum
- Memorandum of Agreement (MOA)
- Memorandum of Understanding (MOU)

Per SECNAV M-5216.5, dual-command documents position the **Junior command on the LEFT** (signs first) and the **Senior command on the RIGHT** (signs last). This convention applies consistently to both the ID symbols block (SSIC/Serial/Date) and the signature block in both PDF and DOCX output.

---

## Security & Classification

### Classification Levels
| Level | Description |
|-------|-------------|
| Unclassified | No classification |
| CUI | Controlled Unclassified Information |
| CONFIDENTIAL | Could cause damage |
| SECRET | Could cause serious damage |
| TOP SECRET | Could cause grave damage |
| TOP SECRET//SCI | Sensitive Compartmented Information |
| Custom | User-defined classification banner text |

### CUI Categories
Privacy, Proprietary, Legal, Law Enforcement, Export Control, Financial, Intelligence, Critical Infrastructure, Defense, Other

### Portion Markings
Apply per-paragraph markings: **(U)**, **(CUI)**, **(FOUO)**, **(C)**, **(S)**, **(TS)**

### PII/PHI Detection
Before downloading, DonDocs scans for:
- Social Security Numbers (XXX-XX-XXXX)
- EDIPI/DoD ID Numbers (10-digit)
- Dates of Birth
- Phone numbers
- Personal email addresses (non-.mil)
- Medical keywords (patient, diagnosis, treatment, medication, etc.)

You'll receive a warning with the option to proceed or cancel.

### Digital Signatures
PDF output includes empty signature fields compatible with:
- CAC (Common Access Card)
- PIV (Personal Identity Verification) cards
- Adobe Acrobat digital signatures
- Third-party PKI solutions

---

## User Interface

### Header Bar
| Button | Function | Shortcut |
|--------|----------|----------|
| Refresh | Force recompile preview | - |
| Save | Save/Load from browser storage | Ctrl+S |
| Download | PDF, DOCX, LaTeX export | Ctrl+D |
| Templates | Load pre-built templates | Ctrl+Shift+T |
| Batch | Generate multiple documents | - |
| Find & Replace | Search and replace text | Ctrl+H |
| Keyboard | View all shortcuts | - |
| Density | Compact / Comfortable / Spacious | - |
| Color | Default / Navy / USMC schemes | - |
| Theme | Toggle dark/light mode | - |
| Full Quality | Include enclosures/hyperlinks/signatures in preview | - |

### Editor Panel (Left)
- **Profile Bar** - Quick profile selector with unit lookup
- **Mode Toggle** - Switch between Compliant (strict SECNAV) and Custom (flexible) modes (see [Compliance Mode](#compliance-mode))
- **Document Type** - Select from 20 document types; the entire form dynamically reconfigures per selection. **Clear Fields** resets content while preserving letterhead
- **Letterhead** - Unit name, address, seal type; shows "Not used" indicator for types without letterhead (e.g., MFR, Plain Paper)
- **Addressing** - From, To, Via, Subject, SSIC, Serial, Date — fields auto-show/hide per doc type (e.g., business letters show recipient address block instead of From/To, executive formats skip SSIC)
- **Dual-Command Sections** - MOA/MOU show Junior/Senior SSIC and signature fields; Joint Letter/Memo show dual From/To/Via
- **Classification** - Security markings, CUI settings, and custom classification text
- **Paragraphs** - Document body with 8-level hierarchy
- **References** - Auto-lettered with hyperlink support; grayed out with indicator for doc types that don't use formal references
- **Enclosures** - PDF attachments with cover pages; grayed out with indicator for doc types that don't use formal enclosures
- **Copy To** - Information distribution list
- **Distribution** - Action addressee list per SECNAV Ch 8
- **Signature** - Signatory information and image; dual signature blocks for MOA/MOU/Joint formats
- **Document Statistics** - Word/character/paragraph counts

### Preview Panel (Right)
- Real-time PDF preview
- Loading indicator during compilation
- Error messages for troubleshooting

### UI Customization
- **3 Density Modes** - Compact (power users), Comfortable (default), Spacious (touch/accessibility)
- **3 Color Schemes** - Default (neutral), Navy (blue tones), USMC (red/gold accents)
- **Dark/Light Mode** - System-aware with manual toggle
- **Persistent Preferences** - Settings saved to browser localStorage

### Mobile Support
- Responsive header with hamburger menu
- Compact button layouts for small screens
- Full-screen preview modal on mobile devices
- Touch-friendly controls and spacing

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+D` / `Cmd+D` | Download PDF |
| `Ctrl+P` / `Cmd+P` | Print PDF |
| `Ctrl+S` / `Cmd+S` | Save Draft |
| `Ctrl+H` / `Cmd+H` | Find & Replace |
| `Ctrl+E` / `Cmd+E` | Toggle Preview |
| `Ctrl+Shift+T` | Open Templates |
| `Ctrl+Shift+R` | Open Reference Library |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` / `Cmd+Y` | Redo |
| `Escape` | Close Modals |

---

## Technology Stack

### Frontend
- **React 19** with TypeScript
- **Zustand 5** for state management
- **Tailwind CSS 4** with shadcn/ui components
- **dnd-kit** for drag and drop
- **Vite 7** for build tooling

### Document Generation
- **SwiftLaTeX** - WebAssembly LaTeX compiler for publication-quality PDFs
- **Pandoc WASM** - In-browser LaTeX-to-DOCX conversion via WebAssembly (~58MB, cached by service worker)
- **pdf-lib** - PDF manipulation (enclosures, signatures, metadata)
- **JSZip** - DOCX post-processing (table widths, fonts, letterhead colors)
- **react-pdf-viewer** - In-browser PDF preview

### Data Processing
- **date-fns** - Military date formatting (4 Jan 26)
- **TipTap** - Rich text editing
- **react-day-picker** - Date selection

### Progressive Web App
- **vite-plugin-pwa** - Service worker for offline support
- **Workbox** - Intelligent caching for TeX Live packages

---

## Form Templates

DonDocs supports official military forms (NAVMC 10274, NAVMC 118(11), etc.) by overlaying text onto official PDF templates obtained from [DoD Forms Management](https://forms.documentservices.dla.mil) or [Navy Forms Online](https://www.mynavyhr.navy.mil/References/Forms/).

For instructions on adding a new form template — flattening XFA, defining box coordinates, generator code patterns — see **[docs/FORM_TEMPLATES.md](docs/FORM_TEMPLATES.md)**.

> ⚠️ Only official, pre-approved forms should be used. Don't create form templates from scratch.

---

## Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

### Project Structure

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md#project-structure) for the full directory layout and key file index.

### Document Generation Pipelines

DonDocs has **two independent generation pipelines** — one for PDF, one for DOCX — that share the same Zustand store but produce output through completely different LaTeX dialects and different runtime engines.

| Output | Generator | Engine | Why separate |
|---|---|---|---|
| **PDF** | [`generator.ts`](src/services/latex/generator.ts) — multiple `.tex` files with custom macros and `\input{}` chains | SwiftLaTeX (WebAssembly LaTeX compiler) | SwiftLaTeX accepts our full LaTeX feature set; produces pixel-perfect typography |
| **DOCX** | [`flat-generator.ts`](src/services/latex/flat-generator.ts) — single self-contained `.tex` using only pandoc-compatible LaTeX | Pandoc WASM + Lua filter + JSZip post-processing | Pandoc's reader rejects custom macros and `\input{}`; needs a flat dialect |

Both pipelines:
- Read from the same `documentStore` (Zustand)
- Run entirely in-browser, no server calls
- Produce equivalent SECNAV-compliant output, just in different formats

The detailed walk-throughs below cover each pipeline end-to-end. **If you're working on PDF output, see [LaTeX Generation Flow](#latex-generation-flow). If you're working on DOCX output, see [DOCX Generation Flow](#docx-generation-flow).**

#### Shared code (both pipelines)

Some code is hit by both PDF and DOCX paths and is worth knowing about regardless of which output you're working on:

| File | Purpose |
|---|---|
| [`src/stores/documentStore.ts`](src/stores/documentStore.ts) | Single source of truth for document state. Both generators read from here. |
| [`src/services/latex/escaper.ts`](src/services/latex/escaper.ts) | LaTeX special-character escaping (`escapeLatex`, `escapeLatexUrl`, `processBodyText`, `convertRichTextToLatex`). Used by both generators. |
| [`src/lib/placeholders.ts`](src/lib/placeholders.ts) | `replacePlaceholders()` for `{{NAME}}`-style variable substitution; per-form helpers like `applyPlaceholdersToNavmc11811()`. Both generators substitute placeholders before output. |
| [`src/lib/url-safety.ts`](src/lib/url-safety.ts) | `safeUrl()` chokepoint for URL annotations — allowlist of `http`/`https`/`mailto`. Wired into both `mergeEnclosures.ts` (PDF post-process) and `generator.ts` (LaTeX `\setRefURL{}` for SwiftLaTeX). Rejects `javascript:` / `data:` / `file:` etc. |
| [`src/services/pii/detector.ts`](src/services/pii/detector.ts) | PII/PHI scan on the document before either export path runs. |
| [`src/data/`](src/data/) | Static data libraries (units, SSIC codes, references, ranks, office codes). Read on demand by both generators. |

Changes to any of these files affect **both** outputs — please test PDF and DOCX after touching them.

### LaTeX Generation Flow

The application generates PDFs through a multi-stage pipeline from UI input to final PDF output:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React UI      │ --> │   Zustand Store  │ --> │   Generator     │ --> │  SwiftLaTeX     │
│   (Components)  │     │   (documentStore)│     │  (generator.ts) │     │  (WebAssembly)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘     └─────────────────┘
                                                          │                       │
                                                          v                       v
                                                 ┌─────────────────┐     ┌─────────────────┐
                                                 │  .tex Files     │ --> │   Raw PDF       │
                                                 │  (Virtual FS)   │     │                 │
                                                 └─────────────────┘     └─────────────────┘
                                                                                  │
                                                                                  v
                                                                         ┌─────────────────┐
                                                                         │  Post-Process   │
                                                                         │  (pdf-lib)      │
                                                                         └─────────────────┘
                                                                                  │
                                                                                  v
                                                                         ┌─────────────────┐
                                                                         │  Final PDF      │
                                                                         │  (with encl,    │
                                                                         │   hyperlinks,   │
                                                                         │   signatures)   │
                                                                         └─────────────────┘
```

**1. React UI → Zustand Store**
- User inputs data through form components in `src/components/editor/`
- Data is stored in `documentStore` (Zustand) with fields like `formData`, `paragraphs`, `references`, etc.

**2. Zustand Store → Generator**
- `src/services/latex/generator.ts` reads from the store
- Generates multiple `.tex` files:
  - `document.tex` - Document type, SSIC, date, from/to, subject
  - `letterhead.tex` - Unit name, address, seal configuration
  - `classification.tex` - CUI/classification markings
  - `signatory.tex` - Signature block information
  - `references.tex` - Reference list
  - `reference-urls.tex` - Reference URL mappings for hyperlinks
  - `encl-config.tex` - Enclosure list configuration
  - `copyto-config.tex` - Copy To list (information recipients)
  - `distribution-config.tex` - Distribution list (action addressees)
  - `body.tex` - Document body paragraphs
  - `flags.tex` - Boolean flags for conditional sections

**3. Template System**

There are two types of templates:

**Content Templates** (`src/data/templates/`) - TypeScript files defining pre-filled document content:
- Award recommendations, personnel requests, administrative forms, etc.
- Define subject lines, paragraphs, references, and SSIC codes
- No LaTeX knowledge required - see `docs/CREATING_TEMPLATES.md`

**Format Templates** (LaTeX) - Define document layouts:
- `public/lib/latex-templates.js` contains all LaTeX templates as a JavaScript object
- `tex/main.tex` - Main document structure, package imports, base commands
- `tex/templates/*.tex` - Document format templates (17 types: naval_letter, mfr, etc.)
- Each format defines:
  - `\printDateAndTitle` - How date/SSIC block is formatted
  - `\printAddressBlock` - How From/To/Via/Subject appears
  - `\printSignature` - How signature block is rendered
  - `\printLetterhead` - Whether/how letterhead appears

**4. Virtual Filesystem → SwiftLaTeX**
- `useLatexEngine.ts` hook manages the WebAssembly LaTeX engine
- Templates are written to a virtual filesystem (stripping `tex/` and `templates/` prefixes)
- Generated `.tex` files are written to the virtual FS
- `main.tex` loads the appropriate template via `\input{\DocumentType}`

**5. Compilation**
- SwiftLaTeX (WebAssembly) compiles `main.tex`
- Fetches missing TeX Live packages from `/lib/texlive/` as needed
- Returns compiled PDF as `Uint8Array`

**6. Post-Processing (pdf-lib)**
- `src/services/pdf/` handles PDF post-processing:
  - Merge enclosure PDFs with cover pages and page scaling (avoiding N+1 parses by reusing the validated `PDFDocument` from `validatePdf` in `addPdfEnclosure`)
  - Add clickable hyperlinks for references and enclosures, with URLs sanitized via [`safeUrl()`](src/lib/url-safety.ts) before embedding as `/URI` annotations
  - Insert digital signature fields (CAC/PIV compatible)
  - Apply classification markings to enclosure pages (main letter markings handled by LaTeX)
- Compile calls are serialized through a queue ref in `useLatexEngine.ts` to close a TOCTOU race in vendor `PdfTeXEngine.js` (its `isReady()` check + Busy-flag set are non-atomic).

**Key Files:**
| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app component, debounced preview (1.5s LaTeX, 500ms forms) |
| `src/services/latex/generator.ts` | Generates `.tex` files from store data |
| `src/services/latex/escaper.ts` | Escapes special LaTeX characters, wraps text |
| `public/lib/latex-templates.js` | All LaTeX templates (main + 20 document types) |
| `src/hooks/useLatexEngine.ts` | Manages SwiftLaTeX WebAssembly engine |
| `src/services/pdf/mergeEnclosures.ts` | Merges enclosures, adds hyperlinks and markings |
| `src/services/pdf/addSignatureField.ts` | Adds CAC/PIV digital signature fields |

**Debugging Tips:**
- Check browser console for LaTeX compilation errors
- Use `DONDOCS.texlive.summary()` in console to see TeX Live file requests
- Template loading issues: Verify file paths in virtual filesystem
- Content issues: Check `escapeLatex()` output for special characters

### DOCX Generation Flow

DOCX export uses a completely separate pipeline from the PDF path. Instead of the multi-file SwiftLaTeX approach, it generates a single flat LaTeX file and converts it to DOCX via pandoc WASM running entirely in the browser.

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   React UI      │ --> │   Zustand Store  │ --> │  Flat Generator  │ --> │  Pandoc WASM    │
│   (Components)  │     │   (documentStore)│     │ (flat-generator) │     │  (pandoc.js)    │
└─────────────────┘     └──────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │                       │
                                                          v                       v
                                                 ┌──────────────────┐    ┌─────────────────┐
                                                 │  Single .tex     │    │  Lua Filter     │
                                                 │  (pandoc-safe    │    │  (dondocs.lua)  │
                                                 │   LaTeX only)    │    │                 │
                                                 └──────────────────┘    └─────────────────┘
                                                                                  │
                                                                                  v
                                                                         ┌─────────────────┐
                                                                         │  Post-Process   │
                                                                         │  (JSZip/OOXML)  │
                                                                         └─────────────────┘
                                                                                  │
                                                                                  v
                                                                         ┌─────────────────┐
                                                                         │  Final DOCX     │
                                                                         │  (fonts, colors,│
                                                                         │   page layout)  │
                                                                         └─────────────────┘
```

**1. Zustand Store → Flat Generator**
- `src/services/latex/flat-generator.ts` reads the same store data as the PDF generator
- Produces a single self-contained `.tex` file with no `\input{}` calls or custom macros
- Reference URLs are sanitized via [`safeUrl()`](src/lib/url-safety.ts) before being embedded in `\href{}` annotations — same chokepoint the PDF path uses
- Uses only pandoc-compatible LaTeX constructs:
  - `tabularx` for centered/right-aligned layouts (pandoc ignores `\begin{center}`)
  - `\mbox{}` to protect numbered labels from pandoc's list detection
  - `\vspace{}` for precise spacing (converted to OOXML `w:before` by the Lua filter)
  - `\includegraphics{}` for seal images

**2. Pandoc WASM Conversion**
- `src/services/docx/pandoc-converter.ts` lazy-loads pandoc 3.9+ as a WASM module (~58MB, cached by service worker after first DOCX export)
- Conversion runs entirely in-browser with `+raw_tex` extension enabled
- Input files provided to pandoc: flat `.tex`, `reference.docx` (template), `dondocs.lua` (filter), seal image
- Layout metadata (column proportions) passed via pandoc `--metadata`

**3. Lua Filter (dondocs.lua)**

The Lua filter (`public/lib/pandoc/dondocs.lua`) runs a four-pass architecture inside pandoc:
- **Meta pass** — reads layout metadata (column widths, seal proportions)
- **Table pass** — classifies tables by structure (letterhead, SSIC, address, dual-signature, centered title) and applies precise column widths
- **RawBlock pass** — converts LaTeX spacing commands (`\vspace`, `\medskip`, `\rule`) into OOXML spacing paragraphs
- **RawInline pass** — converts inline commands (`\mbox`, `\textbf`, `\underline`, `\textcolor`, `\fcolorbox`) into native pandoc elements

**4. OOXML Post-Processing (JSZip)**

After pandoc produces the DOCX, `pandoc-converter.ts` opens it with JSZip and fixes known pandoc writer limitations:
- Zeros out table cell margins (pandoc adds ~0.08in padding by default)
- Rescales `gridCol` widths from pandoc's hardcoded 7920 twips (5.5in) to our 9360 twips (6.5in)
- Forces exact symmetric letterhead column widths and vertical centering
- Constrains empty spacer rows to 12pt height (pandoc ignores `\\[12pt]` row spacing in tabular environments, so explicit empty rows are emitted by the flat generator and fixed to exact SECNAV-standard height here)
- Removes unwanted empty paragraphs between tables
- Injects page geometry (US Letter, 1in margins) into `sectPr`
- Applies letterhead color (PMS 288 navy blue or black) and font sizes (10pt/8pt)
- Sets document-wide font family and size in `styles.xml`

**Key Files:**
| File | Purpose |
|------|---------|
| `src/services/latex/flat-generator.ts` | Generates pandoc-compatible flat LaTeX from store data |
| `src/services/docx/pandoc-converter.ts` | Pandoc WASM loading, conversion, and OOXML post-processing |
| `src/services/docx/layout-config.ts` | Shared layout proportions (used by both flat-generator and converter) |
| `public/lib/pandoc/pandoc.js` | Pandoc 3.9+ WASM module loader |
| `public/lib/pandoc/pandoc.wasm` | Pandoc WASM binary (~58MB) |
| `public/lib/pandoc/dondocs.lua` | Four-pass Lua filter for DOCX formatting |
| `public/lib/pandoc/reference.docx` | DOCX template with base styles |

**See [Document Generation Pipelines](#document-generation-pipelines) at the top of this section** for the side-by-side comparison and the shared-code touchpoints both generators hit.

---

## NIST 800-171 Compliance

DonDocs is designed for information security:

- **Local Processing** - All data stays in your browser
- **No Server Communication** - Documents never leave your device
- **No Telemetry** - No tracking or analytics
- **Air-Gap Compatible** - Works on isolated networks (SIPR/JWICS)
- **CUI Support** - Proper marking for Controlled Unclassified Information
- **PWA Offline Mode** - Install as an app; TeX Live packages cached locally for offline use

**Note:** Users are responsible for handling classified information according to their organization's security policies.

---

## FAQ

**Q: Does this work on NMCI computers?**
A: Yes. It's a standard webpage that works in any modern browser. No installation required.

**Q: Can I install this as an app?**
A: Yes. DonDocs is a Progressive Web App (PWA). Click "Install" in your browser or use "Add to Home Screen" on mobile. Once installed, it works offline.

**Q: Does it work offline?**
A: Yes. After the first visit, the app caches all necessary files including the TeX Live packages. You can generate documents without an internet connection.

**Q: Can I use this for classified correspondence?**
A: The tool formats documents but does not provide security controls for classified data. Use appropriate systems for classified information.

**Q: Is my data saved anywhere?**
A: Everything runs in your browser. Nothing is transmitted to any server. Data can be saved to browser localStorage.

**Q: Why LaTeX instead of jsPDF?**
A: LaTeX produces publication-quality output with proper kerning, ligatures, and typography that matches official military publications.

**Q: Why does it warn me about my browser?**
A: If you're viewing in an in-app browser (Google App, Facebook, Instagram, etc.), some features like PDF downloads may not work. Open in Safari, Chrome, Firefox, or Edge for full functionality.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Contributing

Contributions welcome! Please open an issue or submit a pull request on the [Marine Coders GitHub](https://github.com/marinecoders/dondocs).

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed guidelines.

---

## Support

- **Bug Reports** - [GitHub Issues](https://github.com/marinecoders/dondocs/issues)
- **Feature Requests** - [GitHub Issues](https://github.com/marinecoders/dondocs/issues)

---

*Built for Marines, by Marines. Semper Fidelis.*

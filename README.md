# Naval Correspondence Generator

> "The docs are done when the docs are done."

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![SECNAV M-5216.5](https://img.shields.io/badge/SECNAV-M--5216.5-blue)](https://www.secnav.navy.mil/doni/SECNAV%20Manuals1/5216.5%20DON%20Correspondence%20Manual.pdf)
[![MCO 5216.20B](https://img.shields.io/badge/MCO-5216.20B-red)](https://www.marines.mil/News/Publications/MCPEL/Electronic-Library-Display/Article/899678/mco-521620/)
[![NIST 800-171](https://img.shields.io/badge/NIST-800--171-green)](https://csrc.nist.gov/publications/detail/sp/800-171/rev-2/final)

**Naval Correspondence Generator** is a browser-based military correspondence generator that produces publication-quality documents compliant with **SECNAV M-5216.5** (Department of the Navy Correspondence Manual) and **MCO 5216.20B** (Marine Corps Supplement).

**All processing happens locally in your browser - no data is ever sent to any server.**

## Table of Contents

- [Key Features](#key-features)
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

## Key Features

### Publication-Quality Output
- **LaTeX-based PDF generation** via WebAssembly - pixel-perfect formatting impossible with typical web tools
- Professional typesetting that matches official military publications
- Consistent spacing, margins, and font handling per SECNAV specifications

### Comprehensive Data Libraries
- **3,139 military units** with full addresses, MCC codes, and organizational data
- **2,240 SSIC codes** from SECNAV M-5210.2 (August 2018)
- **107 regulatory references** across 12 categories (MCO, SECNAVINST, NAVADMIN)
- **74 office codes** (S-1, G-3, CO, XO, etc.) for signature blocks
- **50+ military ranks** (USMC and Navy, all grades E1-O10 plus Warrant Officers)

### Security-First Design
- **100% client-side processing** - nothing leaves your browser
- **PII/PHI detection** warns before download (SSN, EDIPI, DOB, medical info)
- **Digital signature fields** compatible with CAC/PIV cards and Adobe Acrobat
- **Classification markings** from Unclassified through TOP SECRET//SCI
- **CUI handling** with 10 categories and distribution statements
- **Portion markings** per-paragraph: (U), (CUI), (FOUO), (C), (S), (TS)
- **NIST 800-171 compliant** - works on air-gapped networks (SIPR/JWICS)

### 17 Document Types
- **Letters**: Naval, Standard, Business, Multiple Address, Joint
- **Endorsements**: Same-Page, New-Page (1st through 5th)
- **Memoranda**: MFR, Memorandum For, Plain Paper, Letterhead, Decision, Executive, Joint
- **Agreements**: MOA, MOU
- **Executive Correspondence**

### Export Formats
- **PDF** - Full-featured with enclosures, signatures, and classification markings
- **DOCX** - Editable Microsoft Word format
- **LaTeX** - Source files for advanced customization

---

## Getting Started

### Quick Start
1. Open the application in your browser
2. Select a document type from the dropdown
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

### Core Functionality
- **Real-time PDF Preview** - See your document as you type (1.5s debounce)
- **17 Document Types** - Letters, memoranda, endorsements, and agreements
- **SECNAV M-5216.5 Compliant** - Automatic formatting per Navy/Marine Corps regulations
- **PWA/Offline Mode** - Install as an app and work offline with cached TeX Live packages
- **Compliant vs Custom Modes** - Strict regulation mode or customizable fonts and formatting (see [Compliance Mode](#compliance-mode) for details)

### Document Management
- **Profiles System** - Save and reuse unit information and signature images
- **Template Library** - 38 pre-built letter templates for common correspondence
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
- **Copy To/Distribution** - Standard distribution list support
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

### Letters (5 types)
| Type | Description | Reference |
|------|-------------|-----------|
| Naval Letter | Standard letter on letterhead | SECNAV M-5216.5 Ch 2 |
| Standard Letter | Plain paper letter | SECNAV M-5216.5 Ch 2 |
| Business Letter | External correspondence | SECNAV M-5216.5 Ch 11 |
| Multiple Address Letter | Letter to multiple addressees | SECNAV M-5216.5 Ch 8 |
| Joint Letter | Letter from multiple commands | SECNAV M-5216.5 Ch 7 |

### Endorsements (2 types)
| Type | Description | Reference |
|------|-------------|-----------|
| Same-Page Endorsement | Endorsement on same page | SECNAV M-5216.5 Ch 9 |
| New-Page Endorsement | Endorsement starting new page | SECNAV M-5216.5 Ch 9 |

### Memoranda (7 types)
| Type | Description | Reference |
|------|-------------|-----------|
| MFR | Memorandum for the Record | SECNAV M-5216.5 Ch 10 |
| Memorandum For | USMC-specific "MF" format | MCO 5216.20B |
| Plain Paper Memorandum | Informal memorandum | SECNAV M-5216.5 Ch 12 |
| Letterhead Memorandum | Formal memorandum on letterhead | SECNAV M-5216.5 Ch 12 |
| Decision Memorandum | Action/decision format | SECNAV M-5216.5 Ch 12 |
| Executive Memorandum | Executive-level correspondence | SECNAV M-5216.5 Ch 12 |
| Joint Memorandum | Memorandum from multiple commands | SECNAV M-5216.5 Ch 12 |

### Agreements (2 types)
| Type | Description | Reference |
|------|-------------|-----------|
| MOA | Memorandum of Agreement | SECNAV M-5216.5 Ch 12 |
| MOU | Memorandum of Understanding | SECNAV M-5216.5 Ch 12 |

---

## Compliance Mode

Naval Correspondence Generator offers two modes for each document type:

### Compliant Mode (Default)
Enforces strict SECNAV M-5216.5 formatting rules. Certain features are locked or restricted based on the document type to ensure regulation compliance.

### Custom Mode
Unlocks all features for non-official use, drafting, or situations where deviation from regulations is acceptable. Custom mode allows:
- Any font size (10pt, 11pt, 12pt, 14pt)
- Any font family (Times New Roman, Arial, Courier)
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

### CUI Categories
Privacy, Proprietary, Legal, Law Enforcement, Export Control, Financial, Intelligence, Critical Infrastructure, Defense, Other

### Portion Markings
Apply per-paragraph markings: **(U)**, **(CUI)**, **(FOUO)**, **(C)**, **(S)**, **(TS)**

### PII/PHI Detection
Before downloading, Naval Correspondence Generator scans for:
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

### Editor Panel (Left)
- **Profile Bar** - Quick profile selector with unit lookup
- **Mode Toggle** - Switch between Compliant (strict SECNAV) and Custom (flexible) modes (see [Compliance Mode](#compliance-mode))
- **Document Type** - 17 correspondence formats with **Clear Fields** button to reset content while preserving letterhead
- **Letterhead** - Unit name, address, seal type
- **Addressing** - From, To, Via, Subject
- **Classification** - Security markings and CUI settings
- **Paragraphs** - Document body with 8-level hierarchy
- **References** - Auto-lettered with hyperlink support
- **Enclosures** - PDF attachments with cover pages
- **Copy To** - Distribution list
- **Signature** - Signatory information and image
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
- **pdf-lib** - PDF manipulation (enclosures, signatures, metadata)
- **docx** - Microsoft Word document generation
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

This application supports official military forms (NAVMC 10274, NAVMC 118(11), etc.) by overlaying text onto official PDF templates.

### Official Form Sources

**All form templates must be obtained from official sources:**

- **DoD Forms Management Program**: https://forms.documentservices.dla.mil
- **Navy Forms Online**: https://www.mynavyhr.navy.mil/References/Forms/

> ⚠️ **Important**: Do not create new form templates from scratch. Only official, pre-approved forms should be used to ensure compliance with regulations.

### XFA Forms and Flattening

Official military PDF forms are typically encoded using **XFA (XML Forms Architecture)**, an Adobe technology for dynamic forms. XFA forms have special characteristics:

- They contain embedded XML data structures
- They support dynamic form features (calculations, validations)
- They are **not compatible** with most PDF libraries (including pdf-lib)

**Before using a form template, it must be "flattened":**

1. **What is flattening?** Converting dynamic XFA form elements into static PDF content (text, lines, rectangles)
2. **Why flatten?** pdf-lib and most JavaScript PDF libraries cannot read or modify XFA content
3. **How to flatten?**
   - Adobe Acrobat Pro: Print to PDF or use "Flatten Form Fields"
   - Online tools: Various PDF flattening services (ensure no sensitive data)
   - Command line: `pdftk input.pdf output output.pdf flatten`

### Adding New Form Templates

1. **Obtain the official form** from https://forms.documentservices.dla.mil

2. **Flatten the PDF** to remove XFA encoding:
   ```bash
   pdftk official_form.pdf output flattened_form.pdf flatten
   ```

3. **Extract box boundaries** using the provided script:
   ```bash
   pip install pdfplumber
   python scripts/extract-pdf-boxes.py public/templates/your_form.pdf --save-image
   ```

4. **Review the annotated image** to verify detected boxes

5. **Create a generator** in `src/services/pdf/` using the smart box positioning system:
   ```typescript
   import { calculateTextPosition, type BoxBoundary } from './extractFormFields';

   const BOX_PADDING = { left: 3, top: 3 };

   const PAGE_BOXES: Record<string, BoxBoundary> = {
     fieldName: { name: 'fieldName', left: 100, top: 500, width: 200, height: 30 },
     // ... boxes from extract script
   };

   function getFieldPosition(boxName: keyof typeof PAGE_BOXES) {
     return calculateTextPosition(PAGE_BOXES[boxName], BOX_PADDING, FONT_SIZE);
   }
   ```

### Visual Box Editor (Recommended)

The easiest way to define box coordinates is with the visual editor:

```bash
# Open in browser
open tools/box-editor.html
```

1. Load your PDF template
2. Click "Draw Mode" and drag to create boxes
3. Name each box (e.g., `name`, `edipi`, `remarks`)
4. Copy the TypeScript code or export as JSON

This is a one-time setup per form template.

### Box Detection Script (Alternative)

The `scripts/extract-pdf-boxes.py` script can auto-detect boxes, but works best for forms with clear rectangles:

```bash
# Basic usage - auto-detect boxes
python scripts/extract-pdf-boxes.py template.pdf

# Save annotated image showing detected boxes
python scripts/extract-pdf-boxes.py template.pdf --save-image

# Adjust detection sensitivity
python scripts/extract-pdf-boxes.py template.pdf --min-size 5 --max-size 300

# Interactive mode for manual box definition
python scripts/extract-pdf-boxes.py template.pdf --interactive

# Save detected boxes as JSON config for manual editing
python scripts/extract-pdf-boxes.py template.pdf --save-config

# Load boxes from a JSON config file
python scripts/extract-pdf-boxes.py --config public/templates/NAVMC118.boxes.json
```

**Output includes:**
- Visual ASCII map of detected boxes
- JSON data with coordinates
- TypeScript code ready to paste into generators

### JSON Box Configuration

For forms where auto-detection doesn't work well (forms drawn with lines instead of rectangles), use a JSON config file:

```json
{
  "template": "NAVMC118_template.pdf",
  "description": "NAVMC 118(11) Administrative Remarks",
  "pageSize": { "width": 612, "height": 792 },
  "boxes": {
    "name": {
      "left": 148,
      "top": 142,
      "width": 206,
      "height": 16,
      "description": "Marine's name (LAST, FIRST MI)"
    },
    "edipi": {
      "left": 465,
      "top": 142,
      "width": 106,
      "height": 16,
      "description": "DOD ID Number / EDIPI"
    }
  }
}
```

**Existing configs:**
- `public/templates/NAVMC118.boxes.json` - NAVMC 118(11) Administrative Remarks
- `public/templates/NAVMC10274.boxes.json` - NAVMC 10274 Administrative Action

**Workflow for new forms:**
1. Run auto-detection: `python scripts/extract-pdf-boxes.py template.pdf --save-config`
2. Edit the generated `template.boxes.json` to fix field names and coordinates
3. Verify with: `python scripts/extract-pdf-boxes.py --config template.boxes.json`
4. Copy the TypeScript output into your generator file

### PDF Coordinate System

Understanding PDF coordinates is essential for accurate form filling:

- **Origin**: Bottom-left corner of the page (0, 0)
- **X-axis**: Increases to the right
- **Y-axis**: Increases upward
- **Units**: Points (72 points = 1 inch)
- **Letter size**: 612 × 792 points

```
(0, 792) -------- (612, 792)  ← Top of page
    |                |
    |                |
    |                |
(0, 0) ---------- (612, 0)    ← Bottom of page
```

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
```
dondocs/
├── tex/                          # LaTeX format templates (advanced)
│   ├── main.tex                  # Main template
│   └── templates/                # Document format templates (naval_letter, mfr, etc.)
├── public/
│   ├── attachments/              # Seal images
│   └── lib/
│       ├── PdfTeXEngine.js       # LaTeX engine
│       ├── latex-templates.js
│       └── texlive/              # TeX Live files
├── src/
│   ├── components/
│   │   ├── editor/               # Form components
│   │   ├── layout/               # Page layout
│   │   ├── modals/               # Modal dialogs
│   │   └── ui/                   # shadcn/ui components
│   ├── data/
│   │   ├── templates/            # Content templates (TypeScript) - add new templates here
│   │   ├── units/                # Unit directory
│   │   ├── ssic/                 # SSIC codes
│   │   └── references/           # Reference library
│   ├── hooks/                    # Custom React hooks
│   ├── lib/                      # Utility libraries
│   ├── services/
│   │   ├── docx/                 # Word generation
│   │   ├── latex/                # LaTeX generation
│   │   ├── pdf/                  # PDF processing
│   │   └── pii/                  # PII detection
│   ├── stores/                   # Zustand stores
│   └── types/                    # TypeScript types
├── index.html                    # Entry point
├── package.json                  # Dependencies
├── vite.config.ts                # Vite config
└── Makefile                      # Build commands
```

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
  - `copyto-config.tex` - Copy To/distribution list
  - `body.tex` - Document body paragraphs
  - `flags.tex` - Boolean flags for conditional sections

**3. Template System**

There are two types of templates:

**Content Templates** (`src/data/templates/`) - TypeScript files defining pre-filled document content:
- Award recommendations, personnel requests, administrative forms, etc.
- Define subject lines, paragraphs, references, and SSIC codes
- No LaTeX knowledge required - see `docs/CREATING_TEMPLATES.md`

**Format Templates** (LaTeX) - Define document layouts:
- `src/lib/latex-templates.js` contains all LaTeX templates as a JavaScript object
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
  - Merge enclosure PDFs with cover pages and page scaling
  - Add clickable hyperlinks for references and enclosures
  - Insert digital signature fields (CAC/PIV compatible)
  - Apply classification markings to enclosure pages (main letter markings handled by LaTeX)

**Key Files:**
| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app component, debounced preview (1.5s LaTeX, 500ms forms) |
| `src/services/latex/generator.ts` | Generates `.tex` files from store data |
| `src/services/latex/escaper.ts` | Escapes special LaTeX characters, wraps text |
| `src/lib/latex-templates.js` | All LaTeX templates (main + 17 document types) |
| `src/hooks/useLatexEngine.ts` | Manages SwiftLaTeX WebAssembly engine |
| `src/services/pdf/mergeEnclosures.ts` | Merges enclosures, adds hyperlinks and markings |
| `src/services/pdf/addSignatureField.ts` | Adds CAC/PIV digital signature fields |

**Debugging Tips:**
- Check browser console for LaTeX compilation errors
- Use `DONDOCS.texlive.summary()` in console to see TeX Live file requests
- Template loading issues: Verify file paths in virtual filesystem
- Content issues: Check `escapeLatex()` output for special characters

---

## NIST 800-171 Compliance

Naval Correspondence Generator is designed for information security:

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
A: Yes. Naval Correspondence Generator is a Progressive Web App (PWA). Click "Install" in your browser or use "Add to Home Screen" on mobile. Once installed, it works offline.

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

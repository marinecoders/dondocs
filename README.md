# LIBO-SECURED

> "Libo isn't secured until the paperwork is done."

[![SECNAV M-5216.5](https://img.shields.io/badge/SECNAV-M--5216.5-blue)](https://www.secnav.navy.mil/doni/SECNAV%20Manuals1/5216.5%20DON%20Correspondence%20Manual.pdf)
[![MCO 5216.20B](https://img.shields.io/badge/MCO-5216.20B-red)](https://www.marines.mil/News/Publications/MCPEL/Electronic-Library-Display/Article/899678/mco-521620/)
[![NIST 800-171](https://img.shields.io/badge/NIST-800--171-green)](https://csrc.nist.gov/publications/detail/sp/800-171/rev-2/final)

**LIBO-SECURED** is a browser-based military correspondence generator that produces publication-quality documents compliant with **SECNAV M-5216.5** (Department of the Navy Correspondence Manual) and **MCO 5216.20B** (Marine Corps Supplement).

**All processing happens locally in your browser - no data is ever sent to any server.**

---

## Why LIBO-SECURED?

| Feature | LIBO-SECURED | Competitor A | Competitor B |
|---------|:------------:|:------------:|:------------:|
| **Unit Database** | **3,139 units** | 3,688 entries* | 230 units |
| **SSIC Codes** | **2,240 unique** | 2,710 entries* | 2,240 codes |
| **Reference Library** | **107 references** | None | 107 references |
| **Letter Templates** | **38 templates** | 3 templates | 37 templates |
| **Office Codes** | **74 codes** | No | 74 codes |
| **Document Types** | **17 types** | 2 types | 3 types |
| **PDF Engine** | **LaTeX (publication quality)** | React-PDF | jsPDF |
| **DOCX Export** | **Yes** | Yes | Yes |
| **Digital Signature Fields** | **Yes (CAC/PIV)** | Yes (CAC/PKI) | No |
| **PII/PHI Detection** | **Yes** | No | No |
| **Classification/CUI/Portion Markings** | **Full support (6 levels)** | None | Limited (U/CUI/FOUO) |
| **Keyboard Shortcuts** | **10 shortcuts** | None | 8 shortcuts |
| **Dark Mode** | **Yes** | No | Yes |
| **Undo/Redo** | **Yes (50 levels)** | No | Yes (50 levels) |
| **Find & Replace** | **Yes** | No | No |
| **Batch Generation** | **Yes** | No | Yes |
| **Drag & Drop Reordering** | **Yes** | No | Yes |
| **Voice Recognition** | No | **Yes** | No |
| **EDMS Integration** | No | **Yes (Supabase)** | No |
| **PWA/Offline Mode** | No | No | **Yes** |
| **100% Client-Side** | **Yes** | Partial | Yes |
| **Air-Gap Compatible** | **Yes** | No | Yes |
| **Mobile Responsive** | **Yes** | Yes | Partial |

*\*Competitor A counts include duplicates. Actual unique data: 2,874 units, 2,144 SSIC codes. LIBO contains all unique Competitor A data plus 171 additional units.*

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

## Table of Contents

- [Getting Started](#getting-started)
- [Features](#features)
- [Document Types](#document-types)
- [Security & Classification](#security--classification)
- [User Interface](#user-interface)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Technology Stack](#technology-stack)
- [Development](#development)
- [License](#license)

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
- **Offline Capable** - Works entirely in your browser with no server required

### Document Management
- **Profiles System** - Save and reuse unit information and signature images
- **Template Library** - 38 pre-built letter templates for common correspondence
- **Reference Library** - 107 searchable military references with one-click insert
- **Unit Directory** - 3,139 units searchable by name, abbreviation, MCC, or location
- **Office Codes** - 74 standard military position codes for signature blocks
- **SSIC Lookup** - 2,240 codes searchable by number or description
- **Batch Generation** - Generate multiple documents using {{placeholder}} syntax
- **Find & Replace** - Search and replace text across your document
- **Undo/Redo** - 50-level history with keyboard shortcuts

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
Before downloading, LIBO-SECURED scans for:
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
| Theme | Toggle dark/light mode | - |

### Editor Panel (Left)
- **Profile Bar** - Quick profile selector with unit lookup
- **Document Type** - 17 correspondence formats
- **Letterhead** - Unit name, address, seal type
- **Addressing** - From, To, Via, Subject
- **Classification** - Security markings and CUI settings
- **Paragraphs** - Document body with 8-level hierarchy
- **References** - Auto-lettered with hyperlink support
- **Enclosures** - PDF attachments with cover pages
- **Copy To** - Distribution list
- **Signature** - Signatory information and image

### Preview Panel (Right)
- Real-time PDF preview
- Loading indicator during compilation
- Error messages for troubleshooting

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
- **Zustand** for state management
- **Tailwind CSS** with shadcn/ui components
- **dnd-kit** for drag and drop

### Document Generation
- **SwiftLaTeX** - WebAssembly LaTeX compiler for publication-quality PDFs
- **pdf-lib** - PDF manipulation (enclosures, signatures, metadata)
- **docx** - Microsoft Word document generation

### Data Processing
- **date-fns** - Military date formatting (4 Jan 26)
- **TipTap** - Rich text editing

---

## Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
```bash
cd web-react
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
libo-secured/
├── tex/                          # LaTeX source templates
│   ├── main.tex                  # Main template
│   └── templates/                # Document type templates
└── web-react/
    ├── public/
    │   ├── attachments/          # Seal images
    │   └── lib/
    │       ├── PdfTeXEngine.js   # LaTeX engine
    │       ├── latex-templates.js
    │       └── texlive/          # TeX Live files
    └── src/
        ├── components/
        │   ├── editor/           # Form components
        │   ├── layout/           # Page layout
        │   ├── modals/           # Modal dialogs
        │   └── ui/               # shadcn/ui components
        ├── data/                 # Units, SSIC, references
        ├── services/
        │   ├── docx/             # Word generation
        │   ├── latex/            # LaTeX generation
        │   ├── pdf/              # PDF processing
        │   └── pii/              # PII detection
        └── stores/               # Zustand stores
```

---

## NIST 800-171 Compliance

LIBO-SECURED is designed for information security:

- **Local Processing** - All data stays in your browser
- **No Server Communication** - Documents never leave your device
- **No Telemetry** - No tracking or analytics
- **Air-Gap Compatible** - Works on isolated networks (SIPR/JWICS)
- **CUI Support** - Proper marking for Controlled Unclassified Information

**Note:** Users are responsible for handling classified information according to their organization's security policies.

---

## FAQ

**Q: Does this work on NMCI computers?**
A: Yes. It's a standard webpage that works in any modern browser. No installation required.

**Q: Can I use this for classified correspondence?**
A: The tool formats documents but does not provide security controls for classified data. Use appropriate systems for classified information.

**Q: Is my data saved anywhere?**
A: Everything runs in your browser. Nothing is transmitted to any server. Data can be saved to browser localStorage.

**Q: Why LaTeX instead of jsPDF?**
A: LaTeX produces publication-quality output with proper kerning, ligatures, and typography that matches official military publications.

---

## License

MIT License - See LICENSE file for details.

---

## Contributing

Contributions welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/rchiofalo/libo-secured).

---

## Support

- **Bug Reports** - [GitHub Issues](https://github.com/rchiofalo/libo-secured/issues)
- **Feature Requests** - [GitHub Issues](https://github.com/rchiofalo/libo-secured/issues)

---

*Built for Marines, by Marines. Semper Fidelis.*

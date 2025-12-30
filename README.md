# libo-secured

**USMC Correspondence Generator** - A LaTeX template system for generating SECNAV M-5216.5 compliant military correspondence.

> *"Libo isn't secured until the paperwork is done."*

## Features

- **18 Document Types** - Naval letters, MFRs, memorandums, business letters, endorsements, and more
- **SECNAV M-5216.5 Compliant** - Proper formatting per DON Correspondence Manual
- **MCO 5216.20B Compliant** - Marine Corps supplement requirements
- **Modular Architecture** - Edit config files, not the template
- **Enclosure System** - Auto-numbered, hyperlinked PDF enclosures
- **CUI/Classification Support** - Proper markings per DoDI 5200.48
- **Web UI** - Browser-based generator with client-side compilation

## Supported Document Types

### Letters
- `naval_letter` - Standard Naval Letter (Ch 2)
- `standard_letter` - Standard Letter on Plain Bond (Ch 2)
- `business_letter` - Business Letter (Ch 11)
- `multiple_address_letter` - Multiple-Address Letter (Ch 8)
- `joint_letter` - Joint Letter (Ch 7)

### Endorsements
- `same_page_endorsement` - Same-Page Endorsement (Ch 9)
- `new_page_endorsement` - New-Page Endorsement (Ch 9)

### Memorandums
- `mfr` - Memorandum for the Record (Ch 10)
- `plain_paper_memorandum` - Plain-Paper Memorandum (Ch 10)
- `letterhead_memorandum` - Letterhead Memorandum (Ch 10)
- `decision_memorandum` - Decision Memorandum (Ch 10)
- `moa` - Memorandum of Agreement (Ch 10)
- `mou` - Memorandum of Understanding (Ch 10)
- `joint_memorandum` - Joint Memorandum (Ch 7)

### Executive Memorandums (HqDON/OSD)
- `standard_memorandum` - Standard Memorandum (Ch 12)
- `action_memorandum` - Action Memorandum (Ch 12)
- `information_memorandum` - Information Memorandum (Ch 12)

### USMC-Specific
- `mf` - "Memorandum For" (MCO 5216.20B)

## Quick Start

### Prerequisites

- TeX Live or MacTeX installed
- `pdflatex` in your PATH

### Usage

1. Clone this repository
2. Edit config files in `config/` folder:
   - `document.tex` - Document type, SSIC, From, To, Subject
   - `letterhead.tex` - Unit name and address
   - `signatory.tex` - Your signature block
   - `body.tex` - Document content
   - `references.tex` - Reference list
   - `enclosures.tex` - Enclosure list
3. Compile:
   ```bash
   make build
   ```
4. Output: `main.pdf`

### Web UI

Open `index.html` in your browser for a web-based generator with:
- Form-based input
- Live preview
- Client-side PDF compilation (SwiftLaTeX)
- No server required - all data stays local

## Configuration

### Document Type

In `config/document.tex`:
```latex
\setDocumentType{naval_letter}
```

### Letterhead

In `config/letterhead.tex`:
```latex
\setLetterhead
    {1ST BATTALION, 6TH MARINES}
    {6TH MARINE REGIMENT}
    {PSC BOX 20123}
    {CAMP LEJEUNE, NC 28542}
```

### Signature Block

In `config/signatory.tex`:
```latex
\setSignatory
    {John}          % First name
    {A.}            % Middle initial
    {Doe}           % Last name (auto-capitalized)
    {Sgt, USMC}     % Rank
    {Operations NCO} % Title
```

## File Structure

```
libo-secured/
├── main.tex              # Main template engine
├── Makefile              # Build commands
├── index.html            # Web UI
├── config/
│   ├── document.tex      # Document settings
│   ├── letterhead.tex    # Unit letterhead
│   ├── signatory.tex     # Signature block
│   ├── classification.tex # CUI/classification
│   ├── references.tex    # Reference list
│   ├── enclosures.tex    # Enclosure list
│   └── body.tex          # Document content
├── formats/              # Format modules (18 types)
├── enclosures/           # PDF enclosures (gitignored)
└── attachments/          # Seal, signature images
```

## References

- [SECNAV M-5216.5](https://www.secnav.navy.mil/doni/SECNAV%20Manuals1/5216.5.pdf) - DON Correspondence Manual
- MCO 5216.20B W/ADMIN CH-4 - Marine Corps Correspondence Manual
- DoDI 5200.48 - CUI Marking Requirements

## Security Note

This tool processes data **client-side only**. When using the web UI:
- Form data stays in your browser
- PDFs are generated locally
- Nothing is sent to any server

Safe for CUI when used on authorized systems.

## License

Public Domain - Created for use by DoD personnel.

---

*Semper Fidelis*

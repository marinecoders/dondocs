# Known Issues

## Resolved

### SwiftLaTeX Dollar Sign (`$`) Rendering

**Resolved:** February 2026

SwiftLaTeX lacks TS1 encoding fonts, so `\$` fails with a missing `tcrm1200` TFM error. Fixed by using `{\char36}` (OT1 position 36 in Computer Modern). The escape chain uses placeholder tokens (`ZZZDOLLARZZZ`, etc.) so that `{`/`}` escaping doesn't re-escape the braces introduced by the replacement.

**Files:** `src/services/latex/escaper.ts`, `src/services/latex/flat-generator.ts`

### DOCX Classification Header/Footer Markings

**Resolved:** February 2026

Pandoc ignores `\fancyhead`/`\fancyfoot` LaTeX commands, so classification markings didn't appear in DOCX output. Fixed by post-processing the DOCX with JSZip to inject `word/header1.xml` and `word/footer1.xml` with centered bold marking text, wired via `[Content_Types].xml`, `document.xml.rels`, and `sectPr` references.

**Files:** `src/services/docx/pandoc-converter.ts`, `src/App.tsx`

---

## Open

### DOCX: Page Numbering Position Not Controllable

Pandoc ignores `\fancyfoot[R]{\thepage}`, so page number position is determined by `reference.docx`. Suppressing page numbers (`\pagenumbering{gobble}`) works, but position (right/center/left) and custom start page (`\setcounter{page}{N}`) cannot be controlled.

**Potential fix:** Post-process `word/footer1.xml` to position the page number field code.

**Files:** `src/services/latex/flat-generator.ts`, `public/lib/pandoc/dondocs.lua`

---

## Open (By Design)

These are inherent limitations of the LaTeX-to-DOCX pipeline via pandoc and cannot be fixed without significant architectural changes.

### DOCX: Signature Images

Pandoc cannot reliably position `\includegraphics` within signature table cells. Users must manually insert signature images after downloading.

### DOCX: Digital Signature Fields

PDF AcroForm signature fields have no DOCX equivalent via pandoc. Users should sign using Word's built-in digital signature feature (File > Info > Protect Document > Add a Digital Signature).

### DOCX: Reference URL Hyperlinks

`\href` inside `tabular` environments is unreliable in pandoc's DOCX writer. Users can manually add hyperlinks to reference titles after downloading.

### DOCX: Enclosure File Merging

PDF-to-PDF merging is straightforward, but appending PDF pages to a DOCX is not possible in-browser. Users must attach enclosure files separately.

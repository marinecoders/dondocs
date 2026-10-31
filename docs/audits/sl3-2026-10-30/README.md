Current implementation corrections and proof are recorded in [FIX_VERIFICATION.md](FIX_VERIFICATION.md), `fix-verification.json` and `verified/`. The following description of defects and original observations refers to the historical baseline, not the corrected output.

# SL-3 audit evidence

The [document checklist](../../SL3_DOCUMENT_CHECKLIST.md) records the audit of code baseline `51ba175d`, excluding Times New Roman font-family embedding. No application code was changed by this audit package. All fixtures are synthetic.

`checklist-evidence.json` contains the source manifest/hashes, 648 checklist entries (including 299 numbered entries from sections 1-6, with mandatory appendices assessed separately), source comparison results and observations from seven fresh production exports. Repeated rows can refer to the same finding; counts are not counts of independent defects or a compliance score.

## Reproduce the export observations

From the repository root, with its installed development dependencies:

```sh
npx vite-node --config vitest.integration.config.ts docs/audits/sl3-2026-10-30/reproduce.mts
```

The command prints a temporary output directory. It exercises eight inputs: seven PDFs, their exact synthetic inputs and validation results, plus the intentionally rejected unreviewed raster. No real publication is read or overwritten. Inspect that directory with Poppler and Python (`pdfplumber`, `pypdf`):

```sh
python3 docs/audits/sl3-2026-10-30/verify.py /absolute/path/printed-by-the-command
```

At the audited revision, both CUI cases validate but `NOFORN_in_pdf` is false. In `raster-text.pdf`, the visible `VALVE INLET` label is not searchable. Ordinary preface headers lack the date, navigation title text lacks underline strokes, and the abbreviation list omits fixed authentication terms. Authentication is nominal 12 pt; its corresponding source bodies render at 10 pt. The source cover-nomenclature placeholder is 10 pt; the generated nomenclature is nominal 14.4 pt. Generated figure/table captions also use a one-em separator (`quad`) instead of the required two spaces. TeX points differ slightly from PDF big points.

The tests below pass at the baseline despite those findings. They establish useful layout/navigation properties, not exhaustive compliance:

```sh
npx vitest run --config vitest.integration.config.ts tests/integration/sl3-render.test.ts tests/integration/sl3-companion.test.ts
```

The new audit reran all 19 cases successfully. Earlier full CI results belong to the code baseline; the checklist does not turn them into acceptance evidence for arbitrary author-entered content.

## Source inspection

All desktop filenames/identities are in the evidence manifest. The supplied standard matches the repository PDF byte for byte. DOCX inspection joined text runs, resolved active section/header/footer relationships and inspected control choices and grids. All 19 fixed narrative/note word sequences match both SL-3 sources. This comparison does not claim identical punctuation or page layout.

Source point sizes were checked using rendered source DOCX pages. The PCN source placeholder is 10 pt even though written instruction 37 explicitly requires 12 pt; the checklist records that difference and follows the written instruction for the PCN check. It does not automatically treat every placeholder style as controlling over explicit instructions or normative standard text.

The checklist distinguishes seven confirmed output/source-fidelity gaps from conditional delivery gaps, actual source conflicts and equipment-specific/organizational review. It does not assume that every conditional feature is required for every SL-3, or that lack of an editor control waives the underlying requirement.

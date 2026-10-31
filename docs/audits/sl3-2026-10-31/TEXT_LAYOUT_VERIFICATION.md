# Generated-document text collision check

The abbreviation list had a confirmed collision: the fixed term COMMARCORSYSCOM extended beyond its 0.9-inch column and overlapped the start of its definition. The prior fixed-term completion did not account for that term's printed width. `abbreviations-before.png` preserves the reproduced failure.

The term column is now measured from the actual marked terms at the document font size, with a two-point allowance and a separate twelve-point gutter. Its width is capped at forty percent of the text area so definitions retain useful space. Ordinary words keep their normal shaping; an oversized token can wrap without inserting a printed hyphen. Rows grow vertically with their content and have additional separation. Continued pages receive a continuation heading. A single definition too tall for a page is refused with a specific layout error.

The broader inspection also added separation between rotated optional-column labels and their column numbers. Original inventory column widths and text sizes are retained.

## What was checked

Four production PDFs cover portrait and widened inventory layouts, with ordinary data and classified synthetic stress data. The stress cases combine:

- Long abbreviation terms, long definitions, an unbroken identifier and an escaped ampersand/symbol entry.
- Long nomenclature, issuing-command and signatory fields, plus seven cover rows to exercise continuation.
- Extended technical data, special notes and linked item-note references.
- Both optional inventory columns, longer model/reference-designator values and longer item descriptions.
- Separate illustration labels and a longer figure caption.

The PDF inspection reads text positions and font ascent/descent from the exported PDF. It checks intersecting text runs and text-area bounds on **every page**. It first proves that it detects the original two-column collision on an independent PDF fixture. It also verifies a clear gap after COMMARCORSYSCOM and confirms that long custom terms/identifiers retain their characters after wrapping. These are conservative text-box checks, not OCR of raster artwork; identical text overprints are deduplicated.

All four checked outputs have zero detected text collisions. Ordinary output has approximately 13.95 PDF points between COMMARCORSYSCOM and its definition. The long-term cases widen the term column further. `text-overlap-verification.json` contains the exact synthetic inputs, output identities, measurements and tested source hashes. Corrected ordinary and long-entry pages are included as PNGs.

## Reproduce

```sh
npx vitest run --config vitest.integration.config.ts tests/integration/sl3-text-layout.test.ts tests/integration/sl3-companion.test.ts tests/integration/sl3-render.test.ts tests/integration/sl3-filled-layout.test.ts
```

All 30 focused layout tests pass. The six collision tests include the independent detector check, four full-document cases and refusal of an oversized definition. The 3,240-test unit/component coverage run, lint, application build and Companion builds also pass. Rendered ordinary and stress abbreviation pages were visually inspected after these changes.

Test exports remain in temporary directories named `dondocs-sl3-text-layout-*`; each contains the PDF and a `case.json` with its exact synthetic input. The oversized-definition refusal uses a separate temporary directory. No real program data or actual certificate signatures are used.

This supplements the [full checklist](../../SL3_DOCUMENT_CHECKLIST.md) and the [completed-field verification](README.md). Actual author data and artwork still require the applicable final-publication review. This is not a claim to certify every possible future input or resolve the checklist's unrelated delivery/profile requirements.

# Publication Word qualification

Technical-manual front matter, I-Type instructions, SL-3, SL-4 and Technical
Volumes use the native DOCX renderer. Use this workflow to qualify an exact
renderer for production use. Native Microsoft Word field update and
edit/save/reopen remain pending.

## Generate exact inputs

Use an output directory outside the repository. Generation retains each DOCX,
its source JSON, asset digests and the transitive renderer/fixture source graph.
The optional final argument selects `manual`, `instruction`, `sl3`, `sl4`
or `volume`. Omit it to generate the entire set. The instruction and volume
fixtures include long tables to inspect continuation rows and repeating headers.

```sh
npx vite-node --config vitest.config.ts scripts/generate-publication-word.mts /absolute/path/publication-word
npx vite-node --config vitest.config.ts scripts/verify-publication-word.mts /absolute/path/publication-word
```

Regenerate after changing an input. Do not replace a retained source with a
newer DOCX while keeping its old printed PDF.

## Retain actual renderer prints

Open each exact generated DOCX in the chosen Microsoft Word version. Inspect
every page, update contents/page-reference fields, and retain its PDF print as
`FIXTURE-microsoft-word.pdf` beside the DOCX. Confirm the source association;
PDF Creator metadata cannot prove which source was printed. Record the Word
and operating-system versions with screenshots and the test result.

```sh
npx vite-node --config vitest.config.ts scripts/qualify-publication-word.mts /absolute/path/publication-word microsoft-word 16.105.3
```

The command verifies source receipts, requires Word creator metadata, checks
every printed page against the source section sizes, rejects text outside page
bounds, and checks required content and unresolved publication references.
Required text tolerates whitespace changes and hyphenated identifiers wrapping
across lines. It does not require matching PDF/Word pagination. A successful run
atomically writes `microsoft-word-renders.json` with exact source and print
digests, page/word counts and renderer version.

For an independent LibreOffice check, retain each print as
`FIXTURE-libreoffice.pdf` and select `libreoffice VERSION`. The command requires
LibreOffice producer metadata and writes a separate `libreoffice-renders.json`.
That evidence does not count as a Microsoft Word pass.

## Complete the human checks

The measured receipt explicitly leaves native edit/save qualification false
and visual review required. Check every page for clipping, overlap, missing
images, readable table columns and row/header continuation. Verify page fields,
linked contents and cross-references resolve in the target Word environment.
Make a synthetic change, save, close, reopen and confirm content, images and
links survive. Repeat for each family and target environment before treating
that environment as qualified.


## November 2026 LibreOffice run

Thirteen freshly generated DOCXs produced 85 pages in LibreOffice Writer
26.8.0.0 alpha. The measured checks covered all five publication families,
including long instruction and Technical Volume tables. The remaining
stock-list page fields matched the page numbers at their linked destinations.

Use the issued review copy workflow only with an editor qualified to preserve
its review markers. A LibreOffice DOCX resave of a synthetic issued review
copy preserved its paragraph bookmark and removed its custom XML review
identity. DonDocs requires the identity to match the retained issue receipt.

## Check printed contents labels

The measured receipt lists the requested page-label format, the label printed
in the contents, and the footer at the PDF link's destination. Review rows
with missing or ambiguous labels, incorrect formats, mismatched values, or
unresolved destinations. Use a PDF export that preserves internal links when
the print route omits them. Confirm link destinations against the intended
headings in the renderer.

A fresh 12-document LibreOffice run found 15 wrong-format entries across both
SL-3 fixtures and the SL-4 fixture. For example, the SL-3 portrait contents
printed `PREFACE … 3` while the target page footer used `iii`. The affected
source fields requested lowercase Roman labels. The affected front-matter
entries now use hyperlinks without page fields. Stock-list body entries
still use decimal page fields. The Technical Volume uses linked contents
without page fields.

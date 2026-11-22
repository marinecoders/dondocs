# Publication Word qualification

Technical-manual front matter, I-Type instructions, SL-3 and SL-4 have native
DOCX renderers. Their browser capabilities remain disabled pending native Word
layout, field-update and edit/save qualification. Generating an OOXML package,
passing these measurements or printing it in LibreOffice does not enable them.
Full-volume DOCX is not implemented by this renderer.

## Generate exact inputs

Use an output directory outside the repository. Generation retains each DOCX,
its source JSON, asset digests and the transitive renderer/fixture source graph.
The optional final argument selects `manual`, `instruction`, `sl3` or `sl4`;
omitting it generates the entire set. The instruction fixtures include a long
table to inspect continuation rows and repeating headers.

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
links survive. Repeat for each proposed family and target environment before
changing its capability. A family with a pending check remains disabled.


## November 2026 LibreOffice run

Twelve freshly generated DOCXs produced 71 pages in LibreOffice Writer
26.8.0.0 alpha. The measured checks passed for technical-manual front matter,
I-Type instructions, SL-3 and SL-4, including the long instruction table.
The native Microsoft Word edit, save, reopen and field-update checks remain
pending for all four families. Keep their publication DOCX capabilities gated.

Use the issued review copy workflow only with an editor qualified to preserve
its review markers. A LibreOffice DOCX resave of a synthetic issued review
copy preserved its paragraph bookmark and removed its custom XML review
identity. DonDocs requires the identity to match the retained issue receipt.

## Check printed contents labels

The measured receipt now lists the page-label format requested by each linked
contents row and the label extracted from the corresponding headed list in
the actual print. Review rows
reported as missing, ambiguous or wrong-format. This check covers printed
label formats. Confirm each label's value and link destination in the renderer.

A fresh 12-document LibreOffice run found 15 wrong-format entries across both
SL-3 fixtures and the SL-4 fixture. For example, the SL-3 portrait contents
printed `PREFACE … 3` while the target page footer used `iii`. The affected
source fields requested lowercase Roman labels. Native Word field update,
layout and edit/save qualification remain pending.

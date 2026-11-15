# Word layout qualification

Word and PDF use different layout engines. Matching content, usable document structure, measured positions, and identical pagination are separate expectations. Passing an XML assertion or producing a DOCX does not establish how Microsoft Word lays it out.

## Measured scope

On 15 November 2026 UTC, synthetic outputs were opened in Microsoft Word for Mac 16.105.3 on macOS 27.0.1 and rendered through Word's Print > PDF workflow. Source DOCXs used the production prepared correspondence renderer and post-processing with native Pandoc 3.13; comparison PDFs used pdfTeX 1.40.29 (TeX Live 2026). All four fixtures were qualified through native Pandoc. The deep naval fixture was also imported and downloaded through the normal Chromium browser UI and vendored Pandoc WASM, then opened and printed in the same Microsoft Word version. Both paths produced three pages and passed the geometry and content checks. The manifest identifies each source pipeline.

| Fixture | Content inspected | Native PDF pages | Word pages |
| --- | --- | --- | --- |
| `naval-deep` | Twelve long references, six paragraph levels, wrapped lines, continuation subjects, page numbers | 3 | 3 |
| `naval-long-references` | Twenty-four long reference cells flowing across pages without lost or repeated entries | 2 | 2 |
| `business-figure` | PNG diagram and caption, wrapped paragraphs, single uploaded signature | 2 | 2 |
| `joint-senior` | Thirteen paragraphs, two signer blocks, one image explicitly assigned to the senior party | 2 | 2 |

The deep fixture intentionally has one child at each nesting level and triggers normal paragraph advisories. It is a geometry stress fixture, not a conforming-letter example; its browser export explicitly acknowledges those advisories with Download anyway.

All unique fixture markers survived Word printing. On the naval fixture, deep paragraph text positions differed from native PDF by less than 2 pt; wrapped lines returned within 1 pt of the 72 pt left margin. Continuation page numbers were 2 and 3. Matching page counts on these inputs does not imply matching line breaks or page contents.

## Corrections demonstrated in Word

An image-only table row was incorrectly treated as an empty spacer and constrained to exactly 12 pt. Actual Word printing clipped a 27 pt signature to a narrow slice. Rows containing drawing content now retain their natural height; truly empty address spacer rows keep their 12 pt spacing. The source regression checks both single-signer and explicitly selected dual-signer images.

Figures also advanced Word's body paragraph counter. In the Custom business-letter fixture, native PDF continued with paragraph 3 after Figure 1, while Word skipped to paragraph 4. Word now excludes figures from body counters and ancestor tracking. Fresh native Pandoc and browser WASM downloads printed in Word retain body labels 1 through 8, the separate Figure 1 caption, and the complete signature image across two pages. Compliant business-letter body paragraphs remain unnumbered.

Unmarked continuation headers also started too high. The 12 pt Times New Roman fixture gave these glyph positions, measured from the top of the sheet:

| Position | Word before | Word after | Native PDF |
| --- | --- | --- | --- |
| Continuation subject top | 45.22 pt | 60.82 pt | 61.35 pt |
| First continuation body line top | 72.82 pt | 88.42 pt | 89.60 pt |

The subject lead-in now uses two font-size lines below the header origin. A separate blank paragraph still supplies the clear line below the subject, allowing a wrapped subject to grow. Marked headers retain their existing placement.

The qualification rejected the retained pre-correction Word render for its 45.22 pt header position, then passed the corrected actual Word render. The ordinary compile test does not claim to run Word when no Word-rendered PDFs have been supplied.

## Reproduce

Install the native prerequisites in [the test guide](../tests/README.md). Generate fresh synthetic DOCX/PDF pairs into a directory outside the repository:

```sh
DONDOCS_WORD_LAYOUT_ARTIFACTS=/absolute/path/word-layout \
  npm run test:integration -- tests/integration/word-layout-qualification.test.ts
```

Open each DOCX in the selected Microsoft Word version. Inspect every page, then use Print > PDF to retain `naval-deep-word.pdf`, `naval-long-references-word.pdf`, `business-figure-word.pdf`, and `joint-senior-word.pdf` alongside the generated native PDFs. Use synthetic author metadata and retain the generated manifest with the exact source digests.

After confirming that each Word PDF came from its retained DOCX, stamp the exact Word PDF digests into the manifest. Stamping also verifies the original DOCX and native PDF digests, and requires Word creator metadata. It does not establish source association by itself.

```sh
npx vite-node --config vitest.config.ts scripts/stamp-word-layout.mts /absolute/path/word-layout
```

Run the actual rendered-output assertions:

```sh
DONDOCS_WORD_RENDERED_DIR=/absolute/path/word-layout \
  npm run test:integration -- tests/integration/word-layout-qualification.test.ts
```

This requires and verifies the DOCX, native PDF, and Word PDF digests, checks Word creator metadata and Letter page size, asserts each marker occurs exactly once and all fixture page counts match, and checks deep paragraph geometry, continuation-header and body positions against native output, wrapped-line margins, and continuation page numbers. Retain tool versions, source manifest, Word PDFs, screenshots, and the test result together. Review the pages visually as well: creator metadata and bounding boxes alone cannot establish that an image is complete or every layout is usable.

## Qualify the browser Word path

Use a separate copy of the retained fixture directory to preserve the native qualification. Download the same deep fixture through the normal browser UI:

```sh
DONDOCS_BROWSER_WORD_LAYOUT_ARTIFACTS=/absolute/path/browser-word-layout \
  npm run test:browser -- tests/browser/word-layout-qualification.spec.ts --project chromium
```

The test retains the exact `naval-deep-browser.docx` and `browser-source.json` receipt. Open that browser download in Word, print it as `naval-deep-word.pdf`, then bind the browser source and actual print to the existing native comparison set:

```sh
npx vite-node --config vitest.config.ts scripts/stamp-word-layout.mts /absolute/path/browser-word-layout --browser-naval
DONDOCS_WORD_RENDERED_DIR=/absolute/path/browser-word-layout \
  npm run test:integration -- tests/integration/word-layout-qualification.test.ts
```

The manifest keeps the browser filename and source digest separate from the native DOCX, and the same continuation geometry, exact token, and page-count checks run against the browser-origin Word print. This does not qualify every browser or substitute a native conversion for browser WASM.

## Remaining boundaries

- Other Word versions, Windows, Word for the web, alternative fonts, and additional document families need their own target-renderer qualification.
- Marked-header geometry and arbitrary long/multiline subjects have not received new target-renderer qualification in this pass.
- Exact line wrapping and general page-for-page parity remain open. These four examples are a bounded measurement set.
- Publication DOCX, rich Word import, and independent images for both parties remain separate capabilities.
- Browser Word downloads have their own production-browser tests; a native Pandoc pass does not substitute for WASM conversion coverage.

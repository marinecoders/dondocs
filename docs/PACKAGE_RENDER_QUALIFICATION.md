# Saved package render comparison

A retained PDF is recovered by downloading its exact saved bytes. Comparing a new
rendering is a separate, explicit action. In **Packages**, select the saved
revision, choose **Check readiness and assemble**, review the included members and
retain a new PDF. Then choose an earlier and later saved PDF under **Compare saved
renderings**, review the package and run the comparison. Both PDFs and the
separate original files remain saved. A comparison does not replace an output,
advance the package revision or certify a package for signature.

## What the comparison measures

The two selected outputs must belong to the same exact preserved package revision.
The comparison independently reports:

- SHA-256 identity of their actual PDF bytes, after verifying saved checksums.
- Extracted text grouped into lines using the existing PDF review helper.
- Text item strings, transforms, widths, heights and line-ending flags. Coordinates
  are rounded to 0.001 PDF units; text item grouping changes can also differ.
- Visible page boxes, page rotation and user-unit geometry, in page order.
- Preserved member boundaries, first-page labels and numbering modes.
- Recorded input fingerprints and renderer resource identifiers, when present.

These observations do not compare raster appearance, image content, drawing color,
font glyph appearance, annotations or every PDF page box. Matching text and geometry
with different bytes is still a different PDF. A PDF with no extractable text has
unavailable text checks; scanned or graphical pages need visual review. Missing or
unreadable inputs, invalid checksums and inconsistent recorded input fingerprints
stop the operation. Member boundaries are checked against the preserved metadata
and PDF page count; the check does not infer document semantics from page images.

## Provenance and availability

New retained outputs record the exact revision input fingerprint, application and
source versions, template revision, package assembly/export contract and PDF library.
A release build additionally records its existing immutable runtime identifier,
which covers the deployed renderer/font resources. Development or regular builds
without that identifier report renderer resources as unavailable.

The input fingerprint covers revision identity, ordered members, their roles,
labels and required flags, native draft checksums, captured template checksums and
original PDF checksums. Source document pointers and earlier outputs do not affect
it. Existing output records without structured provenance remain importable and
downloadable. Their provenance checks report unavailable; a freeform renderer
string is not promoted to proof of compatibility. Build/resource information is
self-reported comparison context, not an authenticated sender attestation.

A new render uses the current deployment and its available resources with the
preserved inputs and templates. Missing resources block rendering. DonDocs does
not archive or launch arbitrary historical engines, Word versions or font sets.
Comparisons neither authorize a restricted deployment nor bypass the package
member/export review. Review and completion require the same current deployment
policy; a changed package sequence or cancelled operation cannot publish a result.

## Bounds

Before preparing a comparison, the workspace limits the **sum of every retained
PDF in the selected revision to 25 MB**, because preparation verifies and reviews
all saved outputs. Thus an unrelated third saved PDF can put a revision above the
review limit. Individual saved downloads remain available. The lower-level pair
comparison also enforces 25 MB across its two copied inputs.

Each inspected output is limited to 500 pages, 200,000 extracted text items, two
million text characters and 45 seconds. Extraction is streamed and the PDF worker
is destroyed on success, cancellation or failure. Results hold fingerprints and
observations rather than extracted document text. The ordinary package/resource,
storage and portable transfer limits still apply.

## Reproducible cross-release qualification

`tests/fixtures/package-render/baseline-1.3.98.dondocs-package.json` contains only
synthetic training content. It was created using the actual production release
build at source `ef36b64c1efd486609c6a1238ea1fc89ee6ea078` (version 1.3.98), through
Chromium's package capture, original-file upload, assembly, download and editable
export controls. Reloading and downloading again preserved the retained PDF.
The adjacent receipt records its source, renderer context and checksums.

`tests/browser/package-render-comparison.spec.ts` imports that artifact into the
current application, downloads the original retained PDF, explicitly re-renders
its unchanged revision, compares the two, reloads, transfers the editable package
to a fresh browser context, compares again and checks both the original-file and
retained-output digests. The current output's actual application version is
recorded in its test attachment. This qualifies the observed synthetic fixture
across those two application builds; it does not establish general visual parity.

The same browser suite creates real PDF negative controls for metadata, vector
color, font widths, text, text positions, page size, rotation, crop and absent text.
Those cases exercise the application's actual PDF.js extraction and review UI.
Metadata-only and vector-only changes must remain byte differences even when the
observed text/geometry checks match. Unit and component cases additionally cover
bounds, invalid positioning, inconsistent inputs, corrupted saved bytes, legacy
records, private captured-byte ownership and cancellation.

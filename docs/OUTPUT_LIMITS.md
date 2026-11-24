# Output limits

See the [capability matrix](CAPABILITIES.md) for current format availability.

## Attached PDFs

Basic-letter and enclosure assembly keep ordinary PDFs as PDF pages. A readable
permission-protected PDF requires confirmation when attached: its assembled pages
are images. Enclosures with printable annotations or form fields also require
confirmation before their printed appearances are flattened into page images.
Hidden, invisible and non-printing annotations, and ordinary link metadata, do
not trigger this conversion. Printable links with saved appearance streams do
trigger conversion so their graphics are preserved. The print view includes printable NoView
annotations. Ordinary basic letters retain their vector pages and annotation
appearances when copied. Selectable text, interactive fields and certificate signatures do not
carry into that derivative; the exact uploaded original remains in the draft and
portable files. Files requiring an opening password must first be exported as a
readable copy in a PDF application. Unreadable required content blocks complete
export rather than being silently omitted.
Valued printable form widgets without saved appearances, or with appearances
requiring regeneration, must first be saved or printed as a flattened PDF in a
PDF application. Empty unsigned fields and zero-area signature metadata do not
trigger that rejection. Encrypted forms can also have appearance metadata that
cannot be verified; a valued printable field then requires an unprotected,
flattened copy even when another viewer displays it correctly. Already-parsed
indirect form metadata can qualify a saved appearance; encrypted compressed
metadata remains unsupported when its appearance state cannot be established.
PDFs with nonempty XFA packets also require a flattened
copy; the renderer keeps XFA and script execution disabled. Unsupported forms
are rejected rather than risking blank field values or static fallback pages.

Attached PDFs also receive a bounded compression check of page content, reachable
resources and annotation appearances. It permits 10,000 resources, 64 levels of
nesting, eight compression stages, 64 MB of decoded data per stream, 128 MB across
the document and 15 seconds of validation. These limits apply to ordinary and
protected sources. Supported compression is checked recursively. JPEG headers
are bounded before a decode check; their encoded bytes remain unchanged in
vector copies. Other native image codecs remain opaque on the vector path.
Image-copy preparation checks per-page decoded image dependencies and rejects
failed images even if the rendering engine reports the page render complete.
These checks do not establish visual equivalence. Review assembled pages before sending them.

Sources requiring image copies are limited to 25 MB and 50 pages, with at most 40 million source
image pixels. Preparation uses at most 4 million pixels per page, 32 million pixels
across the document, 32 MB of encoded page images and 45 seconds. Split a source or
export an unprotected, flattened copy when those limits are reached. These limits apply to
embedded basic letters and enclosures; standalone original files in packages keep
their separate validation requirements.

## Tagged PDF output

**Download → Tagged PDF (experimental)** supports unclassified correspondence with explicit table column headers and body-image alternatives. The [tagged PDF guide](TAGGED_PDF.md) lists the supported formats, including Memorandum for the Record and Memorandum For. The exporter validates the saved structure and content associations before delivery. Native screen-reader qualification and PDF/UA conformance remain unestablished. Recipient ZIPs can include separate tagged PDFs and unchanged original files.

## Word output

- One PNG signature image can be embedded in supported correspondence. Dual-signer documents require an explicit junior or senior selection; the image is placed on that party only and the other remains unsigned. Information memoranda place it with the FROM sender. These dual-signer and information-memorandum placements are Word-only; PDF output does not include them. Two independent uploaded signatures are not supported. Images are visual signatures, not certificate signatures.
- Custom business letters can add PNG/JPEG figures through the paragraph block menu. Their images and captions are retained in PDF and Word, including after a mode switch. Word images are limited to 10 MB and 40 megapixels each. Missing or unreadable images stop Word export; PDF figure attachments require conversion to PNG/JPEG for Word. Publication Word output uses a separate native renderer and accepts PNG/JPEG figures in supported profiles. Its layout can paginate differently from PDF.
- PDF signing fields are not emitted into Word. Use Word's signing workflow separately.
- Reference titles with valid URLs are clickable in Word. The hyperlink checkbox controls PDF links separately.
- Uploaded enclosure PDF pages remain separate by default. The optional browser image mode appends visual copies; originals remain unchanged. **Packages → Review Word package** delivers supported correspondence DOCXs with unchanged separate originals, a readable file list and SHA-256 manifest. Every listed enclosure must have its captured file; missing or corrupt content blocks complete delivery. Forms and publications retain their existing Word restrictions.
- Word and PDF use different layout engines, so pagination and placement can differ.

Word package ZIPs are limited to 512 payload files and 200 MB compressed/expanded size, with at most 25 MB per DOCX. Captured inputs also follow saved-package limits: 25 MB per original/native draft (including its embedded files), 75 MB of portable resources, 256 resources and 100 MB of serialized native input. Each Word image retains its separate 10 MB/40 megapixel limit. Labels retain Unicode in the manifest; generated archive names are bounded and safe to extract on common desktop filesystems. Individual PDF/DOCX downloads keep their existing clean output.

Flat TeX downloads contain text and graphic references, not the image bytes. Supply the selected signature as `signature.png` and business figures as `figure-1.png`, `figure-2.jpg`, and so on beside the downloaded file. PDF rendering uses its own attachment paths; copying a PDF rendering directory alone does not assemble a complete flat-TeX project.

## Form templates and stored assets

Configured forms require a valid definition and its exact PDF template revision.
Current draft JSON, workspace backups and encrypted handoffs include the captured
definition, editable answers and exact blank PDF pages. Import verifies their
digests and geometry and retains required bytes before opening a new copy.
Older files without template resources may require a connection and **Save for
offline use** after restoration. Browser storage can be evicted; keep an external
copy containing the templates or a separately exported filled PDF.

New document signatures retain durable attachment references and inline image
fallbacks. Supported older readers can preserve the inline image even if they
do not recognize its reference. Reference-only records receive a fallback when
the asset can be read; missing image bytes cannot be reconstructed. Read the
[signature compatibility boundary](STORAGE.md#document-signature-assets) before
using an older tab or rolling back.

## Review comments

Native correspondence comments travel in supported draft, share, and backup formats. They are excluded from clean PDF/DOCX output and are not emitted as Microsoft Word review annotations. Forms, technical publications, proposed edits, review-return merging, and authenticated approvals are not part of the document/field comment release. See [comment reader compatibility](STORAGE.md#review-comment-reader-compatibility).

Paragraph discussions attach to whole native paragraphs. Each captured paragraph context is limited to 20,000 characters; text-range anchoring is not provided. Deleted or absorbed paragraphs retain detached discussions until they are deliberately deleted or their original paragraph is restored.

## Saved action packages

Packages support existing native correspondence and form PDF renderers plus
original PDF files. Roles do not add new native document families. Native
endorsement chains require a matching native main-document identity, ordinal and
reference/enclosure continuation; unsupported or contradictory chains block
readiness. Package enclosure references are checked as unambiguous literal labels
when the native member has no embedded enclosure list. Linked citation relabeling
and package review rounds remain outside this release.

The retained assembled PDF is reproduced by retrieving its saved bytes and digest.
Future re-rendering uses recorded inputs/templates but depends on available engine,
font and renderer resources; byte-equivalent re-rendering is not promised. Original
signed PDF bytes remain separate, while the assembled derivative is unsigned.
PDF text inspection cannot read text inside scanned images; visual review remains
part of each operation.

Saved-output comparison checks two PDFs from the same preserved revision. It is
limited to 25 MB across all retained outputs in that revision because the review
first verifies every saved output. Each inspected PDF is limited to 500 pages,
200,000 text items, two million text characters and 45 seconds. Failed or cancelled
comparisons leave the saved outputs intact. Matching text, layout, visible page
geometry and member boundaries do not establish visual equivalence. See
[package render qualification](PACKAGE_RENDER_QUALIFICATION.md) for measured scope,
legacy provenance and cross-release evidence.

Portable editable delivery contains the selected revision only. It is unencrypted
and limited to 256 resource entries, 25 MB each, 75 MB decoded total and 100 MB JSON.
A native draft stores embedded attachments inside its own 25 MB resource limit.
Workspace backup version 12 retains complete package history and rejects missing
or corrupt package assets rather than writing a misleading partial package.

See [Word layout qualification](WORD_LAYOUT_QUALIFICATION.md) for measured target-renderer scope and reproducible checks.


Saved package assembly refuses stale or missing explicitly linked citations,
including visible labels that no longer match their targets. Citation repair is
limited to supported native paragraph text/header occurrences. It offers an
explicit before/after preview and creates a new revision. Unsupported, quoted,
coded, ambiguous or unlinked literal text is not automatically rewritten or
claimed valid. Discarding a link leaves that literal text for manual review.

### Word enclosure page images

Correspondence Word downloads and saved Word packages can opt into PDF enclosure page images for that operation. Each enclosed PDF keeps its original bytes. The appended pages are visual copies; their text, interactive fields and certificate signatures do not become editable or verified Word content. The companion explicitly rejects this browser-only option.

The image path supports up to 50 enclosure pages including covers, 25 MB of combined source PDFs, 25 MB of page PNGs and a 50 MB final DOCX. The shared PDF rasterizer also limits each page and aggregate pixel count. Word packages retain their existing 25 MB per-DOCX limit. Missing, corrupt, password-required or unsupported pages stop the operation. Ordinary Word downloads continue to leave PDF pages separate unless the image option is selected.

Table widths and alignment use the same validated proportions in PDF and Word. Table and per-row minimums let rows grow to retain content. Turn off **Wrap cell text** to keep the authored lines. Both output formats can contract long lines to fit fixed column widths. **Columns** draws the outer border, vertical separators, and a rule below the final header row. Drag a divider to resize its two columns, or use **Fit column to text** to estimate one width. Supported Word import retains widths, uniform column alignment and wrapping, simple borders, supported minimum row heights, and uniform 10–12 pt text. Unsupported settings are reported and remain available in the retained original.

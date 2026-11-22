# Tagged PDF export

Choose **Download → Tagged PDF (experimental)** for a native, unclassified Standard, Naval or Multiple Address Letter, or a Plain-Paper or Letterhead Memorandum. Use full, title-only or preprinted letterhead where the letter format offers it. Multiple Address Letters can identify recipients in To, Distribution or both.

In a package, open **Recipient delivery** and select **Tag supported correspondence PDFs (experimental)**. Recipients receive individual tagged PDFs and the exact original files you selected. Each original retains its existing accessibility. Remove an unsupported native document from the selection or prepare an ordinary delivery.

This is experimental output. Native screen-reader qualification and PDF/UA conformance have **not** been established. Searchable text, passing interface accessibility checks, and the presence of tags alone do not establish either result. Review the exported reading order in the PDF reader your recipients will use.

## Included structure

The exported PDF contains a real document structure tree and page-local marked-content associations. It includes English (`en-US`) language metadata, a document title, subject and body headings, paragraph lists, reference lists with optional external title links, typed signature text, Copy to and Distribution entries. First-page letterhead text is included. Repeated continuation subjects and page numbers are artifacts. The decorative seal is an artifact bound to its exact source pixels.

Native body tables have separate logical header and body groups, explicit column header cells, and data cells in authored row order. A header repeated visually on a continuation page appears only once in the logical structure. Empty data cells remain explicit structure elements. Body PNG/JPEG images need authored alternative text, separately from any visible caption. Alternative text is not inferred from pixels or generated from a filename.

The exporter compares each painted image resource with the captured raster's decoded RGB/alpha samples, or exact JPEG data. An unsupported resource or a mismatch stops the export. Equal image dimensions are insufficient.

## Current boundaries

- Native Standard, Naval and Multiple Address Letters and Plain-Paper and Letterhead Memorandums with 1–200 body blocks and at most 250,000 characters across body text, table cells and alternatives.
- Unclassified content only. Classification and handling banners need their own qualification before this option can include them.
- Tables require nonempty column headers and at least one data row. Limits are 6 columns, 100 rows, 400 characters per cell and 1,200 per row. Split dense or unusually tall rows, and inspect the visible result.
- Body images must be retained PNG or JPEG files with meaningful alternative text. Limits are 10 MiB and 4 megapixels per image, 4,096 pixels per side, 32 MiB of distinct image sources and 8 megapixels of distinct source-image decoding per export. At most 20 painted rasters are included, counting any decorative seal. Animated/interlaced PNGs, compressed PNG metadata, embedded color profiles and unqualified PDF image resources are rejected with an error.
- With reference hyperlinks enabled, safe external reference-title URLs receive Link structure and annotation backlinks. Wrapped titles can have multiple annotations belonging to one logical link. Body citation hyperlinks remain plain text in this experimental export. Enabled URLs must be safe and at most 8,192 characters; linked titles are limited to 2,000 characters. Invalid links stop export.
- Appended endorsements, signature images, digital signature widgets, original PDFs and enclosures are not included. Export the native document separately from those originals. A mixed package is not represented as fully tagged or accessible.
- Signed originals, signing handoffs and returned files are never retagged or rewritten through this option.

An unsupported request stops with its reason. It does not silently substitute an ordinary PDF. The export uses an owned captured revision and retained resources; changing the editor later cannot alter that captured job. Cancellation waits for the active compiler before releasing its resources and discards its result.

## Validation and qualification

Before delivery, the exporter reparses the saved PDF and checks title/language metadata, structure parent links, heading levels, column-header scope, figure alternatives, page-local MCIDs, ParentTree backlinks, source-bound URI link annotations and their object references, balanced marked-content boundaries, and coverage of every painted operator. A failed check prevents delivery. This bounded check is specific to the generated format; it is not an arbitrary-PDF repair or a PDF/UA validator.

Qualification fixtures exercise long paragraphs across page breaks, nested lists, multipage tables with repeated headers and empty cells, transparent body images and the default naval seal. Ordinary, instrumented and tagged outputs have identical extracted text and rendered page PNGs in those fixtures. These checks do not qualify every possible row height, script, font or assistive technology. Actual native screen-reader checks remain pending.

The implementation follows the PDF marked-content and structure relationships described in the [PDF specification errata](https://pdf-issues.pdfa.org/32000-2-2020/clause14.html) and [PDF Association tagged PDF guide](https://pdfa.org/wp-content/uploads/2023/07/Tagged-PDF-Best-Practice-Guide.pdf). PDF/UA qualification additionally needs standards validation and human testing with assistive technology.

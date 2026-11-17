# Importing Word documents

Choose **Document actions → Import letter**, select a `.docx`, and review the detected fields, editable content and notices. **Import into editor** creates a new draft and preserves the document that was open. Closing or cancelling the import leaves the current draft intact.

Supported body text, direct bold/italic/underline formatting, recognized paragraph levels, rectangular tables and embedded PNG/JPEG pictures become native content. Recognizable letterhead and closing fields map into their native fields; ambiguous content remains in the body with a notice. Edit table cells in the body editor and supply useful alternative text for body images. Review the imported letter before sending it: Word styles, automatic lists, spacing and pagination can change. Imported text and pictures start before pending Word revisions; proposed picture changes remain in the original for review. Visible portion prefixes remain in the text to preserve review offsets and still contribute to classification checks and output banners.

Merged or nested tables, images inside table cells, linked images, fields, footnotes and unsupported drawings do not become equivalent editable content. Review the notices and retain the original for comparison. Crops, rotation, reflection, masks and unsupported picture effects stop import; flatten the visible picture to PNG/JPEG in Word before trying again. Literal text that conflicts with the native editor's formatting markers also stops import rather than changing the characters.

Inline compatibility alternatives and overlapping revision structures stop import when their original text cannot be inventoried completely. Resolve these structures in a copy before importing; the source file stays unchanged.

The source file is retained byte for byte, separately from later native edits. **Download original Word file** retrieves that source after checking its identity and the current delivery policy. It does not include your later edits. A complete portable draft or workspace backup carries the source and native pictures; a copy without their resource bytes cannot recover them. A reusable package template omits the previous Word source.

The retained original can include deleted text, comments and metadata that are not visible in the imported body. Review it before sharing a complete editable draft or backup. The importer reads package-owned content locally and does not fetch external relationships. Encrypted Word packages are unsupported.

Files are limited to 20 MiB compressed, 48 MiB expanded, 512 ZIP entries, 1,000 imported body blocks, 200,000 retained text characters and 30 pictures. A native table supports 100 rows, 12 columns, 4,000 characters per cell and 100,000 characters in total. Additional image and portable-resource limits can reject an otherwise readable file before it is saved.

## Word comments

Word comments become native discussions. A supported plain-text selection keeps its exact paragraph range. Formatted selections attach to the paragraph with the quoted Word selection; table-cell, cross-paragraph, missing or ambiguous anchors become unanchored discussions with an explanation. Check these discussions before relying on their placement.

Word author names and dates are unverified source metadata. Reply threading, resolved flags, mentions and comment formatting stay in the retained original; imported discussions start open. Inline line breaks and tabs remain in comment instructions. New imports support at most 100 comments with 8,000 characters per comment. These native discussion limits do not prevent recovering or transferring an already retained original; its exact bytes, retained text inventory and delivery policy are still checked. Native clean PDF and Word downloads omit discussions and do not recreate Word comment annotations.

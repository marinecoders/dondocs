# Output limits

See the [capability matrix](CAPABILITIES.md) for current format availability.

## Word output

- PNG signature images are embedded in supported single-signer correspondence. These are visual images, not certificate signatures. Dual-signer documents and information memoranda do not support uploaded Word signature images.
- Custom business letters can add PNG/JPEG figures through the paragraph block menu. Their images and captions are retained in PDF and Word, including after a mode switch. Word images are limited to 10 MB and 40 megapixels each. Missing or unreadable images stop Word export; PDF figure attachments require conversion to PNG/JPEG for Word. Publication Word output remains unsupported.
- PDF signing fields are not emitted into Word. Use Word's signing workflow separately.
- Reference titles with valid URLs are clickable in Word. The hyperlink checkbox controls PDF links separately.
- Uploaded enclosure PDF pages are not appended to Word. **Packages → Review Word package** delivers supported correspondence DOCXs with unchanged separate originals, a readable file list and SHA-256 manifest. Every listed enclosure must have its captured file; missing or corrupt content blocks complete delivery. Forms and publications retain their existing Word restrictions.
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

Portable editable delivery contains the selected revision only. It is unencrypted
and limited to 256 resource entries, 25 MB each, 75 MB decoded total and 100 MB JSON.
A native draft stores embedded attachments inside its own 25 MB resource limit.
Workspace backup version 12 retains complete package history and rejects missing
or corrupt package assets rather than writing a misleading partial package.

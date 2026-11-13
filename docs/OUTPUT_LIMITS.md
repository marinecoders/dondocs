# Output limits

See the [capability matrix](CAPABILITIES.md) for current format availability.

## Word output

- PNG signature images are embedded in supported single-signer correspondence. These are visual images, not certificate signatures. Dual-signer documents and information memoranda do not support uploaded Word signature images.
- Custom business letters can add PNG/JPEG figures through the paragraph block menu. Their images and captions are retained in PDF and Word, including after a mode switch. Word images are limited to 10 MB and 40 megapixels each. Missing or unreadable images stop Word export; PDF figure attachments require conversion to PNG/JPEG for Word. Publication Word output remains unsupported.
- PDF signing fields are not emitted into Word. Use Word's signing workflow separately.
- Reference titles with valid URLs are clickable in Word. The hyperlink checkbox controls PDF links separately.
- Uploaded enclosure PDF pages are not appended to Word. Transfer those files separately.
- Word and PDF use different layout engines, so pagination and placement can differ.

## Form templates and stored assets

Configured forms require a reviewed, published definition and its exact PDF
template revision. A JSON backup preserves editable answers and definitions,
but does not embed the blank template PDFs. Reconnect and save the form for
offline use after restoring it on another device.

New document signatures retain durable attachment references and inline image
fallbacks. Supported older readers can preserve the inline image even if they
do not recognize its reference. Reference-only records receive a fallback when
the asset can be read; missing image bytes cannot be reconstructed. Read the
[signature compatibility boundary](STORAGE.md#document-signature-assets) before
using an older tab or rolling back.

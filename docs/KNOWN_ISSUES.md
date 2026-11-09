# Known output limits

See the [capability matrix](CAPABILITIES.md) for current format availability and
[audit status](AUDIT_STATUS.md) for the original findings and regression evidence.

## Word output

- Uploaded signature and figure images are omitted. Insert them in Word after downloading, or use PDF.
- PDF signing fields are not emitted into Word. Use Word's signing workflow separately.
- Reference titles are retained; the reference URL annotation control applies to PDF.
- Uploaded enclosure PDF pages are not appended to Word. Transfer those files separately.
- Word and PDF use different layout engines, so pagination and placement can differ.

These are current implementation limits, not a claim that Word cannot support
these features in a future implementation.

## Resolved or reverified behavior

- Page-number position, custom starting number, continuation subject, and classification headers/footers are handled by Word post-processing. See `tests/integration/docx-page-furniture.test.ts`.
- Copy-to and distribution lists use breakable paragraphs. Native PDF tests verify short and 110-recipient lists, every recipient's start/end marker, page bounds, and absence of an overfull vertical box. Word tests verify separate paragraphs with no keep-together/table wrapper. See `tests/integration/recipient-list-pagination.test.ts`.
- Numbered paragraph continuation, spacing, and deep-label underlining have native PDF and Word regressions. Both generators use `paragraphLayout.ts` for the shared rules.
- Memorandum For has an addressee editor and native compile coverage in `tests/integration/mf-addressee.test.ts`.
- SwiftLaTeX dollar signs use an OT1-compatible escape rather than relying on unavailable TS1 fonts. See `src/services/latex/escaper.ts`.

## Form inventory and stored assets

The geometry gate checks definitions present in `public/templates` and reports
its inventory count. The current stack has the two built-in NAVMC template sets
but no published configurable `form.json` definitions. Three audited data defects
in the separate form-library branch must be repaired and validated there; a
zero-definition gate run does not certify that unmerged corpus.

New document signatures retain durable attachment references and inline image
fallbacks. Supported older readers can preserve the inline image even if they
do not recognize its reference. Reference-only records receive a fallback when
the asset can be read; missing image bytes cannot be reconstructed. Read the
[signature compatibility boundary](STORAGE.md#document-signature-assets) before
using an older tab or rolling back. Configured forms also need access to their exact PDF template
revision; a JSON backup does not embed those template PDFs.

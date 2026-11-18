# Supporting package evidence

Add PNG, JPEG, UTF-8 text, CSV, DOCX or XLSX files as supporting package members. Review the captured original, retained content and privacy findings before adding it. Saving creates a child revision; source files and older revisions keep their original bytes.

Files are limited to 20 MB. Images use the existing validated raster decoder and support up to 12 megapixels. Text and CSV support up to 1 MB. Office files use the existing bounded ZIP/XML reader; macros, active controls and embedded files are rejected. Supported retained Office XML, including comments and other hidden text, is included in deployment and privacy review. Attachments never run Office code or follow external relationships.

## Supported operations

| Source | Preview | Combined PDF | Editable handoff and delivery |
|---|---|---|---|
| PNG or JPEG | Original image | Unsigned image derivative | Preserved original bytes |
| Qualified text | Escaped retained text | Paginated text derivative | Preserved original bytes |
| Other UTF-8 text or CSV | Escaped retained text | Add a separately reviewed PDF | Preserved original bytes |
| DOCX or XLSX | Bounded retained-text inventory; inspect layout in the source application | Add a separately reviewed PDF | Preserved original bytes |

Text PDF conversion supports at most 50,000 characters, 100 pages and characters representable by the built-in monospaced font. Larger or unsupported text stays available as an original attachment. A format with no qualified conversion blocks combined-PDF readiness rather than disappearing from the output. It remains available for editable handoff.

Text inspection does not recognize text in images. Review original images and Office files before sharing them. File association and a manually completed task do not authenticate an author or establish approval.

Every supporting file has a stable member identity and an exact content digest. Evidence assignments, package history, backup, portable transfer and review copies preserve that identity. A corrupted or missing original remains an error. A supporting file cannot be assigned a basic-letter or endorsement role.

Reusable template capture currently uses fresh PDF attachment slots. Convert a non-PDF supporting file to a reviewed PDF before capturing such a slot; saved case files are never copied into a fresh action automatically.

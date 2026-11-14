# Output capabilities

Generated from `resolveCapabilities` and `documentOutputConfig`. Update with `npm run docs:capabilities`; CI checks for drift.

This matrix describes operations in the browser app. For the separate local service, see the [companion guide](COMPANION.md).

## Reading the matrix

| Status | Meaning |
|---|---|
| supported | The operation is available for this format. Rendering and document checks still apply. |
| partial | The operation is available with the omissions or additional resources described below. |
| unsupported | The operation is unavailable for this format. |
| not-ready | A required form definition has not loaded successfully. |
| invalid-data | The request, document type, mode or form definition is invalid or mismatched. |

The table uses recognized document types and a valid loaded definition for the configured-form example. It therefore shows supported, partial or unsupported, rather than transient load or validation states.

Compliant and Custom are application modes. Both have the same operation availability; their letter and memorandum content controls differ in the final table. Neither mode certifies regulatory compliance.

## Available operations

| Document | PDF | Word | TeX fragments | Flat TeX | Preview | Batch PDF | Share link |
|---|---|---|---|---|---|---|---|
| Naval Letter (on letterhead) | supported | partial | partial | supported | supported | supported | supported |
| Standard Letter (plain paper) | supported | partial | partial | supported | supported | supported | supported |
| Business Letter | supported | partial | partial | supported | supported | supported | supported |
| Multiple Address Letter | supported | partial | partial | supported | supported | supported | supported |
| Joint Letter | supported | partial | partial | supported | supported | supported | supported |
| Same-Page Endorsement | supported | partial | partial | supported | supported | supported | supported |
| New-Page Endorsement | supported | partial | partial | supported | supported | supported | supported |
| Memorandum for the Record (MFR) | supported | partial | partial | supported | supported | supported | supported |
| Plain Paper Memorandum | supported | partial | partial | supported | supported | supported | supported |
| Letterhead Memorandum | supported | partial | partial | supported | supported | supported | supported |
| Decision Memorandum | supported | partial | partial | supported | supported | supported | supported |
| Executive Memorandum | supported | partial | partial | supported | supported | supported | supported |
| Memorandum of Agreement (MOA) | supported | partial | partial | supported | supported | supported | supported |
| Memorandum of Understanding (MOU) | supported | partial | partial | supported | supported | supported | supported |
| Joint Memorandum | supported | partial | partial | supported | supported | supported | supported |
| Memorandum For | supported | partial | partial | supported | supported | supported | supported |
| Executive Correspondence | supported | partial | partial | supported | supported | supported | supported |
| Standard Memorandum (HqDON) | supported | partial | partial | supported | supported | supported | supported |
| Action Memorandum | supported | partial | partial | supported | supported | supported | supported |
| Information Memorandum | supported | partial | partial | supported | supported | supported | supported |
| SL-3 Components List | supported | unsupported | partial | unsupported | supported | supported | supported |
| SL-4 Repair Parts List | supported | unsupported | partial | unsupported | supported | supported | supported |
| TM/IETM Cover and Signature Pages | supported | unsupported | partial | unsupported | supported | supported | supported |
| I-Type Instruction (MI/SI/TI/LI) | supported | unsupported | partial | unsupported | supported | supported | supported |
| NAVMC 10274 - Administrative Action | supported | unsupported | unsupported | unsupported | supported | supported | supported |
| NAVMC 118 (11) - Administrative Remarks (6105) | supported | unsupported | unsupported | unsupported | supported | supported | supported |
| Configured form (valid definition loaded) | supported | unsupported | unsupported | unsupported | supported | unsupported | partial |

## Partial operations and readiness

- Word embeds PNG signature images in supported single-signer correspondence and PNG/JPEG figures in business letters. Reference titles with safe URLs remain linked in Word; the hyperlink checkbox controls PDF links separately. Publication Word output remains unsupported. Merged PDF pages and PDF signing fields require PDF output. Word and PDF use separate layout engines; pagination can differ.
- Normal TeX downloads contain configuration fragments, including distribution and copy-to content. They need templates and assets to form a standalone project. Flat TeX is the Pandoc input dialect.
- Share links transfer a draft snapshot, including retained fields that may not appear in the current rendered format. They omit attachment bytes and signature images. Configured forms also require the selected PDF template. Review the [sharing workflow](USER_GUIDE.md#password-protected-sharing) before transfer.
- Configured forms must load a valid, matching definition with a SHA-256 checksum for every template page before preview, PDF export, or sharing. Missing or failed definition loads report not-ready; invalid definitions report invalid-data. Configured-form batch export is unavailable.
- A valid definition does not mean the template PDF bytes are already available offline. Preview and export also need the matching template pages. See [form templates](FORM_TEMPLATES.md) and [output limits](OUTPUT_LIMITS.md).
- Preview does not issue export or privacy approval. Correspondence previews can initially omit appended PDF pages while an enhancement pass runs; check the finished download before distribution.

Operation availability does not establish engine readiness, valid template geometry, completed content or processing authorization. PDF, Word and TeX exports also require a ready [deployment policy](CLASSIFICATION_CONFIG.md), available rendering resources and any required content review. See the [export workflow](USER_GUIDE.md#export-and-sign).

## Correspondence content controls

This table covers letters, endorsements, memoranda and agreements. Each cell lists **numbered paragraphs / formal references / formal enclosures** for rendered output. The values come from the same configuration used by the editor and renderers.

| Document | Compliant mode | Custom mode |
|---|---|---|
| Naval Letter (on letterhead) | yes / yes / yes | yes / yes / yes |
| Standard Letter (plain paper) | yes / yes / yes | yes / yes / yes |
| Business Letter | no / no / no | yes / yes / yes |
| Multiple Address Letter | yes / yes / yes | yes / yes / yes |
| Joint Letter | yes / yes / yes | yes / yes / yes |
| Same-Page Endorsement | yes / yes / yes | yes / yes / yes |
| New-Page Endorsement | yes / yes / yes | yes / yes / yes |
| Memorandum for the Record (MFR) | yes / yes / yes | yes / yes / yes |
| Plain Paper Memorandum | yes / yes / yes | yes / yes / yes |
| Letterhead Memorandum | yes / yes / yes | yes / yes / yes |
| Decision Memorandum | yes / yes / yes | yes / yes / yes |
| Executive Memorandum | no / yes / no | yes / yes / yes |
| Memorandum of Agreement (MOA) | yes / yes / yes | yes / yes / yes |
| Memorandum of Understanding (MOU) | yes / yes / yes | yes / yes / yes |
| Joint Memorandum | yes / yes / yes | yes / yes / yes |
| Memorandum For | yes / yes / yes | yes / yes / yes |
| Executive Correspondence | no / no / no | yes / yes / yes |
| Standard Memorandum (HqDON) | no / yes / no | yes / yes / yes |
| Action Memorandum | no / no / no | yes / yes / yes |
| Information Memorandum | no / no / no | yes / yes / yes |

Technical publications use their own content models: I-Type instructions, structured SL-3/SL-4 stock lists, and TM/IETM cover and authentication pages. The general correspondence flags do not describe those models. SL-3/SL-4 templates suppress ordinary formal reference and enclosure lists. SL-4 and TM/IETM output also exclude retained correspondence body and list fields, including in Custom mode. See [technical publications](TECHNICAL_PUBLICATIONS.md).

# Output capabilities

Generated from `resolveCapabilities` and `documentOutputConfig`. Update with `npm run docs:capabilities`; CI checks for drift.

These statuses describe available operations. They do not certify regulatory compliance, completed content, engine readiness, or valid template geometry. Both document modes have the same export availability.

| Document | PDF | Word | TeX fragments | Flat TeX | Preview | Batch PDF | Share link |
|---|---|---|---|---|---|---|---|
| Naval Letter (on letterhead) | supported | partial | partial | supported | supported | supported | partial |
| Standard Letter (plain paper) | supported | partial | partial | supported | supported | supported | partial |
| Business Letter | supported | partial | partial | supported | supported | supported | partial |
| Multiple Address Letter | supported | partial | partial | supported | supported | supported | partial |
| Joint Letter | supported | partial | partial | supported | supported | supported | partial |
| Same-Page Endorsement | supported | partial | partial | supported | supported | supported | partial |
| New-Page Endorsement | supported | partial | partial | supported | supported | supported | partial |
| Memorandum for the Record (MFR) | supported | partial | partial | supported | supported | supported | partial |
| Plain Paper Memorandum | supported | partial | partial | supported | supported | supported | partial |
| Letterhead Memorandum | supported | partial | partial | supported | supported | supported | partial |
| Decision Memorandum | supported | partial | partial | supported | supported | supported | partial |
| Executive Memorandum | supported | partial | partial | supported | supported | supported | partial |
| Memorandum of Agreement (MOA) | supported | partial | partial | supported | supported | supported | partial |
| Memorandum of Understanding (MOU) | supported | partial | partial | supported | supported | supported | partial |
| Joint Memorandum | supported | partial | partial | supported | supported | supported | partial |
| Memorandum For | supported | partial | partial | supported | supported | supported | partial |
| Executive Correspondence | supported | partial | partial | supported | supported | supported | partial |
| Standard Memorandum (HqDON) | supported | partial | partial | supported | supported | supported | partial |
| Action Memorandum | supported | partial | partial | supported | supported | supported | partial |
| Information Memorandum | supported | partial | partial | supported | supported | supported | partial |
| SL-3 Components List | supported | unsupported | partial | unsupported | supported | supported | partial |
| SL-4 Repair Parts List | supported | unsupported | partial | unsupported | supported | supported | partial |
| TM/IETM Cover and Signature Pages | supported | unsupported | partial | unsupported | supported | supported | partial |
| I-Type Instruction (MI/SI/TI/LI) | supported | unsupported | partial | unsupported | supported | supported | partial |
| NAVMC 10274 - Administrative Action | supported | unsupported | unsupported | unsupported | supported | supported | partial |
| NAVMC 118 (11) - Administrative Remarks (6105) | supported | unsupported | unsupported | unsupported | supported | supported | partial |
| Configured form (valid definition loaded) | supported | unsupported | unsupported | unsupported | supported | unsupported | partial |

## Partial operations and readiness

- Word omits uploaded signature/figure images, merged PDF pages, and PDF signing fields. Reference link annotations require PDF. Word and PDF use separate layout engines; pagination can differ.
- Normal TeX downloads contain configuration fragments, including distribution and copy-to content. They need templates and assets to form a standalone project. Flat TeX is the Pandoc input dialect.
- Share links include text and form values, not attachment bytes or signature images. Configured forms also require the selected PDF template.
- Configured forms must load a valid, matching definition with a SHA-256 checksum for every template page before preview, PDF export, or sharing. Missing definitions report not-ready; invalid definitions report invalid-data. Configured-form batch export is unavailable.

## Correspondence content controls

Each cell lists **numbered paragraphs / formal references / formal enclosures**. These flags come from the same configuration used by the editor and renderers.

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
| Executive Memorandum | yes / yes / yes | yes / yes / yes |
| Memorandum of Agreement (MOA) | yes / yes / yes | yes / yes / yes |
| Memorandum of Understanding (MOU) | yes / yes / yes | yes / yes / yes |
| Joint Memorandum | yes / yes / yes | yes / yes / yes |
| Memorandum For | yes / yes / yes | yes / yes / yes |
| Executive Correspondence | no / no / no | yes / yes / yes |
| Standard Memorandum (HqDON) | no / yes / no | yes / yes / yes |
| Action Memorandum | no / no / no | yes / yes / yes |
| Information Memorandum | no / no / no | yes / yes / yes |
| SL-3 Components List | yes / yes / yes | yes / yes / yes |
| SL-4 Repair Parts List | yes / yes / yes | yes / yes / yes |
| TM/IETM Cover and Signature Pages | yes / yes / yes | yes / yes / yes |
| I-Type Instruction (MI/SI/TI/LI) | yes / yes / yes | yes / yes / yes |

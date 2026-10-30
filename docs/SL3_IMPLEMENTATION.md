# SL-3 components lists

Branch: `feature/sl3-components-list`. PR: `feat(techpub): add SL-3 components lists` (#359).

## Sources and decisions

- MCO 5215.17D, enclosure (1), chapter 1, paragraph 1.c(3)(a), establishes the standalone components list, component identification, TAMCN associations and configuration quantities/ratios. Chapter 2 supplies publication identification and PCN rules. The order is retained in `docs/MCO 5215.17D.pdf`.
- Supplied MARCORSYSCOM portrait and landscape SL-3 templates establish fixed preface text, cover/authentication, inventory columns, sixteen-row maximum including category headings, nesting and illustrations.
- MIL-STD-38784C is retained in `docs/MIL-STD-38784C.pdf`. Applicable PDF rules supply navigation lists, linked references/bookmarks, right-edge numbering, sequential Roman front matter and widened 11 × 11-inch inventory pages for the landscape selection.
- Cover is unnumbered; an end-item continuation is T-2; authentication starts at i. TOC, navigation lists, preface and technical data follow sequentially. The preface begins at iv for a fixture with one-page authentication, TOC and combined illustration/table lists; longer content can change that page reference.
- Preserve source table grids for the seven-column inventory. Optional columns have no supplied grid and require tailoring review. No approved tailoring or current ALPS-HDBK-004 was supplied.
- Production embeds Nimbus Roman rather than Times New Roman. This is a material unresolved compliance gap. Installed system fonts do not establish browser support or redistribution rights.

The complete requirement matrix, source identities, exceptions and validation are in [SL3_COMPLIANCE_AUDIT.md](SL3_COMPLIANCE_AUDIT.md). This MVP is not certified as 100% compliant or approved for enterprise publication release.

## Implementation

- [x] Register SL-3 in the document picker, guide and starter templates.
- [x] Add structured components, notes, figures, source-manual provenance and configuration associations.
- [x] Render complete publications with portrait or widened inventory pages.
- [x] Apply shared marking/date checks and SL-3-specific hierarchy, quantity, source and signing checks.
- [x] Preserve data/assets through saved documents, recovery, history, backups and portable drafts.
- [x] Add Companion/MCP PDF generation through the same renderer and checks.
- [x] Inspect actual PDFs, browser authoring, type switching and I-Type regressions.

## Acceptance and limits

One saved SL-3 supports both orientations, six-row covers and overflow lists, fixed preface, notes or None, technical data, end-item illustration, SSRI, optional collateral, mandatory UURI, sequential inventory numbers, parent/component relationships, optional figure/model columns, twelve periodic cells, legends and inventory signature spaces. Unit of issue is recorded separately from unit of measure. Associated component TAMCNs require a covered primary TAMCN, positive ratio and configuration-source reference.

Missing component illustrations print Not Shown. Draft preview remains available; PDF export rejects incomplete or contradictory data and sheets that cannot fit. Authors can reduce rows per sheet for longer descriptions. Export prepares an unsigned authentication signature field for external signing and rejects by-direction authentication.

Validation exercises more than six end items, more than sixteen inventory rows, nested items at sheet boundaries, optional columns, long descriptions, asset recovery, missing files, control markings and both layouts. Real PDF tests inspect page references, link destinations, outline hierarchy, signature placement and physical table geometry. Source assertions alone do not establish compliance.

Word export, actual certificate signing, SL-4, full TM/IETM, revision/change packages and formal source-data delivery are outside this MVP. Program offices must verify source completeness, technical accuracy, official identifiers/units, marking determinations, artwork and signing authority. Enterprise software approval is a rollout dependency, not a gate to this MVP work.

## Validation

See the audit report for the final local test results and the PR checks for validation of the pushed commit. The full unit/coverage suite, integration suite, twenty SL-3 matrix cases, typecheck, ESLint, production build and Companion build are exercised. Browser checks use synthetic example content only.

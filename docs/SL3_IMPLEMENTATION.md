# SL-3 components lists

Branch: `feature/sl3-components-list`. One PR: `feat(techpub): add SL-3 components lists`.

## Sources and decisions

- MCO 5215.17D, enclosure (1), chapter 1, Components List (SL-3), and chapter 2: publication purpose, identification and PCN. Chapter 1, paragraph 1.b(3)(a), printed pages 1-2–1-3, calls for component identification, TAMCN associations, quantities and ratios; components retain optional TAMCN/ID fields alongside their quantities. The order is retained in `docs/MCO 5215.17D.pdf`.
- Supplied MARCORSYSCOM portrait and landscape SL-3 templates: fixed preface, cover and front authentication, inventory columns, 16-row maximum (including category/other rows), nested components and illustrations.
- MIL-STD-38784C: applicable PDF formatting, hyperlinks, bookmarks, continued tables and illustrations. PDF output adds no blank pages or paper-only blank-page labels.
- MCO 4400.201, volume 3, section 0214 supplies the supporting component responsibility policy. Verify applicable changes before adding policy-derived restrictions.
- Preserve the supplied cover and front authentication layout. Reuse I-Type cover mechanisms without carrying its MI-only content or 12-point body requirement into SL-3.
- The supplied portrait instructions start the preface at iii; the landscape instructions say i. Use iii consistently, with cover/authentication preceding the preface. Physical overflow pages are not additional logical front-matter numbers. Record this discrepancy for publication-office review.
- The existing renderer uses a Times-compatible font. This change does not establish a distributable Times New Roman license or publication-office approval.
- The current ALPS-HDBK-004 handbook has not been obtained. Do not invent rules attributed to it.

## Implementation

- [x] Register SL-3 in the document picker, guide and starter templates.
- [x] Add structured component, special-note and illustration authoring.
- [x] Render the complete portrait publication, then landscape inventory pages.
- [x] Apply shared publication marking/date checks and SL-3-specific checks.
- [x] Preserve data and attachments across saved documents, recovery, history, backups and portable drafts.
- [x] Add Companion/MCP PDF generation through the same renderer and checks.
- [x] Verify actual PDFs, browser authoring, type switching and I-Type regressions.

## Acceptance

One saved SL-3 supports both orientations, six-row covers and overflow lists, fixed preface text, special notes (or None), technical data, the end-item illustration, SSRI, optional collateral materiel, mandatory UURI, sequential inventory numbering, parent/component relationships, optional figure/model columns, inventory legends and inventory signature spaces. Missing illustrations print Not Shown. Export rejects incomplete/contradictory content; preview remains available during drafting. PDF export prepares an authentication signature field for external signing.

Validation must exercise more than six end items, more than sixteen inventory rows, nested components at page boundaries, long descriptions, asset recovery, missing files, notes and both layouts. Source-only assertions do not replace rendered PDF inspection. Word export, certificate signing, SL-4 and a full TM/IETM remain outside this PR.

## Validation

- Unit/component suite and coverage gate: 3,218 tests passed; statement coverage 61.2%.
- Existing I-Type and new SL-3 rendering/production export checks passed. SL-3 cases include overflow, nested items at a sheet boundary, both optional columns, over-height rejection, image assets, PDF link destinations and signature placement.
- The shared pairwise LaTeX matrix compiles twenty SL-3 combinations.
- Typecheck, ESLint, production build and Companion build passed.
- Browser authoring verified at the branch's local preview, including the document picker and the demonstration inventory.

The inventory retains the supplied logical column order and twelve periodic-inventory cells. Column proportions fit the renderer's portrait/landscape text areas while keeping identifiers intact; final layout and font acceptance remain publication-office review items. Program offices remain responsible for component data, technical accuracy, control markings, approval and signing.

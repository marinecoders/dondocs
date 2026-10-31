# Certification spacing and completed-field verification

This follow-up checks the closely spaced lines above the first inventory signature entry and tests populated content against the supplied desktop SL-3 forms.

The close portrait line is **the top border of the 20-row writing table**, not the first writing baseline. The original DOCX contains 20 rows, each 518 twips high, with a top and bottom border on the first row. Its rendered PDF has a 13.25-point gap from the full-width caption separator to the table's top border, followed by 26.4-point writing spaces. The wide source has no top border, 12 rows and 29.3-point writing spaces; its caption separator is 41.2 points above the first writing baseline (11.9-point gap plus one row).

The implementation previously used a common 12-point spacer, producing measured gaps of 12.375 points in portrait and 41.675 points to the first wide writing baseline. It now uses the source-specific distances and accounts explicitly for half the separator stroke width. The source border is retained, and all 20/12 writing spaces remain usable. No writing entry belongs in the narrow space between the caption separator and the table's top border.

## Populated cases

Four production exports cover both orientations with ordinary and extended content. The extended cases use a long nomenclature, command/address, signatory name and billet, seven cover entries (cover overflow), and synthetic CUI control banners. Assertions check:

- Every rendered word remains inside the page's horizontal content bounds.
- Wrapped nomenclature retains every word and clears the certification captions.
- Authentication stays together after the cover continuation, including its final distribution line.
- The unsigned digital-signature widget is on the authentication page and fits between OFFICIAL and the printed name.
- All 20 portrait or 12 wide rows accommodate synthetic names/ranks and dates; a longer portrait name wraps onto two lines inside its own row.
- An eight-digit serial fits the existing serial-writing line.
- Entries remain inside their columns/rows, and the final row retains footer/control-banner clearance.

The completed copies are **QA simulations of writing on the source form**. The inventory rows remain blank writing spaces in the application export; these samples do not introduce application text fields or apply certificate signatures. All names, serials and equipment details are synthetic. Handwritten signatures still require the user to stay inside the writing area.

An additional production regression deliberately overfills the command address. The renderer now refuses an authentication that would span multiple pages, with a specific message to shorten the completed fields, instead of returning a malformed authentication layout.

## Reproduce

From the repository root:

```sh
npx vitest run --config vitest.integration.config.ts tests/integration/sl3-filled-layout.test.ts tests/integration/sl3-render.test.ts tests/integration/sl3-companion.test.ts
```

All 24 focused tests pass, including the five new populated/overflow cases. Lint, application build and both Companion builds also pass. `filled-layout-verification.json` records the measured distances and synthetic output identities. The PNGs show extended completed certification sheets in both orientations and the extended authentication page.

This spacing verification supplements the [full checklist](../../SL3_DOCUMENT_CHECKLIST.md) and [prior fix verification](../sl3-2026-10-30/FIX_VERIFICATION.md). It does not change their unresolved source/delivery/profile requirements or the user's font-family exclusion.

## Editing controls verification

The SL-3 publication editor now groups identity, dates, command/contact, end items, inventory layout and release review. Publication and signing dates have calendar buttons and retain military and ISO storage formats respectively. Office closures support multiple calendar selections and typed comma-separated dates. An explicit action applies the calculated last working day; changing the signing date does not silently overwrite the publication date. Invalid ISO days remain visible for correction rather than rolling into the next month.

The shared calendar's month arrows now remain beside the heading and accept pointer input. Global definition authoring remains in Technical data and notes, rather than repeating inside every component card. Field grids follow the editing pane's width and become one column in a narrow split view.

Live browser checks exercised month navigation, date selection, manual entry and blur, closure selection/deselection, Escape dismissal, the calculated-date action and saved values after reload. A 336-pixel editing pane displayed one-column fields without horizontal page overflow; the normal 522-pixel pane displayed paired fields. The original synthetic dates and 40% preview width were restored after testing.

- [Calendar and grouped fields](ui-editor-calendar.png)
- [Multiple office closures and working-day guidance](ui-closure-calendar.png)
- [Narrow-pane calendar](ui-editor-narrow.png)

All 3,247 unit/component tests passed with coverage thresholds satisfied, including seven new date/editor regressions. Lint, TypeScript and the production application build passed. These UI changes preserve the existing publication data and export layout rules.

## Final section-by-section review

The final pass checks all six SL-3 editing sections and compares fresh production publications with the original portrait/landscape Word forms, shared cover/signature form, email, MCO 5215.17D and MIL-STD-38784C. It found and corrected additional cover/preface formatting and authoring defects. The inspected synthetic publications have no detected text collisions, off-page text or leftover authoring prompts. This is an MVP verification record, not a government release or acceptance certification. The user's font-family exclusion remains in effect.

Original source filenames, byte counts and SHA-256 identities are retained in [the manifest](final-review/source-manifest.json). The desktop standard and repository standard still have the same identity. Source page references below mean physical pages in fresh LibreOffice renders, including the five instructional pages at the front of each SL-3 source. Original Word files are unchanged.

### Editing sections

| Section | Final checks and corrections |
| --- | --- |
| Publication details | Identity, command/contact, end items, dates, orientation and row-limit fields remain editable. Calendar selection, typing/clearing, ISO signing-date storage, multiple closures and the explicit last-working-day action retain their existing checks. Calendar focus starts on the selected day and returns after keyboard selection. Paired inputs align even when a label wraps. |
| Classification | Classification and CUI category selectors now have their missing label associations. Distribution fill-ins and domain restrictions retain their existing behavior. The live browser walkthrough uses the public-domain unclassified/Statement A profile; component tests exercise conditional controls and production exports exercise synthetic CUI/classified markings. No domain restriction was bypassed. |
| Technical data and notes | Source manual, configuration provenance, technical text, sequencing, definitions and notes remain editable. Browser checks added/edited/removed a temporary definition and note, associated that note with an item, and verified cleanup. Global definitions remain in this section once per publication. |
| Components inventory | Categories, identifiers, quantity, units, hierarchy, serial flags, optional columns and note/figure associations remain usable. Unavailable sibling moves are disabled. Validation accepts the governing order's B2565/B2483 TAMCN-base example without inventing suffixes, while preserving assigned full identifiers and rejecting conflicting associations. |
| Illustrations | Figure groups, upload inputs, searchable-label fields and remove actions identify their specific illustration. Browser checks exercised two temporary illustrations, end-item assignment, lettering review, label text/position and removal. Asset validity, searchable paint order and missing/unreviewed artwork remain covered by export/component checks. Temporary illustrations were removed after inspection. |
| Authentication | The SL-3 editor now exposes the printed name, signing-authority title and controlling office, with its required digital-authentication workflow. It no longer offers rejected typed/image/by-direction choices or unrelated correspondence office-code/rank fields. Imported incompatible settings have an explicit repair action. Actual authority and certificate signing remain external. |

All six sections were inspected at 563-pixel and 376-pixel pane widths (approximately 523/336 pixels of field area). [DOM measurements](final-review/ui-measurements.json) show no unnamed visible fields, controls crossing pane edges or horizontal page overflow in the inspected profile. Narrow grids stack; signatory inputs retain aligned baselines. Temporary edits were removed, the original synthetic data restored, and preview width returned to 40%.

The fast-interaction pass also reproduced a closing-calendar defect: its fading content could intercept a following date-action click. Calendar content now unmounts immediately on close. An exit-animation regression and [three rapid browser trials](final-review/quick-date-checks.json) verify keyboard selection, immediate working-day restoration and navigation, with the original date restored and no remaining calendar hit targets.

Readiness now checks the six owning sections. For example, an absent signing title marks Authentication incomplete; the checklist link opens that section. Missing source-manual feedback opens Technical data and notes instead of Publication details. Unknown feedback remains reachable through Publication details.

[Authentication editor](final-review/ui-authentication.png) · [Narrow authentication editor](final-review/ui-authentication-narrow.png)

### Publication sections

The two complete comparison outputs contain the same 26 synthetic components, all three responsibility categories, a parent/child/grandchild group, optional columns, a source configuration association, numbered notes, a custom definition and two labelled illustrations. Eight rows per sheet were selected for this dense example. A sixteen-row version correctly triggered the existing whole-sheet height guard; reducing the limit retained every component. Sixteen is the source maximum, not a promise that arbitrary completed text will fit sixteen rows.

[Complete portrait comparison](final-review/complete-portrait.pdf) · [Complete wide comparison](final-review/complete-landscape.pdf)

| Section | Source pages | Comparison output pages | Result |
| --- | --- | --- | --- |
| Cover and notices | 6 | 1 | Restored bold titles, the two 2.25-point cover separators, underlined bold field headings and borderless end-item rows. The four source widths (3083/2078/1882/2549 twips) and six reserved rows are retained. The source grid is centered for PDF. Seal remains two inches; nomenclature/title limits remain guarded. PCN is bold twelve-point per the instruction and stays above the PDF footer/control area. |
| Cover continuation | 7 | Separate seven-end-item regression | All entries move after See Next Page, with borderless repeated source headings. Authentication/signature-field placement follows the actual continuation. Source-template unused rows are retained only on a non-overflow cover. |
| Authentication | 8; shared cover/signature form | 2 | Fixed authentication, safety/feedback paragraphs, completed command/contact and official's printed block remain together. Signature1 is present on physical page 2, above the printed name. The source's OFFICIAL/name/distribution clearances and long-field overflow refusal remain covered. The field is unsigned. |
| Contents, illustration and table lists | Added by the PDF standard | 3–4 | Single-column navigation, ordered entries, underlined links, destinations and page references remain checked. Each complete comparison has 76 link annotations. Certification uses the printed INVENTORIED BY caption, without an invented body heading. |
| Preface | 9–10 | 5–6 | All 19 fixed narrative/note blocks match both sources and actual PDF text after normalizing run boundaries, whitespace and punctuation while retaining letter case. Restored underlined bold sideheads, regular-weight Column references and the source's 18-point number field. The fixed narrative itself is unchanged. |
| Special notes | 10 | 6 | SPECIAL NOTES remains present. Author note 19 and the automatic optional-column/Fielding Plan note 20 print with stable references. Separate empty-note checks retain None. |
| Abbreviations | Required by the standard | 7–8 | Fixed and custom terms remain alphabetical; the ZED definition is present. Long terms/meanings retain their measured gutter, wrapping and repeated continuation heading. No detected word-run collision. Actual equipment terminology still needs author review. |
| Technical data and end-item illustration | 11–12 | 9 | Source/configuration references and narrative are independent of the artwork. Figure 1 follows the end item, with searchable visible lettering and a centered caption. Synthetic technical characteristics are not represented as approved equipment facts. |
| Inventory sheets | 13, 15–16, 18 | 10, 13, 15, 17, 19 | Original functional column widths, twelve periodic cells, hierarchy/quantity conventions, serial marking and all categories are retained. Optional columns use additional margin space with provenance. Parent and first child remain together. Continued titles/boxheads repeat; the standard's final-rule treatment remains explicit. |
| Component illustrations and Not Shown | 14, 17, 19 | 11–12, 14, 16, 18, 20 | Figure/item associations, visible searchable text, item numbers and missing-illustration labels remain intact. Captions use the standard's nominal 18-point PDF spacer; actual image/text bounds are checked. |
| Inventory certification | 20 | 21 | Source captions, serial rule and aligned three-column writing areas remain intact: twenty rows in portrait and twelve in wide output. Vector inspection finds 63 portrait writing/top-border rules and 36 wide writing rules. Existing populated-row tests retain writing clearance. |
| Running matter and controls | Active source headers/footers | Every applicable page | Publication dates, short titles, page numbers and required control banners remain in their measured areas. All complete-output text stays inside the checked reproduction bounds. Fresh CUI/export-controlled cases preserve their selected controls; the unreviewed lettering case is intentionally rejected. |

The source cover's missing rules/borderless rows and preface sideheads were genuine gaps in the previous audit. They are now fixed and covered by actual PDF vector/text regressions. [Cover proof](final-review/cover.png) · [Preface proof](final-review/preface.png)

Both complete outputs have 21 pages, sequential Roman front matter followed by Arabic inventory pages, one unsigned authentication field, no detected text collisions and no text beyond the checked page bounds. Portrait is 612×792 PDF points throughout; wide output retains portrait front matter and 792×792 inventory/certification pages. [Layout observations](final-review/layout-observations.json) and [section observations](final-review/section-observations.json) retain output hashes, page sizes, fixed-text matches, footer sequences and measured caption clearances.

### Source differences and remaining release conditions

The email requires the tagged templates to comply with the attached standard. Numeric PDF rules take precedence over conflicting Word examples; source-specific content and geometry are otherwise retained. This review does not claim pixel identity between the two media.

- PDF uses widened eleven-inch-square pages, symmetric margins, right-edge page numbers, sequential front matter and no paper-only blank-page notation. The supplied paper forms differ in these respects.
- The standard supplies fourteen-point navigation/preface headings and a nominal eighteen-point figure-caption spacer; the Word forms describe smaller headings and two blank lines. Table I permits type-size tolerances and slight leading variations. The source's nine-point inventory text is retained; actual final reproducible-copy/profile acceptance remains part of delivery review.
- Continued inventory tables follow the standard's omitted final horizontal rule until the last sheet. The source examples draw closed tables. Distribution A follows the standard's destruction-notice exception rather than the form's unconditional instruction.
- Existing unresolved conditions remain: the short-publication/brief-manual profile, immutable source headings containing acronyms, the intended sensitivity-label/protection workflow and required tagged-source/DTD delivery. The twenty-one-page comparison does not waive brief-manual requirements for the shorter outputs.
- Real equipment completeness, assigned identifiers, configuration authority, actual artwork/definitions, control determinations, signing authority, certificate signing and enterprise release approval remain program responsibilities. No such real program package or approval was supplied, and none is manufactured by the MVP.

The [full 648-entry checklist](../../SL3_DOCUMENT_CHECKLIST.md) retains these distinctions. Its summary counts now reflect the current rows rather than the historical baseline; DOC-008 and DOC-086 are updated with this pass's demonstrated corrections. No aggregate compliance percentage is asserted.

### Validation and reproduction

The final full unit/component run passed 3,257 tests with coverage thresholds satisfied. The 66-case PDF regression run passed (32 SL-3 and 34 I-Type checks); the final two-case cover/preface/caption rerun also passed after retaining the standard's caption spacer. Conditional classification controls and the edited authoring controls passed their focused component rerun. TypeScript, lint, application build and both Companion builds passed. The earlier 21 PR checks were green before this final change set; the new commit requires its own PR checks.

Fresh production profile exports cover ordinary portrait/wide, continuation, synthetic CUI with dissemination, restricted distribution, export controls and reviewed searchable lettering. The unreviewed raster lettering input is refused. [Profile observations](final-review/release-profile-observations.json) preserve these checks without treating visible banners as proof of a downstream sensitivity label or encryption workflow.

From the repository root, with the original source folder available:

```sh
node build-templates.mjs
npx vite-node --config vitest.config.ts docs/audits/sl3-2026-10-31/final-review/reproduce.mts /tmp/sl3-final-review
npx vite-node --config vitest.config.ts docs/audits/sl3-2026-10-31/final-review/inspect.mts /tmp/sl3-final-review
python3 docs/audits/sl3-2026-10-31/final-review/verify_sources.py --sources '/path/to/desktop/dondocs' --exports /tmp/sl3-final-review
npx vitest run --config vitest.integration.config.ts tests/integration/sl3-render.test.ts tests/integration/sl3-companion.test.ts tests/integration/sl3-filled-layout.test.ts tests/integration/sl3-text-layout.test.ts tests/integration/sl3-final-review.test.ts tests/integration/i-type-compliance.test.ts
```

The source render uses the bundled document renderer and LibreOffice, without editing the originals. The retained PDFs and measurements are concrete synthetic comparison artifacts. Binary hashes can change on a new export because PDF metadata/signature-widget preparation contains generated identifiers; the fixture inputs and asserted layout/content properties are the reproducible checks.

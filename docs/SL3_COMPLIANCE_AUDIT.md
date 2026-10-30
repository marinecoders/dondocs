# SL-3 MVP compliance audit

Audit date: 30 October 2026. PR: #359, `feature/sl3-components-list`.

## Conclusion and scope

This is a requirements audit of the SL-3 MVP, not an accreditation or a publication release authorization. **The MVP cannot be described as 100% compliant.** The PDF engine embeds Nimbus Roman, not the Times New Roman required for Marine Corps publications. The supplied Word templates and MIL-STD-38784C also differ on PDF page geometry, footer placement and front matter. The explicit PDF rules are applied below, and unresolved tailoring is identified rather than treated as approved.

The user confirmed this is an MVP and that no approved tailoring, current ALPS-HDBK-004 or enterprise authoring approval is available. Those organizational dependencies are recorded; they are not made into a permission gate for building or inspecting the MVP.

The audit covers the complete MCO, applicable Marine Corps/general/PDF clauses of MIL-STD-38784C, both supplied SL-3 templates, the affected SL-3 implementation and shared integration paths, persistence/import/export paths, rendered publications, PDF links/outlines and signature-field placement. It does not verify a real equipment baseline, assign identifiers, approve distribution, classify information, authorize a signer or digitally sign a document. Synthetic fixtures cannot prove those facts.

## Controlling sources

- [MCO 5215.17D](https://www.marines.mil/Portals/1/Publications/MCO%205215.17D.pdf), 26 October 2016, retained in `docs/MCO 5215.17D.pdf`. [MCPEL lists it as current](https://www.marines.mil/News/Publications/MCPEL/Search/5215/).
- MIL-STD-38784C, 4 September 2024, supplied with the email and retained in `docs/MIL-STD-38784C.pdf`. [ASSIST document record](https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=116799). The sender explicitly requires the templates marked `1.` to comply with this standard.
- Supplied `1. SL-3 Portrait Template.docx` and `1. SL-3 Landscape Template.docx`. Template prose, table grids, section settings and front matter were inspected. Original files remain in the user's source folder; they are not silently rewritten or represented as approved PDF tailoring.

SHA-256 source identities:

| Source | SHA-256 |
| --- | --- |
| MCO | `d46d5110ca86b23ec38572e71c74902bd2d709045ded0818fd7319f64ef66730` |
| MIL-STD | `b2279d7e24a12c6f7136c8c93546af4e15240db99639845da07f55206ab225a0` |
| Portrait template | `8ec25d4f99206950f7bd632ca7915a4544e373267e9fcceee0ecc299ea656d32` |
| Landscape template | `ae526dd97e462d8ffa2074b1781996efedb0c40d62253e9c86c811740b683764` |

## MCO traceability

`Implemented` means the MVP supports or checks the requirement. It does not certify the truth of author-entered data. `External` means evidence belongs to the sponsor or enterprise. `Not applicable` is limited to this standalone, new-release SL-3 MVP.

| Requirement | Applicability and evidence |
| --- | --- |
| Main paragraphs 1–3; 4.a(1), 4.a(2) | New publications must comply. This audit replaces the earlier assumption that compilation plus template resemblance establishes compliance. The 2016 order cancels P5215.17C; the MVP does not use that canceled order as authority. |
| 4.a(3)(a)–(b) | External: sponsor compliance determination, annual necessity/currency review and retained review records. No automatic approval or annual-review claim is made. |
| 4.b(1)–(3), (4)(a)–(e), (g), (5)(a)–(b), (6), (7) | External: councils, policy, budgeting, service agreements, repository/portal operations, allowances, verification and archiving. A local editor does not perform these enterprise responsibilities. |
| 4.b(4)(f), 4.b(5)(c) | Signature authority must not be below PM; MARCORSYSCOM signing is not by direction. Implemented: export rejects the by-direction flag and a by-direction signature title. Actual PM-or-higher authority remains external; a rank/title string is not proof. |
| 4.c(1) | The fixed authentication/preface reproduces the supplied publication-feedback routing. Actual NAVMC 10772 processing and enterprise support workflows remain external. |
| 4.c(2) | External rollout prerequisite: enterprise-approved authoring software. No evidence of DonDocs approval was supplied. This is not claimed by the MVP or replaced by a self-attestation checkbox. |
| 5.a–c; 6 | Recommendations through the chain, records schedules, Privacy Act responsibilities, applicability and effective date are organizational obligations. Data stays in the existing local workspace/export paths; the audit uses synthetic content. This is not a records-management or privacy accreditation. |
| Enclosure (1), chapter 1, 1.a–c | Publication/sponsor/technical-data definitions: SL-3 is registered as a technical publication, not ordinary correspondence. |
| Chapter 1, 1.c(1) | Not applicable: operator/maintenance TM contents and maintenance allocation charts; this PR is a standalone SL-3, not a full TM. |
| Chapter 1, 1.c(2)–(3)(a) | Implemented: stock-list identifiers, nomenclature/descriptions, part numbers, illustrations, distinct unit of issue and unit of measure, ID/TAMCN data and SSRI/collateral/UURI sections. |
| Chapter 1, 1.c(3)(a)1–2 | All components must be included; the SL-3 is a standalone extract even below five components. Implemented: no five-component threshold, required source-manual provenance and component inventory. Completeness against the source TM requires sponsor verification. |
| Chapter 1, 1.c(3)(a)3 | Implemented: associated primary TAMCN, related component TAMCN and positive primary:component ratio, with a required configuration-source reference when TAMCN associations are present. Primary TAMCN must match a covered end item. Actual HQMC/TFSMS configuration authority is external; the editor does not invent or query an approved baseline. |
| Chapter 1, 1.c(3)(b), 1.c(4), 1.d, 1.g, 2 | Not applicable: SL-4, application/special lists, I-Type and supplementary/supporting documents. Existing I-Type behavior is regression tested. |
| Chapter 2, 1–2.b | Implemented: SL-3 short-title and PCN fields, ID/FSC/SSIC-shaped basic numbers and end-item/model records. Assignment, preference of ID over FSC over SSIC, authorized cross-service numbers and dropping an ID suffix for a multi-model publication require an assigned publication record; syntax alone does not prove assignment. |
| Chapter 2, 2.c–f | Maintenance, sequence, edition and volume semantics cannot be inferred from arbitrary text. This MVP accepts assigned SL-3 short titles; it does not issue numbers or implement amendment/edition management. PDF volumes are outside this MVP. |
| Chapter 2, 3 | This paragraph specifies standard contents for TMs. SL-3 uses its supplied cover/authentication/preface/inventory structure, augmented with the generally required PDF navigation lists. Dates are validated against the signing month and last working day. Full TM warnings, maintenance chapters and commercial-manual releases are not manufactured for an SL-3. |
| Chapter 2, 4 | Implemented: eleven-digit PCN syntax; external assignment through the publication control process remains necessary. |
| Chapter 2, 5 and appendix A | Legacy numbering examples and acronym definitions are reference material, not authority for the MVP to allocate identifiers. |

## MIL-STD-38784C traceability

Service-specific clauses marked only `(A)`, `(F)` or `(N)` are not applied as Marine Corps requirements. Paper-only rules are not silently carried into PDF output. Contract/acquiring-activity options are not assumed authorized.

| Clause | Finding and disposition |
| --- | --- |
| 1; 2.1–2.4; 3; 4.1 | Applicability, references, definitions, precedence and PDF medium reviewed. The email makes this standard part of the requested SL-3 basis. Source documents do not themselves prove contract tailoring or software approval. |
| 4.2–4.3; 4.6 | No generated advertising. Actual source-data accuracy, engineering provenance and rights to uploaded images remain author/sponsor responsibilities. Source-manual metadata is retained. |
| 4.4–4.5 | No joint-service manual or contract outline deliverable is claimed. PDF navigation entries/reference links are real GoTo/URI annotations, not the engine shim's HTML specials. |
| 4.7.1–4.7.3; Table I | Fixed: bold 10-point short title and page numbers at the PDF right margin; 14-point bold control banners; uppercase full publication dates; no title-page number. Header/footer/banners are inspected separately from body data. |
| 4.7.4.1.1–4.7.4.1.2.5 | Implemented: no paper-only blank-page labels or inserted blank pages; sequential Roman front matter, Arabic inventory pages; cover continuation identified as T-2. Fixed front-matter numbers in the Word instructions are not retained after adding required PDF lists. |
| 4.7.4.1.2.6–4.7.7 | No foldout, emergency-page or multisheet-artwork authoring claim. Reusing an image is not proof that a prepared engineering multisheet figure is compliant. Those deliverables require further implementation/author review. |
| 4.7.8 | Fixed: the immutable preface's NOTE text is indented on both sides. Component indentation remains 0 / 0.10 / 0.28 inches with the template's hanging indents. |
| 4.7.9.1–4.7.9.4 | Fixed: numbered inventory-table title, repeated title with Continued, repeated boxheads, 0.75-point rules and linked special-note references. A whole-sheet height check prevents silent overflow beyond a sheet/illustration pair. |
| 4.7.9.5; 4.7.10.4 | Fixed: wide PDF inventory pages increase width to the original 11-inch height (11 × 11 inches), without rotating their content. The Word template's 11 × 8.5 paper section is not silently treated as the standard's PDF rule. |
| 4.7.10.1–4.7.10.3 | Implemented: figure number/title below the image, item associations below inventory illustrations, title spacing and links. Manual inspection of the actual artwork's legends, index callouts and legibility is still required. No SSSN is invented. |
| 4.7.11 | No new TM chapter/volume/procedure structure is claimed. The supplied standalone SL-3 hierarchy is used. An alphabetical index above the standard's paragraph threshold and revisions to the stock-list structure remain outside the MVP; do not claim support for such deliveries. |
| 4.8 | Fixed preface preserved. Nomenclature, descriptions, technical facts, abbreviations, units, artwork labels and applicability are supplied by authors. Machine validation cannot prove FEDLOG correctness, proper terminology, safety analysis or classification authority. The MVP does not author procedural warnings, equations, wiring diagrams or maintenance procedures. |
| 4.9; Table III | Fixed: single-column TOC plus linked illustration/table lists. Marine Corps front matter does not inherit Air Force/Navy-only verification-status, LOC or LEP requirements. No empty list of illustrations is generated when there are no numbered figures. |
| 4.9.1–4.9.1.2; figure 16 | Supplied cover/authentication frame, 2-inch seal, four-line long-title/two-line nomenclature checks, six end-item rows or cover continuation. Actual acquiring-activity cover authorization is external. |
| 4.9.1.3–4.9.1.9 | Navy-only manufacturer/contract/disclosure provisions are not applied. Supersedure is supported, but revision/change-package and multi-volume deliveries are not claimed by this MVP. |
| 4.9.1.10–4.9.1.12 | Distribution A–F and fill-ins/reasons checked; export warning and destruction notice rendered as applicable; CUI designation and classification authority blocks checked. Program office must supply the correct determination. |
| 4.9.1.13–4.9.1.14 | Acquiring-activity authority notice/rights legends remain a release dependency for content that needs them. No license or authority notice is invented. |
| 4.9.1.15–4.9.1.16 | Fixed: `30 OCTOBER 2026` form for SL-3 and last working day of signing month, with holidays and supplied office closures. Change-number/date releases are not claimed. |
| 4.9.2–4.9.6 | Marine Corps warning-page options depend on actual hazards/acquiring-activity direction. Air Force/Navy LEP/LOC/verification pages and paper-only change records are not fabricated. |
| 4.9.7–4.9.10 | Fixed: linked TOC, illustration/table lists, immutable preface and special notes. Additional contract-required related-publication/directive/international-agreement records require sponsor-supplied information and additional support. |
| 4.9.11 | Safety-summary provision is marked for Air Force/Navy. This is not treated as a Marine Corps automatic insertion requirement. |
| 4.10–4.10.4 | Fixed: outline hierarchy, collapsed parents, figure/table title entries, ordered section/paragraph bookmarks and actual destination-page resolution. |
| 4.11 | PNG/JPEG/single-page PDF assets are validated and retained through recovery/portable drafts. Minimum artwork lettering, source resolution, engineering correctness, leader lines, photograph approval and rights require artwork review; file-type acceptance is not evidence of those properties. |
| 4.12 | Original-publication MVP only. Formal revisions/change packages, change symbols and changed-page tracking are not implemented or represented by undo history. |
| 5.1–5.7 | MVP drafts/preview and PDF exports are supported. This is not an approved RDC/PTM/FRC delivery, printed backbone, supplement, brief-manual or combined-manual system. |
| Table I font footnote | **Open, material limitation:** production embeds Nimbus Roman regular/bold, not Times New Roman. Installed OS fonts do not establish redistribution rights or browser-engine support. No Times New Roman compliance claim is made. |
| Table II | Letter cover/front matter; widened PDF inventory pages; text/art stays within the permitted reproduction area. Actual source table grid widths are preserved for the seven-column layout. |
| Section 6 and appendices | Acquisition/tailoring notes, referenced deliverables and DTD/digital-source obligations are not satisfied merely by producing a PDF. SGML/XML source delivery and contract acceptance are outside the MVP. Appendix A safety-writing guidance applies to author-provided safety content. |

## Supplied-template comparison and exceptions

- The portrait inventory grid is 9,852 twips (6.8416667 inches); the landscape grid is 14,214 twips (9.8708333 inches). The seven-column renderer now uses these actual physical grids, including the twelve individual periodic-inventory cells. Previously it used invented percentages.
- Rows include category headings within the sixteen-row ceiling. The user can reduce the maximum to fit long descriptions. A measured whole-sheet guard refuses a layout that would otherwise run onto a second page before its illustrations.
- Parent items cannot end a sheet without their first child. Child quantities print in identification and leave the quantity column empty. Stable IDs, subtree moves/deletion, same-category ancestry, contiguous groups and two-level nesting are checked.
- SSRI appears once; collateral appears only when used; UURI remains present even when empty. Unassigned NSNs remain blank with part number/CAGE supplied; serialized flags and inventory legends/signature spaces are retained.
- Fixed preface prose is retained, Special Notes remains present with None when empty, sequencing exceptions are explicit, and optional-column use is disclosed there. Illustration and special-note references remain linked after reordering.
- **Tailoring not established:** the supplied templates do not give an eight-/nine-column physical grid. Optional columns take space from identification/remarks while preserving NSN/periodic-cell widths. This is documented behavior, not an approved deviation from the no-width-change instruction.
- **Source conflicts:** Word instructions center footer page numbers and disagree about preface start (portrait iii, landscape i). MIL-STD PDF right-edge numbering and sequential front matter are used. PDF navigation lists add pages that make the Word examples' fixed v/vii page references inapplicable.
- **Unresolved wording conflict:** immutable preface headings contain SSRI/UURI acronyms, which are carried verbatim into the matching TOC/bookmarks. The standard restricts title acronyms. This requires a source-template correction or approved tailoring; the MVP does not silently rewrite the prescribed prose.
- **Conditional features not implemented:** dedicated critical-item symbols and effectivity/applicability-code authoring are not supported. Publications requiring these features need additional implementation and review.
- **Human review still required:** official nomenclature/capitalization, no acronym misuse in titles, FEDLOG units, completeness, controlled markings, image rights/legibility and authorized signing. The editor cannot verify these against authoritative program records.

## Validation evidence

The audit adds tests for source-manual/unit-of-issue requirements, TAMCN association/ratio checks, prohibited by-direction signing, navigation page references and real PDF link destinations, exact table-column geometry, PDF landscape geometry, no cover number, control banners and cover-PCN clearance, and oversized-sheet refusal/recovery with a smaller row limit. The advertised Companion cross-product test now uses an SL-3 publication fixture instead of a letter fixture; this was the failing CI case.

Inspected rendered cases include the full thirteen-page production fixture with long technical data, native portrait and widened inventory layouts, nested items/optional columns, overflow covers, sheet-height refusal/recovery, and synthetic CUI/SECRET publications. A measured figure block keeps the image, caption and anchor together when preceding content moves it to a later page. Fixed preface notes keep NOTE with its text. Controlled covers reserve clearance between notices/PCN and the bottom banner.

Production text measurements place the unclassified running title at approximately 36 bp from the top edge (56 bp below a control banner) and page-number glyph bottoms approximately 36 bp above the lower edge. PDF font inspection confirms embedded Nimbus Roman regular/bold, preserving the open Times New Roman finding.

Passing tests do not replace the open font/tailoring and sponsor-data requirements listed above. Local validation:

- Unit/component and coverage run: 3,227 tests in 273 files passed; statement coverage 61.97%, with configured gates passing.
- Full integration suite: 1,366 tests in 72 files passed during the audit; the final SL-3 render/export rerun passed all fifteen tests after the last layout corrections.
- Pairwise native LaTeX matrix: all twenty SL-3 combinations passed.
- TypeScript, ESLint, production build, Companion build and generated-template synchronization passed.
- Production PDF inspection verified actual page references/destinations, collapsed outline hierarchy, URI links, authentication widget placement and lower cover-banner clearance. CUI/SECRET fixtures contain synthetic information only.
- Hosted upgrade inspection exposed a cache mismatch: the new generator could load the preceding SL-3 template from the service worker's cache-first store. The template script URL is advanced to v13 so existing installations fetch the matching macros. This is verified by reopening the existing synthetic branch-preview draft after deployment.
- Linux CI exposed a row-height defect in older `array` versions (also used by the production engine): an explicitly ended description paragraph gained an empty line when the outer p-column closed. Description text now uses a local paragraph box, retaining indentation without the extra line. The original boundary fixture is restored. The failing TeX files were reproduced and recompiled successfully with TeX Live 2023 in Ubuntu 24.04; the same sheet-height limit remains in force. Five valid rendered cases (wide, nested/optional, cover overflow, CUI and SECRET) also compile twice under that Linux toolchain. A production-engine regression now exports the full optional-column boundary fixture. Boundary assertions exclude the contents page, and independent tall-sheet refusal/recovery tests remain intact.

CI status is live on PR #359. The previous compile-matrix failure was the generic-letter fixture used for SL-3; that case now uses the valid SL-3 publication fixture. The PR remains a draft because the material compliance exceptions above are unresolved.

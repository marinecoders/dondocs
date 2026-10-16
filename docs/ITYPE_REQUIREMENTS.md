# I-Type requirements and acceptance

The baseline is MIL-DTL-28999D(MC), 10 February 2020, with MIL-STD-38784C,
4 September 2024. Detail-specification requirements take precedence over its
references under section 2.4, subject to the contract. The supplied MARCORSYSCOM
template and email do not establish approved tailoring. No tailoring record or
license to distribute Times New Roman has been supplied.

This table tracks the requirements examined in PR #270. It is not a complete
certification of the specifications. A requirement is closed only by a cited
check, manual review, or written approval that applies to the publication.

| Requirement | Authority | Acceptance evidence / remaining work |
|---|---|---|
| Subtype, required sections, conditional sections, prescribed administrative text | DTL §§3.3.2.1–3.3.2.15 | `publicationStructure.test.ts` and production MI/TI/SI/LI fixtures check section identity, mandatory administrative content, order and valid variants. Technical applicability remains a review item. |
| Effective date | DTL §3.3.1.4 | `publicationDate.test.ts` covers signing month, observed holidays and additional closures. Final export enforces the result. Assumes a Monday–Friday office calendar; actual signing remains external. |
| Table contents and numbering | DTL §§3.3.2.7–3.3.2.10 | `iTypeCompliance.test.ts` and `publicationTableValidation.test.ts` check item sequences, attachment, quantities, stock identifiers, CAGE alternatives, last-resort identification and open-purchase details. The MI software/firmware mode replaces the NSN column with Current Software/Firmware (S/F) Version. Official nomenclature and completeness require technical review. |
| Wording and reading level | DTL §§3.1.2–3.1.3, 3.3.2.14 | Editorial review of acronyms, ninth-grade coverage, subtype wording and part references. Heuristic warnings are not proof of compliance. |
| Safety callouts | DTL §3.1.4.3 | PDF tests for order and keeping callouts with their text. Technical review establishes hazard content and applicability. |
| Internal references | STD §4.8.1 | `publicationReferences.test.ts` and production PDF tests check linked paragraph, figure, table and table-footnote references, renumbering, saved-document restoration and destinations after enclosure merging/signature-field insertion. Footnotes are cited inside their own table cells with linked superscripts and consecutive numeric labels. Deleting a note updates remaining citations. Bookmarks include printed paragraph labels; unrelated URLs do not exempt unlinked internal references. External citations support `[publication and location](https://source)`; source availability and location accuracy require review. |
| Font | DTL §3.1.1 | OPEN: renderer embeds Nimbus Roman, not Times New Roman. Obtain a distributable font license or approved substitution before format acceptance. |
| Cover, authentication, supersedure | DTL §§3.2, 3.3.1, 3.3.2.3, 3.3.2.16–18; supplied template | OPEN: resolve conflicting placement and order with the acquiring activity. Do not treat a template as a waiver. |
| Headers and pagination | DTL §§3.1.6, 3.3.1.3; STD §4.7.2.2.1 | Production PDF tests check short titles and bold page numbers at the left on even pages and right on odd pages, including cover-list overflow and appendix numbering. Page 1 prints its PCN immediately above its numeral. Classification banners remain separate. |
| External enclosures | DTL §3.1.8.1; STD §§4.7.1, 4.8.9 | Attached source documents receive an upper-right short title and an enclosure number above their first page number, on the first page only. Added wrapper pages block export. PDF tests check wide and rotated content, all three fitting modes, and reserved identifier margins. Source-specific numbering, markings and readability still require review. |
| Blank pages and reproduction area | DTL §3.1.6; STD §§4.1, 4.7.4, 5.3.3 and Table II | OPEN: establish paper versus PDF delivery and the applicable page-area profile. Current PDF output adds no blank pages and retains the 6.5-inch text block. |
| Titles and tables | DTL §§3.1.4, 3.3.1.6; STD §§4.7.9.2–3 and Table I | Production PDF tests enforce the four-line long-title limit, centered table captions approximately 18 points above the grid, 0.75-point rules, open continuation feet and a single final closing rule. Every column set, item-column variant and software mode fits the chosen text block. TeX rejects oversized indivisible body-table rows/groups; parent/component boundaries remain together. |
| Distribution statements | DTL §3.1.9.1; DoDI 5230.24 (2023) | `distributionSensitivity.test.ts` permits unclassified restricted distribution; export rejects Statement A with export-controlled or CUI/classified content. The reviewed DoDI Table 1 reason matrix agrees with the implementation. Export warnings require B–E and the Export Controlled reason, and that reason requires the warning. The release-accompanying notice and complete release workflow remain open; record public-release approval outside the editor. |
| CUI and classified markings | DoDI 5200.48; DoDM 5200.01 | `classificationValidation.test.ts` checks optional CUI portion markings. The designation block uses the distribution statement instead of an additional LDC; production tests inspect the resulting PDF. I-Type export requires an original/derivative basis, applicable authority fields and paragraph/graphic markings. Production tests place the applicable authority block on the cover. Custom banners cannot bypass controlled markings; destruction notices follow sensitivity. Detailed exceptions, classification decisions and enclosure/content-specific markings still require current-authority review. |
| Procedure structure and skills | DTL §§3.3.2.13–14; STD §4.7.11.5.3 | Steps must be untitled and placed under a body procedure heading. Skills/time checks reject empty entries, missing titles/durations and invalid sub-hour increments. Actual MOS selection, time estimates and technical adequacy remain review items. |
| Publication identifiers | MCO 5215.17D, enclosure 1, chapter 2 §2.b | `identifiers.test.ts` covers ID, multi-model ID, FSC and SSIC basic-number shapes and excluded I/O suffixes. Syntax validation does not assign or approve a publication number. |
| Publication management and authentication | MCO 5215.17D | OPEN: full-text review still required. MCPEL lists the order as current; official PDF retrieval returned HTTP 403 during verification. |
| Technical validation and verification | DTL §§4.1–4.2 and acquisition requirements | Retain required technical validation, verification and signing/release records. Software cannot approve equipment procedures. |
| Deliverables and sensitivity labels | Contract/acquisition requirements; supplied template | OPEN: establish required authoring/final formats and downstream labeling/protection. Visible PDF banners do not apply Microsoft sensitivity labels. |
| Template API compatibility | DonDocs companion contract | `companion-mcp-client.test.ts` retrieves every bundled template through a validating protocol client. Companion exports reject I-Type because its input contract lacks publication fields and preflight checks. |

## Verification sequence

1. Run unit and component checks for all affected authoring and export paths.
2. Run the companion protocol-client test and complete integration matrix.
3. Compile MI, TI, SI and LI samples with the production SwiftLaTeX engine.
4. Inspect final PDF text, fonts, links, pagination, callouts, tables and signatures.
5. Record remaining authority decisions here and in the PR; do not label them passed.

## Sources

- [MIL-DTL-28999](https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=19976)
- [MIL-STD-38784](https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=116799)
- [MCO 5215.17D listing](https://www.marines.mil/News/Publications/MCPEL/Search/5215/)
- [DoDI 5230.24](https://www.esd.whs.mil/Portals/54/Documents/DD/issuances/dodi/523024p.pdf)
- [DoD CUI portion marking](https://www.dodcui.mil/Training/Portion-Marking/)

## Review limits

No full-compliance declaration is made. Font and template-layout decisions remain
open, as do the complete current marking-authority review, publication-office
approval and publication-specific technical validation. The user confirmed that
no tailoring record or distributable Times New Roman license is available.

Additional marking guidance used for the corrections:

- [Distribution statements and CUI are separate](https://www.dodcui.mil/Home/Marking-Tips-for-CUI-Documents/Distribution-Statements/)
- [CUI designation indicator block](https://www.dodcui.mil/Home/Marking-Tips-for-CUI-Documents/CUI-Designation-Indicator-Block/)
- [Observed federal holidays](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/)

The [correction plan](ITYPE_REMEDIATION_PLAN.md) records the implementation order.
Current ALPS-HDBK-004 and MCSCO 4130.2 copies, applicable local policy and program
records are still needed to complete their review. The software-version column
implements the explicit DTL requirement without claiming the unverified reporting
workflow. Software authorization is outside this I-Type document audit.

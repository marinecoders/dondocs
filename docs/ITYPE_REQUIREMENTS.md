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
| Subtype, required sections, conditional sections, prescribed administrative text | DTL §§3.3.2.1–3.3.2.15 | Validate section identity, order and content for MI, TI, SI and LI. Preserve permitted omissions, promoted subsections and action-specific procedure titles. |
| Effective date | DTL §3.3.1.4 | Last working day of signing month; account for observed federal holidays and office closures. Signing remains an external action. |
| Table contents and numbering | DTL §§3.3.2.7–3.3.2.10 | Validate applicable item sequences and required identifiers. Official nomenclature, completeness and applicability require technical review. |
| Wording and reading level | DTL §§3.1.2–3.1.3, 3.3.2.14 | Editorial review of acronyms, ninth-grade coverage, subtype wording and part references. Heuristic warnings are not proof of compliance. |
| Safety callouts | DTL §3.1.4.3 | PDF tests for order and keeping callouts with their text. Technical review establishes hazard content and applicability. |
| Internal references | STD §4.8.1 | Linked paragraph, figure, table and table-footnote references; verify destinations after PDF assembly. External publication references need a valid available source. |
| Font | DTL §3.1.1 | OPEN: renderer embeds Nimbus Roman, not Times New Roman. Obtain a distributable font license or approved substitution before format acceptance. |
| Cover, authentication, supersedure | DTL §§3.2, 3.3.1, 3.3.2.3, 3.3.2.16–18; supplied template | OPEN: resolve conflicting placement and order with the acquiring activity. Do not treat a template as a waiver. |
| Headers, pagination, blank pages and enclosures | DTL §§3.1.6–8, 3.3.1.3; STD §§4.1, 4.7.4 | OPEN: resolve template differences and paper/PDF delivery requirements before changing the layout. |
| Titles and tables | DTL §§3.1.4, 3.3.1.6 | Measure the four-line long-title limit in TeX. Exact template geometry and numbered table-title placement remain subject to format review. |
| Distribution statements | DTL §3.1.9.1; DoDI 5230.24 (2023) | Separate distribution from classification. Verify complete statement/reason matrix against the full current issuance; record public-release approval outside the editor. |
| CUI and classified markings | DoDI 5200.48; DoDM 5200.01 | Correct optional CUI portion-marking guidance. Review required blocks, notices, separate graphic/caption markings and enclosures against current authorities. |
| Publication management and authentication | MCO 5215.17D | OPEN: full-text review still required. MCPEL lists the order as current; official PDF retrieval returned HTTP 403 during verification. |
| Technical validation and verification | DTL §§4.1–4.2 and acquisition requirements | Retain required technical validation, verification and signing/release records. Software cannot approve equipment procedures. |
| Deliverables and sensitivity labels | Contract/acquisition requirements; supplied template | OPEN: establish required authoring/final formats and downstream labeling/protection. Visible PDF banners do not apply Microsoft sensitivity labels. |
| Template API compatibility | DonDocs companion contract | Every bundled template validates against the published response schema without dropping publication fields. |

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

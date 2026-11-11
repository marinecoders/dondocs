# Reference sources and editions

[Documentation index](README.md) · [Machine-readable inventory](reference-sources.json)

Bundled manuals, orders and standards are stored in [references/](references/). This inventory identifies the bundled bytes and the edition used for repository work. It is not a declaration that every reference is currently controlling. Acquisition dates were not recorded; `null` means unknown, rather than an invented download date. Inspection was performed on 10 November 2026.

| Bundled source | Edition / pages | Implementation scope | Edition-status review |
|---|---|---|---|
| [5216.5  CH-1.pdf](references/5216.5%20%20CH-1.pdf) | SECNAV M-5216.5, June 2015; Change 1, 16 May 2018; 159 pages | Correspondence layouts and native TeX reference | Authority site access was limited; currentness requires manual verification. [Authority](https://www.secnav.navy.mil/doni/SECNAV%20Manuals1/5216.5%20%20CH-1.pdf) |
| [MCO 5215.17D.pdf](references/MCO%205215.17D.pdf) | 26 October 2016; 24 pages | Technical-publication management/source basis | Cover identified; currentness requires manual verification. [Authority](https://www.marines.mil/Portals/1/Publications/MCO%205215.17D.pdf) |
| [MCO P1070.12K W CH 1.pdf](references/MCO%20P1070.12K%20W%20CH%201.pdf) | Basic order 14 July 2000, with Change 1; 259 pages | NAVMC 118(11) context | Cover identified; catalog access was partial; currentness requires manual verification. [Authority](https://www.marines.mil/Portals/1/Publications/MCO%20P1070.12K%20W%20CH%201.pdf) |
| [MIL-STD-38784C.pdf](references/MIL-STD-38784C.pdf) | Revision C, 4 September 2024; 136 pages | Technical-manual style/source basis | DLA ASSIST record directly checked 10 November 2026: active revision C, 136 pages. [Authority](https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=116799) |

## Provenance and updates

`reference-sources.json` records paths relative to `docs/`, SHA-256, title, edition/change, source URL, inspection date, acquisition-date status and feature mapping. `npm run docs:check` verifies the local PDF hashes. A matching hash establishes identity, not currency or correct interpretation. The Navy CH-1 link is the intended edition-specific source; access restrictions/timeouts during review do not establish a dead link.

The DLA ASSIST record directly lists active MIL-STD-38784 revision C dated 4 September 2024, matching the local PDF. For the other sources, confirm current status with the issuing authority before replacing a PDF or rewriting normative requirements. Record the actual acquisition date and authority status at that time; retain the edition used to assess earlier output.

MCO 5216.20B and its applicable administrative changes, publication-specific specifications such as MIL-DTL-28999, and signing-authority/deviation memoranda are also cited by product/source guidance but are not all bundled here. Their absence from this four-file inventory is not evidence of inapplicability. Review the specific specification revision and applicable authority basis for a real publication; do not infer them from an example or program-manager title.

When changing a reference: verify the issuer/edition, replace bytes deliberately, update the manifest checksum/source/date/status, identify affected formats, and recheck relevant rules/rendered examples. Keep historical audit/test records dated; they describe the reference and implementation reviewed then.

## Manual checks still open

- Directly confirm current SECNAV/MCO catalog status and applicable changes where access was blocked or partial.
- Record provenance/current applicability for supporting technical-publication specifications and authority/deviation sources.
- Verify any newly acquired form through the separate official-source and human-review process in [form authoring](FORM_TEMPLATES.md).

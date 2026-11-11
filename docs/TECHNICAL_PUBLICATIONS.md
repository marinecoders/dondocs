# Technical publications

[Documentation index](README.md) · [Output capabilities](CAPABILITIES.md) · [Companion contract](COMPANION.md)

These formats produce **PDF only**. They use structured publication metadata and preflight checks, rather than only a letter's From/To/Subject. Preflight checks incomplete or contradictory inputs; it does not assign publication numbers, approve distribution or establish signing authority.

## Choose a family

| Format | Intended scope | Content model |
|---|---|---|
| I-Type (`i_type`) | Modification (MI), Technical (TI), Supply (SI) or Lubrication (LI) Instruction | Ordered sections, paragraphs, fixed tables, figures, callouts and procedures. |
| SL-3 (`sl3`) | Standalone components-list extract | Structured inventory, category/parent relationships, notes, figures and source references. |
| SL-4 (`sl4`) | Standalone repair-parts list | Structured parts/CAGE data, illustration assignments, indexes and revision information. |
| TM/IETM front matter (`tm_ietm_front_matter`) | Cover and authentication packet for the selected manual subtype | Publication, equipment, notices/rights and signing metadata. Does not author a complete TM, interactive manual or body work packages. |

Choose a format in the correspondence picker, or load the matching technical template from **Templates**. Template bracket prompts are authoring reminders and must be replaced; they are not approved publication data. The generated [inventory](PROJECT_INVENTORY.md) lists the current template IDs.

## Common workflow

1. Enter the assigned short title, PCN, long title/nomenclature and equipment identifiers. Keep identifiers as strings, including leading zeroes. Use assigned values; the application's syntactic check does not establish that an identifier is real.
2. Enter the effective/publication date and planned/actual signing date. The editor validates their relationship and allows office-closure dates where supported. Companion requests must supply explicit publication dates: `date` in `d MMM yy` form and nested `signingDate` in `YYYY-MM-DD` form.
3. Complete the issuing entity/address, authorized signer/title and controlling office. Use the format's authentication controls; publication signing cannot be delegated merely by selecting a correspondence “by direction” option.
4. Select the actual distribution determination and fill its required reason/date/office fields. CUI/export-control choices must agree with distribution and applicable notices. Statement A conflicts with controlled/export-restricted information; a selector is not release approval.
5. Complete the family-specific sections below. Replace remaining prompts/variables and resolve the preflight messages, which direct you to the relevant sections.
6. Review the full PDF, including cover, notices, authentication, tables and figures. Sign the final PDF externally in a compatible signing application.

I-Type uses Times 12 pt; SL-3, SL-4 and the supported TM/IETM profile use Times 10 pt. The prepared renderer sets/checks the family-specific profile. Custom correspondence settings do not remove these publication requirements.

## I-Type instructions

Start with the relevant MI/TI/SI/LI template. Preserve the required structure, including Purpose and Administrative Instructions. Fill the originating-office contact and required reporting instructions; do not replace required text with a bare heading. MI-only urgency/time-compliance fields do not apply to TI/SI/LI. An urgent MI needs a valid completion date.

An included item section must carry its corresponding populated fixed table. Free text under an item-section heading does not replace that table. Use the section/table controls, populate the required columns and attach each nonempty table to exactly one appropriate paragraph. Remove an inapplicable optional section rather than keeping an empty table. The editor checks required descriptions, item ordering/numbers, identifier modes and supported columns. Software/firmware changes use the MI software identifier mode where supported.

Figures require actual PNG/JPEG or single-page PDF bytes and a caption. Review their markings; unsupported/missing assets block a valid export. Preserve stable publication-reference IDs when revising linked paragraphs, figures and tables. Cross-references are not arbitrary URLs: use the editor's publication-reference controls. Order warnings/cautions/notes and procedure steps through their dedicated controls rather than manually typing numbering.

## SL-3 components lists

Complete the source technical-manual reference and technical data. Enter the inventory as components in their supported categories, with positive quantities, unit of measure/issue and official nomenclature. An unassigned NSN requires the alternative part-number/CAGE data; do not invent an NSN to satisfy validation.

Keep child components immediately after their parent in the same category, within supported nesting depth. Use alphabetical order within groups or explain the sequencing in Special Notes. TAMCN associations/ratios require the configuration source and a matching primary end item. Optional model/figure-reference columns require the Fielding Plan reference. Assign every illustration to an end item/component and resolve note/figure references.

## SL-4 repair-parts lists

Complete the standalone source/maintenance references and publication cut-off date; cut-off cannot follow the effective date. Populate the structured parts rows, associated CAGE entries, required figure/item references and applicable indexes/revision information. The validator reports blocking findings by field/row rather than accepting an arbitrary body paragraph as parts data.

Assign each illustration to the end item or a repair part. The end-item illustration title must match its nomenclature. Review lettering for every used illustration: declare no lettering, or supply all labels as complete single-line searchable text with unique IDs. The optional circuit index is included only when applicable data is supplied.

## TM/IETM front matter

Choose TM, COTS, QRG, RPSTL, supplement, TM with RPSTL, user manual or IETM subtype. The resulting packet is front matter only; choosing IETM does not generate an interactive application.

Complete equipment rows (identification/model required), publication identifier/basis, issuer/mail address, technical-content contact, notices and authentication. Sponsor-assigned numbering requires the assigning activity/approval reference. A volume needs its number, total and subtitle; a supplement must identify the supported publication.

Confirm the signing authority basis. Product Manager deviation or other approved authority requires its applicable reference; a title alone does not establish authority. Review contract/rights conditions and copyright credits. The current profile refuses required limited-rights legends it cannot produce; use an approved profile for that case. This profile supports unclassified/CUI packets and up to 38 end items on one continuation page. It does not accept correspondence paragraphs, references, enclosures or I-Type attachments/tables.

## Reproducible companion examples

The files below contain **fictional training data and invented identifiers**, not release determinations or assigned publication numbers. They are accepted by the current request schema and publication preflight. Do not use them as real official publications.

- [I-Type MI request](examples/i-type.json)
- [SL-3 request](examples/sl3.json)
- [SL-4 request with a synthetic drawing](examples/sl4.json)
- [TM front-matter request](examples/tm-front-matter.json)

Start the companion as described in [COMPANION.md](COMPANION.md), then render one example:

```sh
curl --fail-with-body http://127.0.0.1:7712/generate \
  -H 'content-type: application/json' --data-binary @docs/examples/i-type.json
```

Use the other file paths to exercise each family. The response names a local output file; it does not embed the PDF. `npm run docs:check` validates all four checked-in requests without rendering or writing user defaults. Template authors should also follow [content-template fields](CREATING_TEMPLATES.md#template-fields), especially `publicationType`, `manualFrontMatter` and section/table metadata.

The bundled [reference inventory](REFERENCES.md) records editions. Product scope and code citations do not substitute for checking the current governing publication and any applicable authority/deviation.

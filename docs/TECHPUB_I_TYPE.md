# I-Type technical publications

PR #270 adds PDF generation for Modification (MI), Supply (SI), Technical (TI),
and Lubrication (LI) Instructions using the supplied MARCORSYSCOM I-Type template.
The format remains subject to publication-office approval of the differences
listed below. Software checks do not establish approval to release a publication.

## Governing sources

- MIL-DTL-28999D (MC), 10 February 2020: the I-Type detail specification.
  Section 2.4 establishes precedence over its references unless otherwise specified;
  section 3.1.1 incorporates MIL-STD-38784.
- MIL-STD-38784C, 4 September 2024: general technical manual requirements.
- Supplied `1. I-Type Template.docx` and accompanying program-office email.
  The email calls for compliance with MIL-STD-38784C. It does not document an
  approved exception to MIL-DTL-28999D.
- DoDI 5230.24: distribution statements and release determinations.
- DoDM 5200.01 and DoDI 5200.48: applicable marking requirements.
- SECNAV M-5216.5 and MCO 5216.20B govern correspondence. Their letter-format
  rules do not replace the technical publication specifications.

## Generated document

The cover includes the seal, publication identification, end-item table,
distribution statement, applicable notices, and PCN. Unused cover rows remain
blank. The renderer measures the table and notices; if the cover would overflow,
it moves the entire end-item list to a continuation page. If the remaining cover
content still does not fit, compilation stops with an error.

The authentication page centers the command and address, right-aligns the date,
and leaves four blank lines for the signature. The digital-signature field occupies
that space. An authorized signer must still sign the resulting PDF.

Body text uses the renderer's Times-compatible font at 12 points. Paragraph and
procedure spacing, warning groups, table headings, and initial parent/component
rows have layout constraints. Tables have numbered titles. Figures have numbered
captions and may carry separate graphic and caption portion markings. Appendices
restart figure and table numbering with their letter.

PDF bookmarks cover the front matter, headings, figures, tables, appendices, and
enclosures. The compile pipeline resolves destinations from page annotations
because SwiftLaTeX's named destinations otherwise point to page 1. Enclosure merging
preserves the existing destination tree. Signature-field insertion retains it.

## Content and export checks

- Urgency is restricted to MIs. Switching to SI, TI, or LI clears the MI urgency
  and date. Imported incompatible states are rejected at export.
- The completion-date field supplies an urgent MI's Time Compliance Period.
  It replaces stale dates in that paragraph and creates the paragraph when absent.
  The date must precede the publication date's calendar-year anniversary.
- Export requires a distribution statement and its applicable reason, determination
  date, and controlling office. Statement A records a release determination;
  selecting it does not supply the required written approval.
- Export checks required identification and signature fields, font settings,
  unresolved template prompts, missing figure references, procedure subdivisions,
  callout order, and required sections with their prescribed order and administrative content. Draft previews remain available while fields are incomplete.
- Every referenced figure must resolve to valid bytes for the current compile.
  Attachment-specific filenames and a compile-level check prevent a reused engine
  from substituting an older drawing. A failed preview clears the previous PDF.
- PNG, JPEG, and single-page PDF figures are supported. Multi-page PDFs are rejected
  as figures; attach the complete drawing as an enclosure. The check also runs on
  imported documents and direct renderer calls.
- Missing or invalid enclosures block I-Type download. Custom and derived markings
  pass through to appended enclosure pages. One-page enclosures receive page numbers;
  publication headers use Times Bold 10 and numerals use Times 12.
- Readability remains an estimate, with a ninth-grade warning threshold.
  Acronym checking includes uppercase headings. Neither replaces editorial review.

## Authoring and references

Choose a paragraph's Section to identify prescribed content. Procedures may have
an action-specific title; the section identity remains when the title changes.
Older documents with recognized headings still load without rewriting their text.
Ambiguous headings must be identified before export.

The effective date is checked against the planned or actual signing month. The
calendar excludes weekends and observed U.S. federal holidays. Enter additional
office closures on the cover form. This assumes a Monday–Friday office workweek;
a different office calendar still requires review. Recheck the date when signing
moves to another month.

Use the editor's Insert menu (`@`) to add paragraph, figure, table or table-footnote
references. References retain their target when paragraphs move; their displayed
numbers update. A deleted target blocks export. Typed internal references must be
replaced with linked references. For an external publication, provide its URL and
review the cited location. Table footnotes are entered on the paragraph carrying
the table. Reference links are blue and underlined in the PDF.

Distribution restrictions do not establish a CUI designation. Unclassified
restricted-distribution documents are allowed. CUI portion markings are optional;
if used, apply them consistently. The CUI designation block identifies the
organization, office, category, distribution statement and office mailbox. It does
not print an additional LDC alongside the distribution statement.

The renderer checks the actual four-line long-title limit. Nimbus Roman and the
supplied template's unresolved layout differences remain as listed below.

## Decisions still required before format approval

| Topic | Implemented profile | Required decision |
|---|---|---|
| Cover and authentication order | Supplied template's separate cover and authentication page | Reconcile with MIL-DTL-28999D §§3.2 and 3.3.1.1, including cover-header and supersedure placement. |
| Page numbers | Centered footer | Resolve the template, MIL-DTL-28999D §3.1.6, and MIL-STD-38784C PDF pagination differences. |
| Enclosures | Repeated centered publication header and enclosure footer | Reconcile with MIL-DTL-28999D §3.1.8.1 first-page identification and short-title placement. |
| Tables | Supplied column sets, proportional widths, numbered bold titles | Confirm exact geometry and the template's otherwise untitled table examples against MIL-DTL-28999D §3.1.4. |
| Font | Embedded Nimbus Roman, a Times-compatible font | Confirm an approved substitute for the specified Times New Roman, or supply a distributable licensed font. |
| Delivery | PDF | Confirm required authoring, review, and final delivery formats and blank-page conventions. |
| Sensitivity labels | Visible PDF markings | Establish the downstream labeling/protection process; visible banners are not Microsoft sensitivity-label metadata or encryption. |

Retain the contract or approved tailoring record with the publication's release
record. Confirm the applicable MCO 5215.17D requirements and current distribution
and marking authorities with the publication office. The implementation does not
create a waiver or certify technical validation, signing authority, equipment
safety, or public-release approval.

## Verification

`tests/integration/i-type-compliance.test.ts` exercises both local PDFLaTeX and
the production SwiftLaTeX engine. It reads the generated PDFs to check body font
size, authentication alignment and signature space, cover notices, safety groups,
table pagination, markings, procedure spacing, bookmark destinations, enclosure
numbering, and signature placement. It also reuses an engine across drawing changes
to check missing and multi-page figure rejection.

`tests/unit/publicationStructure.test.ts` and `tests/unit/publicationReferences.test.ts` cover section identity, subtype content, references, deleted targets and snapshot restoration. `tests/component/publicationAuthoring.test.tsx` checks the corresponding editor controls.

`tests/unit/iTypeCompliance.test.ts` covers export checks, calendar and leap-year
boundaries, stale date replacement, procedure parent boundaries, subtype changes,
font selection, separate graphic markings, and attachment resolution. Existing
I-Type rendering and enclosure suites cover the complete publication and other
layout cases.

Run the unit/component suite, the targeted integration suites, and the solution
build before updating the PR. Regenerate `public/lib/latex-templates.js` with
`node build-templates.mjs` whenever the TeX source changes.

The [requirements and acceptance record](ITYPE_REQUIREMENTS.md) tracks the next
checks and unresolved authority decisions. No approved tailoring record or license
to distribute Times New Roman has been supplied.

I-Type export requires the web editor. The companion can retrieve its templates,
but rejects PDF and DOCX export until its input contract supports the publication
fields and preflight checks.

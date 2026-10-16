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
The PCN sits immediately above the bold page-1 numeral at the right edge.
Succeeding short titles and bold page numbers align left on even pages and right
on odd pages, using the printed page sequence, including appendices.

The authentication page centers the command and address, right-aligns the date,
and leaves four blank lines for the signature. The digital-signature field uses
an explicit PDF destination in that space, so names repeated in the body or appendices cannot redirect it. A missing
signature destination blocks export. An authorized signer must still sign the
resulting PDF.

Appendix and enclosure lists appear before the first body paragraph, as in the
supplied template, and flow with the body instead of extending the authentication
page.

Body text uses the renderer's Times-compatible font at 12 points. Paragraph and
procedure spacing, warning groups, table headings, and parent/component
rows have layout constraints. Every indivisible body-table row/group is measured;
an oversized group stops compilation with instructions to shorten or divide it.
Tables have numbered titles approximately 18 points above the grid, 0.75-point
rules, and widths calculated from the actual text width, padding and rule widths.
Body and overflow tables omit internal horizontal row separators, leave continued
pages open at the bottom, and close once at the end. The cover retains six ruled rows.
Figures have numbered
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
  pass through to appended enclosure pages. Attached source documents receive the
  short title in the upper-right margin and the enclosure label above the numeral
  on their first page only. Every page receives a bold 12-point numeral at the
  applicable outer edge. The short title uses Times Bold 10.
- All enclosure fitting modes reserve space for added identifiers. Large and
  rotated pages retain an appropriate output area; the border mode is bounded by
  that area instead of always using 85% scale. Review source readability after
  reduction. Added enclosure cover pages are unsupported for I-Type; remove an
  imported cover-page setting before export.
- Readability remains an estimate, with a ninth-grade warning threshold.
  Acronym checking includes uppercase headings. Neither replaces editorial review.

## Authoring and references

Choose a paragraph's Section to identify prescribed content. Procedures may have
an action-specific heading on their containing paragraph; individual procedure
steps must be untitled and remain in the body, outside appendices.
Older documents with recognized headings still load without rewriting their text.
Ambiguous headings must be identified before export.

Enter each required skill with its MOS or title and a numeric time in hours.
Separate entries with semicolons or newlines. Times below one hour use tenths
of an hour. Technical reviewers must confirm the selected skills and task times.

The effective date is checked against the planned or actual signing month. The
calendar excludes weekends and observed U.S. federal holidays. Enter additional
office closures on the cover form. This assumes a Monday–Friday office workweek;
a different office calendar still requires review. Recheck the date when signing
moves to another month.

Use the editor's Insert menu (`@`) to add paragraph, figure or table
references. References retain their target when paragraphs move; their displayed
numbers update. A deleted target blocks export. Typed internal references must be
replaced with linked references. Cite external publications using
`[publication and location](https://source)` and review the cited location.
Enter table footnotes on the paragraph carrying the table, then use the cell's
footnote selector to insert a superscript reference. A note may only be cited
inside its own table. Deleting a numeric footnote removes its references and
renumbers the remaining notes. Reference links are blue and underlined in the PDF.

Materiel rows require quantities and applicable identification. Use the explicit
identification-exception field for a required-materiel item that cannot be
identified by NSN or part number, and record manufacturer and address for an
open-purchase special tool. For MI software or firmware tables, select the version
column and enter the current version. Switching modes preserves existing data;
clear incompatible stock identifiers or return to stock mode before export.

Distribution restrictions do not establish a CUI designation. Unclassified
restricted-distribution documents are allowed. CUI portion markings are optional;
if used, apply them consistently. The CUI designation block identifies the
organization, office, category, distribution statement and office mailbox. It does
not print an additional LDC alongside the distribution statement.

Classified publications require an original or derivative classification basis,
the corresponding authority information, declassification instructions and
portion markings. The authority block appears on the cover. Custom banners cannot
substitute for controlled or classified markings. Export-control warnings require
an applicable B–E distribution statement with Export Controlled as its reason;
that reason also requires the warning. Review the separate release-accompanying
notice before dissemination.

The editor allows more than six end items and explains when the list moves
behind the cover. The renderer checks the actual two-line nomenclature and
four-line long-title limits without shrinking either font. Nimbus Roman and the
supplied template's unresolved layout differences remain as listed below.

## Decisions still required before format approval

| Topic | Implemented profile | Required decision |
|---|---|---|
| Cover and authentication order | Supplied template's separate cover and authentication page | Reconcile with MIL-DTL-28999D §§3.2 and 3.3.1.1, including cover-header and supersedure placement. |
| Reproduction area | 6.5-inch text block with one-inch side margins; tables fit that width | Establish the applicable paper/PDF profile under MIL-STD-38784C §5.3.3 and Table II alongside the I-Type layout. |
| External documents | First-page source identification, reserved margins, no added wrappers | Review existing source identifiers, page numbering, markings and readability for each attachment. |
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
Rule coordinates verify continuation feet, table widths, line weight and caption
spacing. `i-type-enclosure-geometry.test.ts` checks large and rotated pages and
source content occupying the areas where identifiers would otherwise collide.

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

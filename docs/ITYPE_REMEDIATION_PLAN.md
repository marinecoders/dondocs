# I-Type audit corrections

Scope: the eight implementation groups identified in the governing-document
audit of PR #270 at `766f0138`. Enterprise software authorization, font
licensing and the overall specification/template layout decision are outside
this change set. Publication-specific technical review and release approval
remain required.

Implement the following commits in order. Each commit includes focused tests;
the final checks cover the complete application and representative rendered PDFs.

| Commit | Change | Acceptance |
|---|---|---|
| 1 | Enforce export-control combinations | A warning requires B–E and Export Controlled as the reason; the reason requires the warning. Test both directions and unaffected restricted publications. |
| 2 | Require classified I-Type authority information | Distinguish original and derivative classification, require their applicable fields and portion marks, and place the authority block on the cover. Test incomplete and complete synthetic documents. |
| 3 | Reject conflicting custom I-Type banners | Custom unclassified banners cannot bypass controlled/classified portion checks. Include separately marked figures. |
| 4 | Select I-Type destruction notices by sensitivity | Classified output uses classified destruction authority; B–F retain required notices. Check generated text and rendered cover fit. |
| 5 | Correct table footnotes | Insert linked superscript references in table cells; reject references outside their table and broken targets; number notes consecutively and render prescribed spacing/indentation. Verify links after PDF assembly. |
| 6 | Accept permitted short-title basic numbers | Support ID, multi-model ID, FSC and SSIC forms; exclude I/O ID suffixes without claiming assignment authority. |
| 7 | Validate materiel data and exceptions | Check applicable quantity and identifier requirements; explicitly represent last-resort identification and open-purchase details where needed. Preserve kit rows and valid CAGE rendering. |
| 8 | Reject titles on procedure steps | Keep the action heading on the containing procedure; individual steps are untitled. Cover imported states as well as editing. |
| 9 | Keep authored procedures in the body | Reject procedural steps in appendices and invalid body placement without rejecting ordinary reference appendices. |
| 10 | Require skills/time content | Reject an empty section and absent/invalid time information, including sub-hour precision. Leave MOS appropriateness and measured task time to technical review. |
| 11 | Correct PDF navigation | Bookmark titles include printed labels; unrelated URLs do not exempt internal references. Verify destinations after assembly. |
| 12 | Center table titles | Center initial and continuation titles with the required number/title separation; inspect long-title wrapping. |
| 13 | Support software/firmware version columns | Provide an explicit MI table mode for the prescribed alternative to NSN; persist it, render its heading and validate versions separately from stock numbers. Do not invent unverified MCSCO reporting rules. |

For each commit: inspect the diff, run relevant tests, stage only its files, and
use a short factual commit message without attribution trailers. Update the
requirements record with actual evidence and remaining limitations. Before
pushing, run unit/component and integration suites, type/build and lint checks;
inspect representative covers, tables, procedures and PDF references. Push to
the existing PR branch without rewriting its history.

The export-control release-accompanying notice, detailed original/derivative
classification exceptions, current local publication orders and handbook, and
program-specific technical/release records remain separate review requirements.
Generic validation must not be described as full compliance or approval.

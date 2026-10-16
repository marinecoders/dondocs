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

## Implementation record

The thirteen planned implementation commits are complete:

1. `8d479a7a` — export-control combinations.
2. `72fc6f41` — classification authority on the cover.
3. `964d1423` — conflicting custom markings.
4. `bb5ed4c8` — destruction notices.
5. `fbff6516` — table-cell footnotes.
6. `e567f6ba` — short-title formats.
7. `9c9c6fec` — materiel data.
8. `34671358` — untitled steps.
9. `a982cc9d` — procedure placement.
10. `4a32a541` — skills/time content.
11. `dc6ef9c5` — bookmarks and references.
12. `a1b0cbe6` — table-title alignment.
13. `be4e5355` — software/firmware version columns.

Final regression review also covered rows containing only identification details
and updated rendering assertions for the corrected titles and bookmark labels.
The requirements record distinguishes these implemented checks from remaining
publication-authority decisions and technical-content review.

## Header, enclosure and table audit

The follow-up audit at `c466d37d` identified ten layout defects. The user
approved all ten corrections, with font licensing still deferred.

| Finding | Commit | Result |
|---|---|---|
| T1: oversized body-table rows | `5f309dd4` | Measure every indivisible row/group and reject content that cannot fit below the repeated heading. |
| E2: clipped wide enclosures | `2fa8c849` | Bound scaling by the output area and account for source size and rotation. |
| E3: source/identifier collisions | `0c8a832d` | Reserve identifier margins in every I-Type enclosure mode. |
| H1: running short-title alignment | `e9965bed` | Align left on even printed pages and right on odd pages, including appendices. |
| H2: page numerals and PCN | `879b9491` | Use bold outer-edge numerals and place the PCN immediately above page 1. |
| E1: external-document identification | `0b44b2e0` | Put the upper-right short title and enclosure number on the source's first page only; reject added wrappers. |
| T2: continued closing rules | `af05a0d2` | Omit internal horizontal row separators and close only the final page. Preserve the fixed cover grid. |
| T3: rule weight | `fd918822` | Set I-Type rules to 0.75 PDF point. |
| T5: table widths | `cffd49b9` | Subtract actual TeX padding and rules; allocate the final column's remainder exactly. |
| T4: caption spacing | `462e3cfc` | Restore 18-point initial spacing and verify both initial and continued caption gaps. |

Final enclosure review also preserved landscape page proportions and added
checks for 0°, 90°, 180° and 270° rotations. PDF checks cover all eight column sets,
stock/software variants, omitted item columns, long end-item lists, and occupied
source margins. Rendered pages were inspected for cover notices and PCN, odd/even
identifiers, initial/continued/final tables, and wide/rotated enclosures.

These changes retain PDF output without inserted blank pages and the existing
6.5-inch text block. Paper delivery, the reproduction-area profile, cover and
authentication order, and publication-specific approval remain open in the
[requirements record](ITYPE_REQUIREMENTS.md).

# Form model and review boundaries

PR #264 uses a shared editor and PDF overlay renderer for static forms. The v2
model separates an answer from the places where it prints, and separates a
published form revision from each saved document. NAVMC 10274 and NAVMC 118(11)
retain their existing editors and renderers.

## Contract

`src/services/forms/model.ts` owns the schema, compiler and answer validation.
The generated [JSON Schema](form-definition.schema.json) describes structure;
`compileFormDefinition` also checks references, option domains, page bounds,
editor reachability and every row's placements. Authoring tools call this same
compiler through `npm run form-package`, rather than duplicating it in Python.

| Object | Responsibility |
| --- | --- |
| Definition | Semantic fields, options, required stage, sections and fixed row groups |
| Placement | Field/option binding, page, rectangle, print format and overflow policy |
| Template package | Immutable page bytes, checksums, dimensions and review evidence |
| Instance | Pinned definition, answers, stable row IDs and answer revision |
| Document record | Independent ID, title, snapshots, undo, library and backup lifecycle |

Text and identifiers remain strings, preserving leading zeroes. Dates use ISO
values independently of their printed format. Decimal inputs remain strings
and are validated without floating-point conversion. A boolean `false` means
No; an absent value means unanswered. Single-choice answers store one option ID,
including when several mark boxes print that answer. Multiple-choice answers
store option IDs. Signatures are completed after export and do not block export
readiness. Arbitrary scripts and calculations are not supported.

List, checklist, grid and cards use `FormAnswerControl`, so layout does not change
allowed answers. A repeated answer has multiple placements. Each printed roster
row has explicit cell geometry; the renderer does not reconstruct it from an
average stride. A fixed roster rejects extra rows instead of dropping them.

## Documents and revisions

Generic forms participate in the existing document library, session restore,
undo, snapshots and backups. **New copy** creates an independent document.
Draft import/export contains only that instance and its definition. Invalid or
unfinished answers remain recoverable in drafts; validation blocks export.

Instances keep their original definition and template checksums. A catalog
update cannot silently change their meaning or print location. Legacy configs
are adapted at the boundary, with legacy keys retained for migration. Conflicting
legacy radio selections require correction; the original buffer is retained.

**Apply revision update** accepts a maintainer-provided JSON object containing
`definition` and `migration`. The migration names the exact old/new revisions,
explicit field mappings, option mappings where IDs changed, and row group/column
mappings. Missing mappings, duplicate targets and insufficient row capacity are
errors. The user reviews the action before opening the result as a new copy;
the original document remains saved. Migrations do not guess renamed fields.

## Rendering and offline use

Preview and export run the same projection and renderer. Preview allows missing
required answers but returns diagnostics. Export rejects missing required
answers, invalid values, unsupported glyphs and text that does not fit. Shrink
policies have a minimum font size; `error` placements prohibit width shrinking.
No overflow policy silently shortens the saved answer. Older asynchronous
previews cannot replace the current document's result.

Every template load verifies its SHA-256 and page dimensions. The package cache
is keyed by content hash, capped at 100 MiB; the memory cache is capped at 20 MiB.
**Save for offline use** verifies every page before claiming availability. Browser
storage failure does not prevent online rendering, but prevents an offline
availability guarantee. Verification requires HTTPS or localhost.

Cleanup retains packages referenced by documents and history, including persisted
records from other tabs. It skips deletion when IndexedDB cannot be read, and
only removes unreferenced assets older than a day. Retired packages stay on disk
for old instances. Browser-managed storage eviction is still possible; exported
JSON contains definitions and answers, not template PDF bytes. Reconnect or use a
self-hosted deployment containing the referenced revisions to recover missing
assets.

## Import and publication

The importer retains source hashes, widget identities, flags, extraction method,
tool versions, warnings and flattened-page hashes. Changed source/template bytes
are refused. Qualified source identities supply initial field/column IDs;
reviewers can curate semantic names before publication. Automatic grouping checks
column semantics and retains each actual cell rectangle. Ambiguous grouping stays
as individual fields. Flowed XFA, scripts and calculation behavior are refused.

The lifecycle is **extract → prepare → review → publish → retire**. Preparation
writes a candidate and a diff against the published revision. It never rewrites
the published definition. Review reruns rendered placement checks and requires
reviewer identity, notes and explicit acceptance of extraction warnings. The
review digest covers the candidate, extraction evidence, diff and placement
report. Publication refuses changes after review and writes an immutable revision
folder before atomically updating the catalog. Only published entries are
selectable for new documents.

Automated acceptance renders each option and every roster row, then measures text
bounds inside the declared rectangle. It does not prove that a declared rectangle
matches the official blank, or that the form's meaning is correct. Human review
must compare the filled output and extraction overlays with the official source.
The report labels this distinction; it does not invent a confidence percentage.

## Evidence and remaining scope

Synthetic fixtures exercise mixed checklist/radio sections, repeated appearances,
required signatures, row choices in both layouts, irregular rows, migrations,
multiple saved instances, stale assets, overflow and unsupported glyphs. PDF
integration tests independently assert known printed regions. Python tests compare
extracted geometry with rendered ink, including rotated and mixed-size pages.
Publication tests cover review invalidation, immutable revisions and retirement.

The final product audit also covers cleared formatted dates, multiline answers
with CRLF and tabs, minimum font size, corrupt-cache recovery, keyboard form
selection, required-field descriptions and delayed editor actions. Answer edits
retain the pinned definition object, avoiding repeated template checks while
typing. A revision file or clear confirmation is applied only if the initiating
document and answers are still current. Invalid imported roster IDs remain
editable without removing another row.
Imported answer keys that match inherited object properties are reported as
unknown fields, and definition IDs cannot use those reserved names.

Direct acquisition, import, flattening, harvesting and publication paths now
validate their destinations. Built-in templates, nested revision folders and
source-folder symlinks cannot be overwritten through these commands. Flattening
can still target an explicit external staging directory.

Local verification passed 2,794 unit/component tests. The previous audit passed the coverage threshold,
PDF integration tests, all Python script suites, lint, typecheck and the
production build. A browser check used synthetic data on an isolated local
origin to verify keyboard selection, draft import, offline package storage,
PDF download and reload. Extracted PDF text retained both paragraphs and left
the cleared date blank. These checks do not replace official-form review.
The live upgrade rehearsal below supplements the serializer compatibility tests.

Repository-wide findings are separate from this form contract: CodeQL alert
[#75](https://github.com/marinecoders/dondocs/security/code-scanning/75) is an
existing companion HTTP error-response finding on main. The production
dependency audit reports no vulnerabilities; the existing development-only
`mammoth → argparse → sprintf-js` advisory remains outside the shipped app.

No additional official generic form ships in this PR. Before adding catalog
entries, pilot a checklist/radio form, a fixed roster and a multipage form through
source review, publication, editing, reload and export. Dynamic continuation pages,
electronic signing, embedded scoring rules and a companion/MCP form API remain
separate capabilities. They should use this contract with explicit validation,
rather than interpreting unsupported source behavior as a successful import.

## Official-source pilot results (16 October 2026)

Pilot imports used fresh downloads from the official DON registry in an isolated
workspace. No candidate was published to the production catalog. These are
acceptance failures, not completed end-to-end form qualifications:

| Pilot | Official source | Result |
| --- | --- | --- |
| Checklist: NAVMC 11580 | [Registry 9073](https://dso.dla.mil/DONNavyForms-RequestService/api/forms/9073/file) | Two pages flatten, but harvesting refuses document JavaScript. The source rendering also contains overlapping privacy/instruction text. |
| Roster: NAVMC 11780 | [Registry 8258](https://dso.dla.mil/DONNavyForms-RequestService/api/forms/8258/file) | Two pages flatten, but harvesting refuses scripted/unsupported XFA subforms. |
| Multipage: NAVMC 10561 | [Registry 6994](https://dso.dla.mil/DONNavyForms-RequestService/api/forms/6994/file) | Two landscape pages flatten, but harvesting refuses scripted/unsupported XFA subforms. |
| Additional check: NAVMC 11799 | [Registry 12401](https://dso.dla.mil/DONNavyForms-RequestService/api/forms/12401/file) | Flattening refuses the Adobe “Please wait” placeholder before creating a candidate. |

The refusal gates were retained. Completing these pilots requires a static
source that renders correctly and a reviewed manual definition, or separately
specified support for the source behavior. Removing scripts and treating the
remaining widgets as a complete form would not establish semantic correctness.
The CLI now reports unsupported XFA as a concise refusal instead of a traceback.

Source SHA-256 values (to distinguish later registry revisions):

- `9073`: `022aaa2e0be1408775a62f1af6f9714cd21508afafba896148d928837d3601e4`
- `8258`: `054ba208032f2e567dba857865d3baebade84123e3cf730789a0d91241833db3`
- `6994`: `acfc337e6e0d879b0e266d03e7129864730aa72359a73eab9b410ca3bb77d38c`
- `12401`: `edc719dd3d0c3ea796588cca0f89fc9a01b903ab49e7fcba0012b170136ea690`


## Live upgrade rehearsal (16 October 2026)

Two tabs on an isolated local origin started from the production build of main
at `7993269f`. Synthetic data included a saved letter, a PDF enclosure, a serial
with leading zeroes, a NAVMC 10274 draft and its Privacy Act cover-page option.
One tab dismissed the update and continued editing before the other accepted it.
Downloaded backups before and after activation contained identical saved
letter records and attachment bytes. The NAVMC answers and cover-page choice
also survived. Restoring the older backup retained the newer saved letter.

The rehearsal found two issues:

- The tab that first installed the service worker could remain on the old build
  after accepting an update. The hook now observes the waiting worker completing activation as well as
  controller changes, and reloads only once. Already-running main
  code cannot receive this fix until refreshed; users must refresh older tabs
  before editing new generic forms.
- An edit immediately followed by reload could lose the pending registry save.
  A tab-local recovery record now identifies the document and its prior stored
  state. Recovery compares and writes within one IndexedDB transaction. Tests
  cover successful recovery, newer records, deleted records and mismatched IDs.

The recovery copy is best effort when session storage is available. It is not
an external backup, a concurrent-edit merge, or protection against a process
crash that never emits a page lifecycle event. Existing IndexedDB records and
schema remain unchanged.

A fresh-origin browser retest confirmed that Update Now moved the first-install
tab from bundle `main-BwBn2uFW.js` to `main-BZud1eyz.js` without a manual reload,
retaining the draft and serial `000073`. A separate immediate-reload test kept
the last subject edit and serial `000042` after hydration. These used synthetic
data and did not read or alter real user storage.

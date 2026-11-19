# Package workspace redesign

Implementation is reviewed in PRs #549 (draft recovery), #550 (document editing and
review transfers), and #551 (package library and workspace navigation).

The approved desktop reference is the package prototype in the current design chat.
Use the existing DonDocs typography, colors, document renderers, and package services.
The workspace has Overview, Documents, Review, and Delivery views. These are freely
accessible sections, not required steps. Keep ordinary preparation concise and put
maintenance, source identities, and specialized operations in secondary controls.

## Required behavior

- [x] A package library provides a clear New package entry and return path.
- [x] Persistent desktop navigation shows one focused section at a time.
- [x] Errors and preparation results are visible beside the operation that produced them.
- [x] Details edits use one canonical reviewed update, including conditional action answers.
- [x] Unapplied shared details and action answers recover after reopening or reloading.
- [x] Restored drafts are scoped to their exact package version and never overwrite newer content.
- [x] Documents show the selected member, an actual preview, and the appropriate real editor.
- [x] Add, reorder, remove, and supporting-file workflows remain available.
- [x] Historical versions and signed original files retain their existing protections.
- [x] Review copies, returned feedback, conflicts, and application use the existing review services.
- [x] PDF and editable downloads contain actual captured content from the selected version.
- [x] The redundant generic sensitive-information checkbox is absent. Specific findings and
  existing export policy checks remain part of preparing the exact download.
- [x] Version history opens actual retained documents and outputs.
- [x] Advanced signing, roster, template, evidence, assembly, and source operations remain accessible.

## Implementation order

1. Workspace shell, package library, section navigation, and visible feedback.
2. Canonical Details UI and durable local draft recovery.
3. Document inspection and editing, with real rendering and working-copy return.
4. Review and delivery presentation using the existing prepared-operation ownership checks.
5. Complete local regression and visual verification before dividing changes for review.

## Acceptance checks

Exercise the maintained administrative, training, and evidence starters. Change shared
details and conditional membership, navigate away, reload, recover drafts, and apply
once. Inspect the actual native documents, supporting originals, and historical versions.
Download and inspect a combined PDF and an editable package. Prepare a reviewer copy,
return feedback after the owning package has changed, resolve conflicts, and verify the
new saved revision. Confirm cancellation, stale operations, failed storage, missing assets,
and read-only versions cannot silently discard or misattribute content. Check the finished
desktop workspace at normal laptop and desktop sizes.

## Local verification

- The original checkout was left untouched during implementation and local verification.
- Browser walkthroughs use an isolated local app with real package services and renderers.
- Broad package, conditional-action, suggestion and export regression: 108 files, 935 passing tests.
- Follow-up regression after historical loading and active-answer summary fixes: 6 files, 77 passing tests.
- Dialog, focus and workspace navigation follow-up: 5 files, 74 passing tests.
- Production build, TypeScript checks and release packaging passed. The distribution CDN scan passed.
- Normal desktop viewport used for browser verification (1280 × 720).

### Browser walkthroughs

1. Administrative request: one shared-details application updated both captured documents.
   Native editing saved another package version and returned to the selected Documents view.
2. Combined PDF: downloaded and inspected the real two-page administrative package. Editable
   transfer contained one exact selected revision, current field values and its retained PDF.
3. Review: exported version 6 to an independent browser origin, proposed a different subject,
   changed the owner's subject in version 7, returned feedback, resolved the overlap, and
   applied the combined text as version 8. Prior versions remained available.
4. Evidence: selected a real synthetic PDF, reloaded the browser, recovered answers and file,
   and created the three-document action. The unchanged-original download's SHA-256 exactly
   matched the upload: c106d2208be52917f82004884d74af6069fced2cde581945cd8c787ad61feaca.
   Its user-declared signed status remained explicit and it had no native edit action.
5. Training: created activity, in-person participant and cost worksheets. The downloaded
   three-page PDF contained the actual participant, location and USD 125.00 estimate.
   Turning the estimate off removed its worksheet in version 2; the version 1 worksheet
   and original three-page output remained available in history.
6. Draft recovery: a date edit survived navigation to Documents, Escape, and reopening.
   Explicit Discard restored the saved date. Inactive cost values remained retained but
   were excluded from the ordinary Details summary.

### Implementation boundaries

This uses the existing package, review, signing and export engines. It does not replace
those authority or policy checks. Draft recovery belongs to the current browser origin;
it is separate from committed packages and is not included in package transfers.

Changes are organized into draft recovery, document and review integration, and desktop workspace layers.

### Production browser check

A fresh production origin was checked after building. The fullscreen dialog occupied
exactly (0, 0, 1280, 720), with no inherited centering transform. Package creation,
editable import, a two-page retained-PDF preview and its actual download all worked.
The production download matched the retained source's SHA-256 above. Browser error
logs were empty. Dedicated fullscreen Dialog content avoids build-time CSS transform
rewrites that had defeated an ordinary stylesheet override.

### Desktop navigation audit · November 18, 2026

The follow-up desktop walkthrough found and corrected several return paths and layout issues:

- The app bar has an explicit Back to packages control and a visible Close button.
- Choosing an action removes the catalog and secondary creation controls. The New package
  screen shows the chosen action and its fields immediately.
- Back to details leaves both action and shared-information previews without discarding edits.
- An unfinished draft in the library has an explanatory message and Continue editing.
  The same action locates the actual editor for unfinished advanced settings.
- Historical versions have Back to current version. Version history has Done; Escape closes
  that dialog while leaving the package open.
- Back to current package remains available across all sections while a review copy is open.
  End review changes the review lifecycle separately from leaving its view.
- Prepared downloads have Cancel export. A saved PDF opens in a focused preview with
  Back to export options; leaving it removes the preview and restores the format controls.
- Document-role choices use readable labels, and Add documents explains its supported inputs.

Verified manually on an isolated development origin with a new administrative package:
creation preview/back, dirty-draft navigation and reopen recovery, discard cancellation,
readiness-to-document navigation, native editor save/return, shared-detail preview/back/apply,
historical inspection/return, nested Escape, review creation/cancel/return/end/reopen,
editable-export cancellation, real PDF and editable downloads, and library Escape.
The two-page PDF contained the updated organization and completed signature. Its editable
transfer contained exactly one revision, two documents and one retained PDF.

The final production build was checked on a fresh origin at 1280 × 720. Importing that
editable transfer restored the documents and retained PDF. The focused two-page preview,
Back to export options, and Escape worked; browser error logs were empty. The fullscreen
dialog still occupied the exact viewport without an inherited centering transform.
The main development app at port 5173 serves the updated UI.

Validation: the broad package regression passed 108 files / 942 tests. The final navigation
follow-up passed 3 files / 44 tests, including preview cancellation, recovery and review
return paths. Lint, TypeScript, production build, release packaging, CDN scan and
`git diff --check` passed. The final stacked workspace preserves the locally verified implementation.

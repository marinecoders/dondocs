# Saved package review baselines

A package review belongs to a saved package, independently of the source documents in the library. In **Packages**, select a saved revision and choose **Start package review**. **Open review** shows its captured members and the outputs retained when the review began. **Return to package workspace** leaves that view. Closing a review retains its baseline; deliberately reopening it resumes the same review.

Starting or changing review state increments the package metadata sequence without creating or editing a package revision. Source changes, source deletion, later package membership changes, and later output generation cannot change an existing baseline. Original PDFs retain their exact original bytes and signature information. An assembled PDF remains an unsigned derivative.

## Persistence and public contract

`ActionPackage.reviewRounds` is optional for compatibility with existing saved packages. Each version 1 `dondocs-package-review-round` stores a normalized copy of the existing `PackageRevision` model as `baseline`, its SHA-256 `baselineDigest`, the package and revision IDs, a label, creation time, exact member bindings and optional append-only lifecycle events. Native source IDs remain provenance with `source.local = false` inside the baseline. Original native session timestamps are preserved.

The snapshot includes only the outputs present at review creation. The saved revision may gain later outputs without adding those files to an existing review. The baseline is an independent attachment and template root in package inventories, garbage collection and complete workspace backups. Its captured members must match its retained package revision; output history may only extend that saved revision.

`packageReviewBindingSchema` identifies a member by `packageId`, `roundId`, `revisionId`, `baselineDigest`, `memberId`, `memberRevisionId`, `memberDigest` and `assetDigest`. `memberDigest` hashes the complete normalized captured member; `assetDigest` is the captured native draft or original PDF digest. Never locate a member by matching text or a library document ID.

`src/lib/packageReviewRounds.ts` exposes:

- `startPackageReview(record, revisionId?, label?, signal?, isCurrent?)`: validate retained resources and conditionally append a new review to the package.
- `openPackageReview(record, roundId)`: validate digests and retained bytes, returning a detached copy of the exact round.
- `getPackageReviewBinding` and `assertPackageReviewBinding`: obtain and check exact parent/member identity for subsequent native child review associations or feedback returns.
- `packageReviewRoundStatus`, `assertActivePackageReview` and `transitionPackageReview`: inspect state, require an active review, or close/reopen/supersede it using the parent package CAS transaction.
- `validatePackageReviewBaselines`: verify snapshot and member digests at load, resource import, backup and write boundaries.

`ownerPackageId` is local package authority. It never grants `ownerDocumentId` authority over a library document. Portable reviewer workflows must strip local owner authority and must reject collisions with a different retained baseline. Native child reviews, when installed, need the full exact member binding and must preserve the captured native timestamp. They must not manufacture ownership of the original source or edit its library draft.

Clean editable package files and encrypted clean package sharing omit review rounds. Package duplication starts without review rounds. Word/PDF export reads only the captured document/output model. Complete workspace recovery preserves review state and its package ownership while removing local source and working-copy bindings. Portable review feedback and reviewed application use these bindings in later workflows.

Review transfer must run `reviewPackageReviewMetadata` in addition to native document and PDF inspections. It scans every retained string value, including inactive values, labels, source IDs, resource names and lifecycle metadata, with original line boundaries intact. Metadata validation is separate from deployment marking and privacy inspection.

## Verification

Focused coverage is in `tests/unit/packageReviewRounds.test.ts`, `tests/component/ActionPackageWorkspace.test.tsx` and `tests/browser/package-review-baselines.spec.ts`. The browser flow starts a review, removes a member from a later revision, reopens the exact baseline, reloads and closes it. Run it on desktop and phone layouts in Light, Dark and Classic as part of browser qualification. Installed iPhone qualification remains a separate device check.

## Member feedback and portable reviewer files

**Open review** provides captured member navigation. Supported native correspondence uses the existing comment mutation model and suggested replacement panel against a detached captured session. Member comments have Undo/Redo during the open view; saved comments and proposals survive reload. Original PDF comments belong to the whole preserved original and never change the PDF or its signatures. Inspect its exact pages using the unchanged-original download. No member view activates a library document or creates an autosaving library draft.

**Prepare package reviewer copy** reviews the complete retained baseline, discussion, proposal metadata, embedded files and original/retained PDFs against deployment policy and privacy checks. After reviewing every page and findings, download the file and import it in an independent browser using **Import package reviewer copy**. Imports preserve the original package/round/member identity and reject every local package collision. The imported package has no owner authority and permits only member feedback collection. **Prepare package feedback return** produces a bounded, exact-round file for the owner. Applying it to a newer package revision is a separate owner workflow.

`PackageReviewRound.memberReviews` optionally stores `{ binding, nativeRound?, comments, suggestions? }`. Every member binding is exact. Native child rounds have deterministic IDs derived from the entire parent/member binding, so independent reviewers share the same child identity. Their baseline is exactly `{ ts: member.session.timestamp, session: member.session }`, with the original captured timestamp and a separately verified canonical SHA-256 digest. The child timestamp adapts the existing native review contract; the package review time is the parent round's `createdAt`. Child rounds cannot contain `ownerDocumentId`, lifecycle/checkpoint authority or author suggestion decisions. Feedback proposals are immutable under their IDs. Original children permit document-level comments only.

`packageMemberReviews.ts` exposes `createPackageMemberReview`, `preparePackageReviewMember`, `savePackageMemberReview` and `validatePackageMemberReviews`. All writes use the parent package CAS and never use native document writers. `packageReviewTransfer.ts` exposes prepared, policy-bound `buildPackageReviewerCopy`, `buildPackageReviewReturn`, `packageReviewTransferFile`, `preparePackageReviewerImport`, and `importPackageReviewerCopy`. Preparation does not install resources. The import commits validated attachment bytes and package metadata together in the existing IndexedDB transaction, rolling back both on cancellation, stale identity or quota failure.

`parsePackageReviewReturn(json, ownerRecord, roundId)` is a read-only application boundary. It returns `{ payload, record, round, memberReviews, resources, digest }` after verifying the owner, active round, exact normalized captured baseline, native adapter identity, bindings, proposals and every bounded resource. The envelope has kind `dondocs-package-review-return`, version 1, an immutable return ID/time, one ownerless selected-baseline package and its explicit portable resources. Parsers never rewrite IDs or infer ownership from names, source IDs or text. Consumers must merge comments with the existing comment merge model and proposals by their immutable IDs, preserve unrelated current work, stage resources and receipts atomically, and prevent repeated application. Clean packages, duplication, Word and PDF exports continue to omit pending member feedback; complete workspace recovery preserves it.

Focused feedback verification is in `packageReviewFeedback.test.ts` and `package-review-feedback.spec.ts`. The permanent browser flow downloads an owner reviewer copy, opens it in an independent browser inventory, comments on native/original members, proposes native text, reloads, and downloads an exact-bound feedback return in each theme.

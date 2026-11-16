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

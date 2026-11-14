# Storage Architecture

Browser documents live in IndexedDB; smaller stores and recovery buffers use
localStorage and sessionStorage. There is no remote document registry. The
local companion is a separate optional service. This document describes where
data lives, when a save is acknowledged, and what happens when writes fail.

## Where data lives

### IndexedDB — the source of truth for documents

Database `dondocs` (version 2), three object stores. All access goes through
`src/lib/documentsDb.ts`; nothing else touches IndexedDB directly. The v1→v2
upgrade is purely additive — it creates the `attachments` store and leaves
existing records untouched.

| Store | Contents |
|-------|----------|
| `documents` (keyPath `id`) | One record per document: `{ id, meta, session }`. `meta` is the Recents row (title, docType, updatedAt, pinned, user-set name); `session` is the full serialized document. |
| `app` (key/value) | `currentId` (resume pointer), `backupFileHandle` (the synced-backup `FileSystemFileHandle` — handles are structured-cloneable), `legacyMigratedIds` (migration ledger), `batch:<id>` (generated batch output bytes), and `snap:<docId>` — per-document version-history snapshots, capped at the 10 most recent. |
| `attachments` (keyPath `id`) | Enclosure and signature image bytes: `{ id, name, type, size, data }` (`data` is the raw `ArrayBuffer`). A serialized enclosure keeps only a `fileRef` (id + name/size/type) into this store, so the blob loads once and never bloats a document record. Bytes are written on attach (`src/lib/attachments.ts`) and streamed back into the live document by `rehydrateEnclosureFiles`. Ids are random (not content-addressed): `crypto.subtle` needs a secure origin an air-gapped `http://` deployment may lack, so there is no cross-enclosure dedup. Reachability inventory marks references from saved and live documents, history, snapshots, form buffers, profiles, and staged writes. Automatic deletion is deferred: older tabs can still own unsaved references that this tab cannot discover. A candidate orphan is retained, and unreadable roots abort the inventory. |

Two contracts in `documentsDb.ts` matter more than the rest:

- **Writes resolve on transaction commit, not request success.** `run()` waits
  for `oncomplete`, so `idbPutDocument` returning `true` means the write is
  durable. A `false` is what drives the "Couldn't save" state in the UI.
- **A failed read is not an empty library.** `idbGetAllDocuments` returns
  `null` on a read failure and `[]` only for a genuinely empty registry. Every
  consumer (hydration, backups, import) branches on the difference — treating
  failure as empty is how a broken database ends up overwriting a good backup
  file with nothing.

Snapshot writes (`idbAddSnapshot`) do their read-modify-write of the ring in a
single transaction, so concurrent writers — a restore's safety snapshot racing
an explicit Save's checkpoint — serialize instead of losing an update.

The cached connection resets on `onclose`/`onversionchange`, so a
browser-forced close (storage eviction, "clear site data") doesn't wedge
persistence for the rest of the page lifetime.

### localStorage — session backstop and small stores

| Key | Written by | Purpose |
|-----|-----------|---------|
| `dondocs-document-session` | 2s-debounced autosave, flushed on `pagehide` | Crash backstop for the live document. Used by the first-load legacy migration and the forms-view resume hint. Deliberately **not** consulted on normal resume — it carries no document id, so after a document switch it can briefly describe a different document than `currentId`. |
| `dondocs_profiles`, `dondocs_user_templates`, `dondocs_snippets` | Zustand persist via `compressedLocalStorage` | Gzip-compressed. **Rethrows on quota** so the calling action can warn the user; every save path is wrapped in try/catch with a "storage is full" message. |
| `dondocs-batch-job` | Batch job persistence | Frozen source/row values, status and output references for reload recovery; output bytes live under `batch:<id>` in IndexedDB. Excluded from workspace backups. |
| `dondocs_ui`, `dondocs-onboarding`, `dondocs-forms` | Zustand persist via `safeLocalStorage` | **Swallows** write errors so a preference write can never crash boot — but records each write outcome per key (`lastWriteFailed`), available to storage feedback. Document Save acknowledgement requires an IndexedDB commit receipt, including for built-in forms. |

The two adapters have opposite quota philosophies on purpose: user-created
content (profiles, templates, clauses) must fail loudly; preferences must
never take the app down.

If a compressed payload is corrupt on read, the store falls back to defaults —
but the raw value is stashed under `<name>.corrupt` first, so the next persist
write can't destroy the only copy.

### sessionStorage — interrupted edits

`dondocs-interrupted-save` keeps a tab-local copy of an existing document's
pending edit when the page hides. It includes the document ID and the exact
registry record the edit started from. On reload, one IndexedDB transaction
compares that record and restores the edit only if it is still unchanged.
Recovery never recreates a deleted document or overwrites a newer stored record.
The copy remains available for retry if the recovery transaction fails.

This is a reload backstop, not a durable backup: session storage can be blocked,
full, or discarded when the tab closes. It does not merge concurrent edits or
recover a browser/process crash that never dispatches a page lifecycle event.
Wait for **Saved** before closing a tab and keep an external backup.

## The write path

```
keystroke → correspondence or active form editor (in-memory)
  ├─ 1.5s debounce → documentsStore.syncCurrent()
  │     content diff vs baseline → persistEntry()
  │        → conditional document write + owned commit receipt
  │        → Saving… / Saved / Couldn't save for that exact revision
  │        → BroadcastChannel (cross-tab Recents sync)
  │        → scheduleBackup() (1.5s debounce → synced backup file)
  │     throttled version-history snapshot (one per 3 min; Save forces one)
  └─ 2s debounce → session blob to localStorage

visibilitychange / pagehide → synchronous recovery copy + asynchronous registry flush
```

Invariants the write path maintains:

- **The document workspace owns writes.** Autosave (`syncCurrent`) and explicit Save enqueue owned revisions through `DocumentWrites`. A transaction compares the expected stored record before committing; only its matching receipt can acknowledge Saved.
- **Opening a document you don't touch must not churn it.** Promotion into
  Recents requires content drift from the document's baseline; a no-op sync is
  skipped; hydration-time normalization (see migrations) never bumps
  `updatedAt`.
- **Automatic promotion requires content drift.** An untouched starter stays out of Recents. Explicit Save can add a new draft even before it has meaningful content.
- **The save indicator reflects a committed revision**, not an in-memory record. Failed or conflicting writes remain failures until a real retry commits. If IndexedDB is unavailable, keep an external draft/backup; memory-only work is not acknowledged as a durable save.

## Resume

`init()` hydrates the registry from IndexedDB (all records + `currentId`),
then loads `docs[currentId]` — the registry entry is authoritative. If there is
no current document, the legacy single-session blob (pre-registry builds) is
folded into the registry as the first document; otherwise a fresh blank starts.

`init()` runs under a Web Lock (`dondocs-init`) so two tabs booting
simultaneously on a first post-upgrade load can't both fold the legacy session
into their own new id.

## Migrations

Migrations run locally and retain legacy sources until the corresponding records are durable.

**Legacy registry → IndexedDB** (`migrateLegacyRegistry`): the old
compressed-localStorage registry blob (`dondocs_documents`) is folded into
IndexedDB per record. A record is skipped if it's already in IndexedDB or in
the `legacyMigratedIds` ledger — the ledger is what keeps a document that
migrated and was then *deleted* from resurrecting on a retry. The blob is only
removed once every record is confirmed durable; a partial failure keeps it and
retries exactly the missing records on the next load. A stale legacy resume
pointer never overrides one the user has set since.

**FOUO → CUI portion markings**: FOUO was retired by DoDI 5200.48. Documents
persisted by older builds may still carry `portionMarking: 'FOUO'`; hydration
rewrites these to `CUI` in the stored registry record (same `updatedAt`, no
Recents re-sort), and every load path into the live editor
(`loadSharedSession`, `restoreSession`, `loadTemplate`) applies the same fold.

**Form library**: no database version or existing storage key changes. Generic
forms add an optional `genericForm` to document sessions, including the pinned
definition, answers, and rows. Existing letters retain their session shape. Built-in NAVMC drafts also use document identities in Recents; legacy buffers are migrated into saved records without discarding the old persisted values. Active form edits are captured in their owning document session. Object key order does not count as an edit.
A generic session can also be recovered from the localStorage backstop when
there is no matching registry document. An unreadable saved definition stays
in the library and backup; a failed open must never attach subsequent edits to
that record's ID. Template PDF bytes are fetched or cached separately and are
not embedded in backups, so offline export also needs the matching PDF package.

After restoring a backup on another device:

1. Open each saved generic form while connected to the internet.
2. Choose **Save for offline use** and wait for **Available offline**. This checks
   every template page against the revision saved with the document.
3. Export a PDF as a separate readable copy if needed. A JSON backup preserves
   editable answers; a filled PDF preserves the rendered document.

If a referenced revision is no longer hosted, keep the JSON backup and ask the
site maintainer to restore that template revision. Do not substitute a newer
blank: its fields may be in different positions. Browser storage can be evicted,
so an earlier offline confirmation is not a permanent backup of the templates.


The startup NAVMC view hint cannot override a generic document resumed from
IndexedDB. Leaving a generic form detaches its document ID before subsequent
letter edits, including navigation through a built-in form. Draft imports apply
their document changes together; shared links and companion handoffs open under
a new ID after preserving the open document.

## Multi-tab

These guards apply to tabs running the same document format. Before using new
generic forms, refresh older DonDocs tabs: a build from before the form library
does not understand `genericForm` and can discard it when rewriting a document.
Rolling back the app has the same limitation. Export a backup before rollback.

- Registry writes broadcast over a `BroadcastChannel` (`dondocs-docs`); other
  tabs mirror the change into their Recents list. The live editor is never
  touched by a broadcast — the tab you're typing in can't be clobbered.
- A tab only persists the current document when its live state differs from
  **its own baseline** (the state it last loaded or wrote). An idle tab whose
  registry entry moved ahead via another tab's save has nothing of its own to
  contribute, so its `pagehide` flush is a no-op instead of a stale overwrite.
  A stale conditional write reports a conflict instead of silently replacing the other tab's record. The pending revision is retained for recovery; concurrent edits are not automatically merged.
- `currentId` is origin-wide, so two tabs *can* have the same document open.
  The conditional-write guard prevents stale overwrites; a recovery copy preserves conflicting work for review.

## Backups

Backup export flushes pending edits from an initialized live document into the
registry before serializing it; it does not wait for the autosave debounce.

**Manual** (**Settings → Backup & restore → Download workspace backup**,
`src/lib/backup.ts`): an **unencrypted JSON** bundle (kind `dondocs-backup`).
Draft/backup downloads do not run the rendered-output pre-export PII/PHI review.
Base64 assets and compressed browser stores are not encryption.

| Included data | Restore policy |
|---|---|
| Saved document registry, including Trash and pinned form definitions/answers | Per-record merge; newer local `updatedAt` wins. Pending edits are flushed before comparing. |
| Profiles/signatures, snippets and user templates | Add missing entries; local entries win collisions. |
| Referenced enclosure/signature assets | Embedded base64; add IDs missing locally. |
| Per-document history | Merge validated snapshot rings, retaining the bounded history. |
| Live NAVMC buffers and included legacy form values/options | Apply included buffers/values. The two live NAVMC buffers are intentionally replaced; they have no per-draft timestamps. Older omitted options leave local values unchanged. |
| Unit routing overrides | Included incoming values win matching keys; local-only rules remain. |

Excluded: **batch jobs and generated results**, UI/onboarding preferences,
synced-backup file handles/permissions, and cached blank form PDFs. Download
batch files separately. Configured-form backups preserve editable instances but
need the exact blank PDF package for offline export; reconnect and **Save for
offline use** after restoring on another device. A legacy docs-only
`dondocs-library` file still restores.

Restore reports section/persistence failures and can be partial; retain the file,
review the result and retry failures. Newer in-memory document copies survive a
failed disk write. A newer-wins document merge is not a universal promise that
nothing in the workspace will be replaced. Full restore is separate from an app
update, which does not intentionally replace live NAVMC buffers.

**Synced backup file** (Chromium desktop): the user picks a file once; the
`FileSystemFileHandle` persists in IndexedDB and survives restarts. Every
registry save mirrors the **included-data bundle** — the same `dondocs-backup`
`buildBackup()` produces for the manual download, including enclosure bytes —
to that file (1.5s debounce), so a restore can recover the included stores and referenced assets. Active NAVMC and configured-form drafts autosave through the registry, so those saves also schedule the mirror. Changes confined to profiles, preferences, or dormant legacy buffers do not independently trigger a write; use a manual backup after those edits if no registry save occurs. (Each write re-serializes the account; with large enclosures
that base64 pass runs on every debounced save — acceptable off the critical
path, and a future optimization could diff attachments.) Browsers require a
fresh user gesture to re-grant write access after a restart — surfaced as
"Reconnect auto-backup" in Settings → Backup & restore.

Backup failure semantics:

- A failed account read **skips the write** — an incomplete/empty bundle is
  never mirrored over a good backup file, and "last backed up" is not advanced.
- A failed file write flips the status to `error`, shown in Settings → Backup & restore
  with a retry; later saves keep retrying, and a success self-heals back to
  `connected`. Permission loss shows `needs-permission` instead.

## Trash and batch retention

Trash retains the full document entry (`deletedAt`) and its history until the
user restores or permanently deletes it, or browser storage is lost. There is
no automatic age-based purge. Permanent deletion removes the record and its
snapshot ring; attachment collection is conservative and separately managed,
so this is not a secure-erasure guarantee. Backups include Trash.

Batch persistence is separate: `dondocs-batch-job` retains its frozen source,
rows and progress, and IndexedDB `app` entries `batch:<id>` hold results. Closing
the panel does not stop generation. Reload recovery can resume remaining work
from its source; it never substitutes the current editor. Starting **New batch**
clears the previous job/results. Neither job metadata nor output bytes are in
workspace backups. See the [batch walkthrough](USER_GUIDE.md#batch-generation).

## Version history

Snapshots accumulate per document in the `app` store (10 most recent):
throttled to one per three minutes during editing, forced on explicit Save.
Restore writes a safety snapshot of the current state first and **requires it
to commit** before anything is overwritten — if the safety copy can't be
written, nothing is restored and the modal says so.

## Failure surfacing

`probeStorageHealth()` classifies the situation after hydration settles, and
`StorageNotice` renders one dismissible strip per level:

| Level | Meaning |
|-------|---------|
| `ok` | Persistent storage granted (or nothing at risk yet). |
| `evictable` | IndexedDB works but browser retention policies can still clear local data. Shown once the user has documents to lose. |
| `unreadable` | The database opens but records cannot be read. Hydration reports the failure rather than treating it as an empty library, and backups refuse to run on incomplete reads. |
| `unavailable` | IndexedDB cannot be opened. Editing may continue in memory, but durable document Save is not acknowledged; export an external copy before leaving. |

The design rule behind all of it: **a durability claim in the UI must trace
back to a confirmed write, and a failure must be distinguishable from an empty
state.** Anything less turns the safety net into the failure mode.

## Test coverage

The contracts above are pinned by unit tests: `documentsDb.test.ts` (commit
semantics, snapshot ring + concurrent-add serialization),
`documentsStoreMigration.test.ts` (per-record retry, ledger, blob retention),
`documentsStore.statemachine.test.ts` (promotion, soft delete, stale-flush
guard), `documentsStore.hydrateMigration.test.ts` (FOUO fold without churn),
`storageReadFailure.test.ts` (failure ≠ empty at every consumer),
`restoreSnapshot.test.ts` (safety-snapshot precondition),
`storageSignals.test.ts` (write-outcome tracking, corrupt-payload stash), and
`backupStore.statemachine.test.ts` (permission + error transitions).
`formUpgrade.test.ts` covers old letters and built-in drafts, immediate backup
after an edit, and older-backup merging. `formSessionFallback.test.ts` covers
generic-session recovery without IndexedDB. `formUnreadableSave.test.ts`
checks that failed opens cannot overwrite the saved record.
`formMigrationAudit.test.ts` covers stale startup hints, navigation through
built-in forms, old NAVMC backups, external sessions, and pending edits during
restore (including failed writes). `HeaderDraftMigration.test.tsx` exercises
the draft-import UI and verifies that the previous letter stays unchanged.

These tests use isolated browser-storage fixtures. They do not inspect real
users' data or certify a running old service worker against the new build.

## Document signature assets

New signature uploads are committed to the IndexedDB attachments store before
being installed in a document. Correspondence saves and undo entries keep the
signature metadata, inline image bytes, and its `fileRef`; NAVMC signature blocks
keep both `image` and `imageRef`. Inline fallbacks let supported older tabs preserve
the image when their reader does not recognize the reference. Full backups include the
referenced assets, and portable draft files embed the resolved image bytes.
Share links omit signature images and device-local references.

Legacy inline images remain readable. A correspondence image is migrated only
after its asset write succeeds; failure retains the original inline value.
Profile defaults are copied when creating a new document or explicitly applying a
profile. Reopening a saved document never borrows a signature from the current
profile. If an older record omitted its signature, review and apply the appropriate
profile or reattach the image; its original signer cannot be inferred safely.
Legacy NAVMC inline images remain readable and new uploads use references.

Reference-only records from earlier builds receive inline fallbacks when their
assets can be read. This includes library records, checkpoints, profiles, built-in
form buffers, templates, and batch sources. Saves prepare an owned payload before
committing it, so the acknowledged receipt matches the stored representation.
Unreadable or missing assets retain their references for recovery; missing image
bytes cannot be reconstructed. A code rollback does not downgrade stored documents.

## Shared document format

Ordinary links use an additive `dondocs-share` envelope with `version: 1` and a
`documentKind` discriminator for correspondence, built-in forms, or configured
forms. The established document fields remain at the top level so earlier
clients with the corresponding document reader can still read them. New readers
also accept unversioned legacy links and reject unknown envelope versions or a
kind that does not match the contents before opening a new document.

Links include form answers and repeated rows, but omit binary images and local
asset handles. Configured forms require access to their PDF templates. Very old
clients that lack the form reader must be updated to open those forms. A link is
a snapshot; subsequent sender edits do not change the recipient's document.

Share links have no server-side revocation or password-recovery service. In contrast to encrypted share payloads, portable draft and workspace-backup JSON is unencrypted; store and transfer those files according to their contents.

Optional expiration requires DonDocs 1.3.74 and the `dondocs-share` version 3 envelope: `{ kind, version, documentKind, expiresAt, session }`. The complete envelope, including the deadline, is compressed and authenticated inside the password-encrypted payload. `expiresAt` is a positive safe integer of UTC milliseconds since the Unix epoch, no greater than the JavaScript Date limit (8,640,000,000,000,000). The recipient rejects the link when `Date.now() >= expiresAt`, after decryption and again immediately before opening the reviewed copy. A missing, malformed, expired or unsupported expiration envelope is rejected before changing document stores; an invalid device clock is also rejected. The UI offers one hour, 24 hours or seven days from generation, plus the unchanged no-expiration default.

Version 3 nests the document under `session` rather than leaving required document fields at the top level. Version 1/2 envelope readers reject the unsupported version; earlier flat-session readers fail required document validation instead of silently dropping the deadline. No separate `minReader` field is used. Deadlines on legacy, version 1/2 or draft envelopes are rejected by current readers. Without expiration, ordinary and comment-bearing shares keep versions 1 and 2 respectively. The nested document uses the same form, review-model and asset-projection validation as other shares.

Expiration is an import check based on the recipient’s local clock. There is no trusted time server, hosted revocation, deletion of already imported copies, or protection against a password holder extracting the plaintext independently. Changing the device clock or using a modified reader can bypass this client check. Imported documents have no continuing expiration policy.

## Review comment reader compatibility

Document and field comments use the optional `reviewComments` model, version 1. Comment-bearing shares require the `dondocs-share` envelope version 2; comment-bearing draft files use `dondocs-draft` version 2. Older envelope readers reject those copies instead of opening an incomplete review. Drafts and shares without comments retain their existing versions.

Paragraph comments require review model version 2 and DonDocs 1.3.72 or later. Current readers accept both model versions, but version 1 cannot contain paragraph anchors. The share/draft envelopes and backup version stay the same as other comment-bearing copies; unsupported nested review models are rejected before changing the current draft.

Native `Paragraph.id` values identify actual editing nodes independently of publication cross-reference labels. Missing legacy IDs migrate at ingestion and are saved without changing library timestamps. Existing IDs survive edits, moves and history; genuinely new, split, duplicated and template-created nodes receive fresh IDs. Detached comment target IDs are reserved during migration. A comment is never recovered by matching paragraph text or its former position. Paragraph IDs are hidden metadata, excluded from clean output and text substitution.

Workspace backups containing comments in documents, trash, version history, or captured templates use backup version 6; other backups remain version 5. Comment-bearing library exports use library version 2. Current readers accept supported older formats and validate review schemas before restoring records or assets. An unsupported review version is an error, not a request to discard notes.

These comment formats require DonDocs 1.3.71 or later. Earlier tabs and code rollbacks can still drop unknown fields when reading an on-device session; changing the new code cannot repair an older reader. Keep a current-version workspace backup before using an older build. Portable draft and backup JSON remains unencrypted; encrypted sharing protects the payload with the supplied password.

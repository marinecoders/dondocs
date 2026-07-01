# Storage Architecture

DonDocs has no server. Every document a user writes lives in their browser, so
the storage layer carries the durability guarantees a backend would normally
provide. This document describes where data lives, how it gets there, and what
happens when writes fail.

## Where data lives

### IndexedDB — the source of truth for documents

Database `dondocs` (version 1), two object stores. All access goes through
`src/lib/documentsDb.ts`; nothing else touches IndexedDB directly.

| Store | Contents |
|-------|----------|
| `documents` (keyPath `id`) | One record per document: `{ id, meta, session }`. `meta` is the Recents row (title, docType, updatedAt, pinned, user-set name); `session` is the full serialized document. |
| `app` (key/value) | `currentId` (resume pointer), `backupFileHandle` (the synced-backup `FileSystemFileHandle` — handles are structured-cloneable), `legacyMigratedIds` (migration ledger), and `snap:<docId>` — per-document version-history snapshots, capped at the 10 most recent. |

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
| `dondocs_ui`, `dondocs-onboarding`, `dondocs-forms` | Zustand persist via `safeLocalStorage` | **Swallows** write errors so a preference write can never crash boot — but records each write outcome per key (`lastWriteFailed`), which the forms "Saved" indicator checks before claiming success. |

The two adapters have opposite quota philosophies on purpose: user-created
content (profiles, templates, clauses) must fail loudly; preferences must
never take the app down.

If a compressed payload is corrupt on read, the store falls back to defaults —
but the raw value is stashed under `<name>.corrupt` first, so the next persist
write can't destroy the only copy.

## The write path

```
keystroke → documentStore (in-memory)
  ├─ 1.5s debounce → documentsStore.syncCurrent()
  │     content diff vs baseline → persistEntry()
  │        → idbPutDocument   (result drives Saving… / Saved / Couldn't save)
  │        → BroadcastChannel (cross-tab Recents sync)
  │        → scheduleBackup() (1.5s debounce → synced backup file)
  │     throttled version-history snapshot (one per 3 min; Save forces one)
  └─ 2s debounce → session blob to localStorage

visibilitychange / pagehide → both flushed synchronously
```

Invariants the write path maintains:

- **`syncCurrent` is the only registry writer for the current document.**
- **Opening a document you don't touch must not churn it.** Promotion into
  Recents requires content drift from the document's baseline; a no-op sync is
  skipped; hydration-time normalization (see migrations) never bumps
  `updatedAt`.
- **A blank document never enters Recents.** Placeholder subjects and empty
  bodies don't count as content.
- **The save indicator reflects a real write result**, not optimism. The one
  exception: when IndexedDB doesn't exist at all (blocked storage / some
  private modes), the in-memory document *is* the document, StorageNotice
  already says so, and the indicator marks saved rather than error.

## Resume

`init()` hydrates the registry from IndexedDB (all records + `currentId`),
then loads `docs[currentId]` — the registry entry is authoritative. If there is
no current document, the legacy single-session blob (pre-registry builds) is
folded into the registry as the first document; otherwise a fresh blank starts.

`init()` runs under a Web Lock (`dondocs-init`) so two tabs booting
simultaneously on a first post-upgrade load can't both fold the legacy session
into their own new id.

## Migrations

Both migrations run in place, on the user's machine, with no server to lean on.

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

## Multi-tab

- Registry writes broadcast over a `BroadcastChannel` (`dondocs-docs`); other
  tabs mirror the change into their Recents list. The live editor is never
  touched by a broadcast — the tab you're typing in can't be clobbered.
- A tab only persists the current document when its live state differs from
  **its own baseline** (the state it last loaded or wrote). An idle tab whose
  registry entry moved ahead via another tab's save has nothing of its own to
  contribute, so its `pagehide` flush is a no-op instead of a stale overwrite.
  Two tabs genuinely editing the same document remain last-writer-wins.
- `currentId` is origin-wide, so two tabs *can* have the same document open.
  The guard above prevents the idle-tab clobber; concurrent editing in both
  tabs is not otherwise reconciled.

## Backups

**Manual** (`Back up all documents`): serializes the in-memory registry — the
exact list the user sees — to a JSON download. Restore merges per record;
when the same id exists on both sides, the newer `updatedAt` wins, so restoring
an old backup can't overwrite newer work.

**Synced backup file** (Chromium desktop): the user picks a file once; the
`FileSystemFileHandle` persists in IndexedDB and survives restarts. Every
registry save mirrors the whole library to that file (1.5s debounce). Browsers
require a fresh user gesture to re-grant write access after a restart —
surfaced as "Reconnect auto-backup" in the Documents menu.

Backup failure semantics:

- A failed registry read **skips the write** — an empty library is never
  mirrored over a good backup file, and "last backed up" is not advanced.
- A failed file write flips the status to `error`, shown in the Documents menu
  with a retry; later saves keep retrying, and a success self-heals back to
  `connected`. Permission loss shows `needs-permission` instead.

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
| `evictable` | IndexedDB works but the browser may clear it under pressure (WebKit's ~7-day cap). Shown once the user has documents to lose. |
| `unreadable` | The database opens but records can't be read. The user's documents exist on disk but this session can't see them — reloading usually fixes it. Hydration rejects rather than showing a blank Recents, and backups refuse to run. |
| `unavailable` | IndexedDB can't be opened at all. The app stays usable; nothing persists between visits. |

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

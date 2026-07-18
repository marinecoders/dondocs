import type { DocumentMeta } from '@/stores/documentsStore';
import type { SerializedSession } from '@/stores/documentStore';
import { debug } from '@/lib/debug';

/**
 * IndexedDB store for the document registry (Recents): one record per document,
 * so a save rewrites a single record rather than the whole list. Hand-rolled to
 * avoid a dependency; every helper no-ops when IndexedDB is unavailable.
 */

export interface StoredDocument {
  id: string;
  meta: DocumentMeta;
  session: SerializedSession;
}

const DB_NAME = 'dondocs';
// v2 adds the `attachments` store (enclosure file bytes). The upgrade is purely
// additive — existing `documents`/`app` records are untouched.
const DB_VERSION = 2;
const DOCS_STORE = 'documents';
const APP_STORE = 'app'; // key/value store; currently just { key:'currentId', value }
const ATTACHMENTS_STORE = 'attachments'; // enclosure file blobs, keyed by content-free id

const hasIndexedDb = typeof indexedDB !== 'undefined';

/** Whether a durable document store exists (false in private mode / blocked
 *  storage, where a put() returning false is "no store" not "write failed"). */
export function isIdbAvailable(): boolean {
  return hasIndexedDb;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb) return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOCS_STORE)) db.createObjectStore(DOCS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(APP_STORE)) db.createObjectStore(APP_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(ATTACHMENTS_STORE)) db.createObjectStore(ATTACHMENTS_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // The browser can force-close a connection (storage eviction, "clear
      // site data", OS pressure). Without this handler the dead connection
      // stays cached and every later transaction fails for the rest of the
      // page lifetime — reset so the next call reopens a live one.
      db.onclose = () => {
        dbPromise = null;
      };
      // Another tab requesting a version upgrade would block forever while
      // this connection is held open; release it and let the next call here
      // reopen at the new version.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // Another tab on an older-version connection blocks a version bump. Reject
    // (and reset below) rather than leave the open request hanging forever.
    req.onblocked = () => reject(req.error ?? new Error('IndexedDB open blocked'));
  }).catch((err) => {
    // Never cache a rejected connection, or a transient failure would wedge all
    // persistence for the page lifetime. Clearing it lets the next call retry.
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

// Resolve on transaction commit (not request success) so a commit-time abort
// rejects instead of resolving, and wire abort/error so the promise always settles.
function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        let result: T;
        req.onsuccess = () => {
          result = req.result as T;
        };
        req.onerror = () => reject(req.error);
        t.oncomplete = () => resolve(result);
        t.onabort = () => reject(t.error ?? req.error ?? new Error('IndexedDB transaction aborted'));
        t.onerror = () => reject(t.error ?? req.error ?? new Error('IndexedDB transaction error'));
      })
  );
}

// Returns [] for a genuinely empty (or absent) registry and null when the read
// FAILED — the two must stay distinguishable, or every consumer (hydration,
// backups, import conflict-resolution) mistakes a broken database for an empty
// library and acts on it: overwriting backup files with nothing, showing a
// blank Recents to a user whose documents are intact on disk, etc.
export async function idbGetAllDocuments(): Promise<StoredDocument[] | null> {
  if (!hasIndexedDb) return [];
  try {
    return await run<StoredDocument[]>(DOCS_STORE, 'readonly', (s) => s.getAll());
  } catch (err) {
    debug.error('DocumentsDb', 'getAll failed', err);
    return null;
  }
}

// Resolves true only once the write is confirmed committed, false on any failure.
// Callers needing durability (the legacy-blob migration) gate on this; the
// fire-and-forget mirrors ignore it.
export async function idbPutDocument(doc: StoredDocument): Promise<boolean> {
  if (!hasIndexedDb) return false;
  maybeRequestPersist();
  try {
    await run(DOCS_STORE, 'readwrite', (s) => s.put(doc));
    return true;
  } catch (err) {
    debug.error('DocumentsDb', 'put failed', err);
    return false;
  }
}

export async function idbDeleteDocument(id: string): Promise<void> {
  if (!hasIndexedDb) return;
  try {
    await run(DOCS_STORE, 'readwrite', (s) => s.delete(id));
  } catch (err) {
    debug.error('DocumentsDb', 'delete failed', err);
  }
}

export async function idbGetCurrentId(): Promise<string | null> {
  if (!hasIndexedDb) return null;
  try {
    const rec = await run<{ key: string; value: string } | undefined>(APP_STORE, 'readonly', (s) => s.get('currentId'));
    return rec?.value ?? null;
  } catch (err) {
    debug.error('DocumentsDb', 'getCurrentId failed', err);
    return null;
  }
}

export async function idbSetCurrentId(id: string | null): Promise<boolean> {
  if (!hasIndexedDb) return false;
  try {
    if (id === null) {
      await run(APP_STORE, 'readwrite', (s) => s.delete('currentId'));
    } else {
      await run(APP_STORE, 'readwrite', (s) => s.put({ key: 'currentId', value: id }));
    }
    return true;
  } catch (err) {
    debug.error('DocumentsDb', 'setCurrentId failed', err);
    return false;
  }
}

// ── Synced-backup file handle ────────────────────────────────────────────────
// The File System Access API returns a FileSystemFileHandle that is
// structured-cloneable, so it survives in IndexedDB across reloads/restarts.
// Stored in the app key/value store under 'backupFileHandle'.
const BACKUP_HANDLE_KEY = 'backupFileHandle';

export async function idbGetBackupHandle(): Promise<FileSystemFileHandle | null> {
  if (!hasIndexedDb) return null;
  try {
    const rec = await run<{ key: string; value: FileSystemFileHandle } | undefined>(
      APP_STORE,
      'readonly',
      (s) => s.get(BACKUP_HANDLE_KEY)
    );
    return rec?.value ?? null;
  } catch (err) {
    debug.error('DocumentsDb', 'getBackupHandle failed', err);
    return null;
  }
}

export async function idbSetBackupHandle(handle: FileSystemFileHandle): Promise<boolean> {
  if (!hasIndexedDb) return false;
  try {
    await run(APP_STORE, 'readwrite', (s) => s.put({ key: BACKUP_HANDLE_KEY, value: handle }));
    return true;
  } catch (err) {
    debug.error('DocumentsDb', 'setBackupHandle failed', err);
    return false;
  }
}

export async function idbClearBackupHandle(): Promise<void> {
  if (!hasIndexedDb) return;
  try {
    await run(APP_STORE, 'readwrite', (s) => s.delete(BACKUP_HANDLE_KEY));
  } catch (err) {
    debug.error('DocumentsDb', 'clearBackupHandle failed', err);
  }
}

// ── Legacy-migration ledger ──────────────────────────────────────────────────
// Ids already folded from the legacy localStorage registry blob into IndexedDB.
// Kept so a PARTIAL migration can retry just the failed records on a later load
// without resurrecting docs the user deleted after they migrated
// (see documentsStore.migrateLegacyRegistry). Cleared once the blob is dropped.
const MIGRATED_IDS_KEY = 'legacyMigratedIds';

export async function idbGetMigratedIds(): Promise<string[]> {
  if (!hasIndexedDb) return [];
  try {
    const rec = await run<{ key: string; value: string[] } | undefined>(
      APP_STORE,
      'readonly',
      (s) => s.get(MIGRATED_IDS_KEY)
    );
    return rec?.value ?? [];
  } catch (err) {
    debug.error('DocumentsDb', 'getMigratedIds failed', err);
    return [];
  }
}

export async function idbSetMigratedIds(ids: string[]): Promise<void> {
  if (!hasIndexedDb) return;
  try {
    if (ids.length === 0) {
      await run(APP_STORE, 'readwrite', (s) => s.delete(MIGRATED_IDS_KEY));
    } else {
      await run(APP_STORE, 'readwrite', (s) => s.put({ key: MIGRATED_IDS_KEY, value: ids }));
    }
  } catch (err) {
    debug.error('DocumentsDb', 'setMigratedIds failed', err);
  }
}

// Request persistent storage on first write so docs aren't evicted under disk pressure.
let persistRequested = false;
function maybeRequestPersist(): void {
  if (persistRequested) return;
  persistRequested = true;
  navigator.storage
    ?.persist?.()
    .then((granted) => debug.log('DocumentsDb', 'persistent storage', { granted }))
    .catch(() => {});
}

export type StorageHealth = 'ok' | 'evictable' | 'unreadable' | 'unavailable';

/**
 * How durable the user's saved documents actually are in this browser:
 *  - 'unavailable': IndexedDB can't be opened (disabled by policy, blocked site
 *    data, or some private modes) — the Recents library won't persist at all.
 *  - 'unreadable': the database opens but its records can't be read — the
 *    user's documents exist on disk but this session can't see them.
 *  - 'evictable': IndexedDB works but persistent storage isn't granted, so the
 *    browser may clear it under disk pressure or inactivity (e.g. WebKit's
 *    ~7-day cap).
 *  - 'ok': persistent storage is granted.
 * Uses the passive `persisted()` check (no permission prompt).
 */
/**
 * Ask the browser to protect this origin's storage from eviction. Persistence
 * covers everything the app depends on — IndexedDB (documents), Cache Storage
 * (the offline engines AND the service worker's precache), and the service
 * worker registration itself. Without it, disk pressure can evict the
 * precache out from under an installed worker, leaving it serving a shell
 * whose assets are gone (the recurring unstyled-page loop the boot watchdog
 * heals). Asking is the systemic fix; the watchdog is the backstop.
 *
 * Only asks once the user actually has documents: Chromium decides silently
 * from engagement signals either way, but Firefox shows a permission dialog,
 * and prompting a first-time visitor with nothing to lose is noise. Best
 * effort — returns whether storage is persistent afterwards.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist || !navigator.storage.persisted) return false;
    if (await navigator.storage.persisted()) return true;
    if (!hasIndexedDb) return false;
    const records = await idbGetAllDocuments();
    if (!records || records.length === 0) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function probeStorageHealth(): Promise<StorageHealth> {
  if (!hasIndexedDb) return 'unavailable';
  try {
    await openDb();
  } catch {
    return 'unavailable';
  }
  // A database that opens but can't be read must never probe as healthy — an
  // empty-looking library would suppress the very notice that explains it.
  const records = await idbGetAllDocuments();
  if (records === null) return 'unreadable';
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return 'ok';
  } catch {
    // persisted() unsupported or threw — fall through to best-effort.
  }
  // Best-effort storage. Only warn once the user actually has documents at risk;
  // a brand-new visitor has created nothing to lose, and persistence is often
  // auto-granted (Chromium) after the first real write anyway.
  if (records.length === 0) return 'ok';
  return 'evictable';
}

// ── Version history ─────────────────────────────────────────────────────────
// Per-document snapshots stored in the key/value APP_STORE under `snap:<id>`
// (no schema/version bump needed). Capped to the most recent MAX_SNAPSHOTS.

export interface DocSnapshot {
  ts: number;
  session: SerializedSession;
}

export const MAX_SNAPSHOTS = 10;

export async function idbGetSnapshots(docId: string): Promise<DocSnapshot[]> {
  if (!hasIndexedDb) return [];
  try {
    const rec = await run<{ key: string; value: DocSnapshot[] } | undefined>(
      APP_STORE,
      'readonly',
      (s) => s.get(`snap:${docId}`)
    );
    return rec?.value ?? [];
  } catch (err) {
    debug.error('DocumentsDb', 'getSnapshots failed', err);
    return [];
  }
}

export async function idbAddSnapshot(docId: string, snap: DocSnapshot): Promise<boolean> {
  if (!hasIndexedDb) return false;
  try {
    // Read-modify-write of the ring in ONE transaction. Two separate calls
    // (get, then put) let concurrent adds — e.g. restore's safety snapshot
    // racing Save's checkpoint — read the same ring and clobber each other's
    // write, silently dropping history. A single readwrite transaction
    // serializes them, and a failed read aborts before the put can replace
    // the ring with just the newest entry.
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(APP_STORE, 'readwrite');
      const store = t.objectStore(APP_STORE);
      const getReq = store.get(`snap:${docId}`);
      getReq.onsuccess = () => {
        const existing = (getReq.result as { value?: DocSnapshot[] } | undefined)?.value ?? [];
        store.put({ key: `snap:${docId}`, value: [snap, ...existing].slice(0, MAX_SNAPSHOTS) });
      };
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
      t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction error'));
    });
    return true;
  } catch (err) {
    debug.error('DocumentsDb', 'addSnapshot failed', err);
    return false;
  }
}

// Overwrite a document's whole snapshot ring in one shot (backup restore writes
// a merged ring). Caps defensively at MAX_SNAPSHOTS; an empty ring deletes the
// key rather than storing []. idbAddSnapshot is still the path for incremental,
// serialized single-snapshot appends.
export async function idbSetSnapshots(docId: string, snaps: DocSnapshot[]): Promise<boolean> {
  if (!hasIndexedDb) return false;
  try {
    if (snaps.length === 0) {
      await run(APP_STORE, 'readwrite', (s) => s.delete(`snap:${docId}`));
    } else {
      await run(APP_STORE, 'readwrite', (s) =>
        s.put({ key: `snap:${docId}`, value: snaps.slice(0, MAX_SNAPSHOTS) })
      );
    }
    return true;
  } catch (err) {
    debug.error('DocumentsDb', 'setSnapshots failed', err);
    return false;
  }
}

export async function idbDeleteSnapshots(docId: string): Promise<void> {
  if (!hasIndexedDb) return;
  try {
    await run(APP_STORE, 'readwrite', (s) => s.delete(`snap:${docId}`));
  } catch (err) {
    debug.error('DocumentsDb', 'deleteSnapshots failed', err);
  }
}

// ── Enclosure attachments ────────────────────────────────────────────────────
// Enclosure file bytes, stored once and referenced by id from a document's
// serialized enclosures (see src/lib/attachments.ts). Kept in their own store so
// the (potentially large) blobs never bloat a document record's read/write, and
// so a backup can pull exactly the blobs its documents reference.

export interface StoredAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  data: ArrayBuffer;
}

/** Confirms the blob is committed; false on any failure (callers keep the
 *  in-memory copy either way, so a failed persist just means "not durable"). */
export async function idbPutAttachment(rec: StoredAttachment): Promise<boolean> {
  if (!hasIndexedDb) return false;
  maybeRequestPersist();
  try {
    await run(ATTACHMENTS_STORE, 'readwrite', (s) => s.put(rec));
    return true;
  } catch (err) {
    debug.error('DocumentsDb', 'putAttachment failed', err);
    return false;
  }
}

export async function idbGetAttachment(id: string): Promise<StoredAttachment | null> {
  if (!hasIndexedDb) return null;
  try {
    const rec = await run<StoredAttachment | undefined>(ATTACHMENTS_STORE, 'readonly', (s) => s.get(id));
    return rec ?? null;
  } catch (err) {
    debug.error('DocumentsDb', 'getAttachment failed', err);
    return null;
  }
}

// Returns [] for a genuinely empty store and null when the read FAILED — a
// backup must be able to tell "no attachments" from "couldn't read them" so it
// never writes a bundle that silently drops every enclosure's bytes.
export async function idbGetAllAttachments(): Promise<StoredAttachment[] | null> {
  if (!hasIndexedDb) return [];
  try {
    return await run<StoredAttachment[]>(ATTACHMENTS_STORE, 'readonly', (s) => s.getAll());
  } catch (err) {
    debug.error('DocumentsDb', 'getAllAttachments failed', err);
    return null;
  }
}

export async function idbDeleteAttachment(id: string): Promise<void> {
  if (!hasIndexedDb) return;
  try {
    await run(ATTACHMENTS_STORE, 'readwrite', (s) => s.delete(id));
  } catch (err) {
    debug.error('DocumentsDb', 'deleteAttachment failed', err);
  }
}

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
const DB_VERSION = 1;
const DOCS_STORE = 'documents';
const APP_STORE = 'app'; // key/value store; currently just { key:'currentId', value }

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
    };
    req.onsuccess = () => resolve(req.result);
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

export async function idbGetAllDocuments(): Promise<StoredDocument[]> {
  if (!hasIndexedDb) return [];
  try {
    return await run<StoredDocument[]>(DOCS_STORE, 'readonly', (s) => s.getAll());
  } catch (err) {
    debug.error('DocumentsDb', 'getAll failed', err);
    return [];
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

export type StorageHealth = 'ok' | 'evictable' | 'unavailable';

/**
 * How durable the user's saved documents actually are in this browser:
 *  - 'unavailable': IndexedDB can't be opened (disabled by policy, blocked site
 *    data, or some private modes) — the Recents library won't persist at all.
 *  - 'evictable': IndexedDB works but persistent storage isn't granted, so the
 *    browser may clear it under disk pressure or inactivity (e.g. WebKit's
 *    ~7-day cap).
 *  - 'ok': persistent storage is granted.
 * Uses the passive `persisted()` check (no permission prompt).
 */
export async function probeStorageHealth(): Promise<StorageHealth> {
  if (!hasIndexedDb) return 'unavailable';
  try {
    await openDb();
  } catch {
    return 'unavailable';
  }
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return 'ok';
  } catch {
    // persisted() unsupported or threw — fall through to best-effort.
  }
  // Best-effort storage. Only warn once the user actually has documents at risk;
  // a brand-new visitor has created nothing to lose, and persistence is often
  // auto-granted (Chromium) after the first real write anyway.
  try {
    if ((await idbGetAllDocuments()).length === 0) return 'ok';
  } catch {
    /* ignore */
  }
  return 'evictable';
}

// ── Version history ─────────────────────────────────────────────────────────
// Per-document snapshots stored in the key/value APP_STORE under `snap:<id>`
// (no schema/version bump needed). Capped to the most recent MAX_SNAPSHOTS.

export interface DocSnapshot {
  ts: number;
  session: SerializedSession;
}

const MAX_SNAPSHOTS = 10;

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
    const next = [snap, ...(await idbGetSnapshots(docId))].slice(0, MAX_SNAPSHOTS);
    await run(APP_STORE, 'readwrite', (s) => s.put({ key: `snap:${docId}`, value: next }));
    return true;
  } catch (err) {
    debug.error('DocumentsDb', 'addSnapshot failed', err);
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

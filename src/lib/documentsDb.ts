import type { DocumentMeta } from '@/stores/documentsStore';
import type { SerializedSession } from '@/stores/documentStore';
import { debug } from '@/lib/debug';
import type { ReviewRound, ReviewCopyLink } from './reviewRounds';
import type { ReviewReturnReceipt } from './reviewReturns';
import { parseReviewRound, reviewCopyLinkSchema } from './reviewRounds';
import { supportsReviewComments } from './reviewCommentTargets';
import type { ReviewSuggestionWrite } from './reviewSuggestionWrites';

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

export const reviewRoundKey = (id: string) => `review:${id}`;
export const reviewCopyKey = (documentId: string) => `review-copy:${documentId}`;
export const reviewReturnKey = (roundId: string, returnId: string) => `review-return:${roundId}:${returnId}`;
export const reviewSuggestionKey = (documentId: string, roundId: string) => `review-suggestions:${documentId}:${roundId}`;
export const reviewSuggestionReceiptKey = (id: string) => `review-suggestion-write:${id}`;

export async function idbReadReviewSuggestions(documentId: string, roundId: string): Promise<unknown | null> {
  return (await run<{ value: unknown } | undefined>(APP_STORE, 'readonly', store => store.get(reviewSuggestionKey(documentId, roundId))))?.value ?? null;
}
export async function idbReadAllReviewSuggestions(): Promise<unknown[]> {
  return (await run<Array<{ value: unknown }>>(APP_STORE, 'readonly', store =>
    store.getAll(IDBKeyRange.bound('review-suggestions:', 'review-suggestions:\uffff')))).map(record => record.value);
}
export async function idbReadReviewSuggestionReceipt(id: string): Promise<unknown | null> {
  return (await run<{ value: unknown } | undefined>(APP_STORE, 'readonly', store => store.get(reviewSuggestionReceiptKey(id))))?.value ?? null;
}
export async function idbReadReviewSuggestionReceipts(): Promise<unknown[]> {
  return (await run<Array<{ value: unknown }>>(APP_STORE, 'readonly', store =>
    store.getAll(IDBKeyRange.bound('review-suggestion-write:', 'review-suggestion-write:\uffff')))).map(record => record.value);
}

export async function idbReadReviewReturn(roundId: string, returnId: string): Promise<unknown | null> {
  return (await run<{ value: unknown } | undefined>(APP_STORE, 'readonly', store => store.get(reviewReturnKey(roundId, returnId))))?.value ?? null;
}

export async function idbReadReviewReturns(): Promise<unknown[]> {
  return (await run<Array<{ value: unknown }>>(APP_STORE, 'readonly', store =>
    store.getAll(IDBKeyRange.bound('review-return:', 'review-return:\uffff')))).map(record => record.value);
}

/** Read receipts and their saved owners at one database revision for workspace backup. */
export async function idbReadReviewReturnBackup(): Promise<{ receipts: unknown[]; documents: StoredDocument[]; suggestions: unknown[]; suggestionReceipts: unknown[] }> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([APP_STORE, DOCS_STORE], 'readonly');
    const receipts = transaction.objectStore(APP_STORE).getAll(IDBKeyRange.bound('review-return:', 'review-return:\uffff'));
    const suggestions = transaction.objectStore(APP_STORE).getAll(IDBKeyRange.bound('review-suggestions:', 'review-suggestions:\uffff'));
    const suggestionReceipts = transaction.objectStore(APP_STORE).getAll(IDBKeyRange.bound('review-suggestion-write:', 'review-suggestion-write:\uffff'));
    const documents = transaction.objectStore(DOCS_STORE).getAll();
    transaction.oncomplete = () => resolve({ suggestions: suggestions.result.map(record => record.value), suggestionReceipts: suggestionReceipts.result.map(record => record.value), receipts: receipts.result.map(record => record.value), documents: documents.result });
    transaction.onerror = () => reject(transaction.error ?? new Error('Review receipts could not be read.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Review receipt capture aborted.'));
  });
}

/** Restore acknowledgements only beside the exact saved discussion revision in this backup. */
export async function idbRestoreReviewReturns(receipts: ReviewReturnReceipt[], expected: StoredDocument[]): Promise<boolean> {
  if (!receipts.length) return true;
  try {
    const owned = structuredClone(receipts), snapshots = structuredClone(expected);
    const db = await openDb();
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([APP_STORE, DOCS_STORE], 'readwrite');
      const app = transaction.objectStore(APP_STORE), documents = transaction.objectStore(DOCS_STORE);
      const prior = owned.map(receipt => app.get(reviewReturnKey(receipt.roundId, receipt.returnId)));
      const rounds = owned.map(receipt => app.get(reviewRoundKey(receipt.roundId)));
      const owners = owned.map(receipt => documents.get(receipt.documentId));
      const requests = [...prior, ...rounds, ...owners];let remaining = requests.length, restored = false;
      const ready = () => {
        if (--remaining) return;
        if (owned.some((receipt, index) => {
          const round = rounds[index].result?.value as ReviewRound | undefined;
          const current = owners[index].result as StoredDocument | undefined;
          const snapshot = snapshots.find(document => document.id === receipt.documentId);
          return !round || round.ownerDocumentId !== receipt.documentId || round.baselineDigest !== receipt.baselineDigest
            || !current || !snapshot || current.meta.updatedAt !== snapshot.meta.updatedAt
            || !sameReviewStoredValue(current.session.reviewComments, snapshot.session.reviewComments)
            || prior[index].result && !sameReviewStoredValue(prior[index].result.value, receipt);
        })) return;
        owned.forEach((receipt, index) => { if (!prior[index].result) app.put({ key: reviewReturnKey(receipt.roundId, receipt.returnId), value: receipt }); });
        restored = true;
      };
      requests.forEach(request => { request.onsuccess = ready; });
      transaction.oncomplete = () => resolve(restored);
      transaction.onerror = () => reject(transaction.error ?? new Error('Review receipt recovery failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Review receipt recovery aborted.'));
    });
  } catch { return false; }
}

/** Review pins live beside History and are not pruned with its ten-entry ring. */
export async function idbReadReviewRound(id: string): Promise<unknown | null> {
  return (await run<{ value: unknown } | undefined>(APP_STORE, 'readonly', store => store.get(reviewRoundKey(id))))?.value ?? null;
}

export async function idbReadReviewRounds(): Promise<unknown[]> {
  const records = await run<Array<{ value: unknown }>>(APP_STORE, 'readonly', store =>
    store.getAll(IDBKeyRange.bound('review:', 'review:\uffff')));
  return records.map(record => record.value);
}

export async function idbReadReviewCopies(): Promise<unknown[]> {
  const records = await run<Array<{ value: unknown }>>(APP_STORE, 'readonly', store =>
    store.getAll(IDBKeyRange.bound('review-copy:', 'review-copy:\uffff')));
  return records.map(record => record.value);
}

export async function idbReadReviewCopy(documentId: string): Promise<unknown | null> {
  return (await run<{ value: unknown } | undefined>(APP_STORE, 'readonly', store => store.get(reviewCopyKey(documentId))))?.value ?? null;
}

/** An existing round is immutable; a retry may only acknowledge the same pin. */
export async function idbAddReviewRound(input: ReviewRound): Promise<'committed' | 'unchanged' | 'conflict' | 'failed'> {
  try {
    const round = structuredClone(input);
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(APP_STORE, 'readwrite');
      const store = transaction.objectStore(APP_STORE);
      const request = store.get(reviewRoundKey(round.id));
      let outcome: 'committed' | 'unchanged' | 'conflict' = 'conflict';
      request.onsuccess = () => {
        if (request.result) {
          if (JSON.stringify(request.result.value) === JSON.stringify(round)) outcome = 'unchanged';
          return;
        }
        try {
          store.put({ key: reviewRoundKey(round.id), value: round });
          outcome = 'committed';
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(outcome);
      transaction.onerror = () => reject(transaction.error ?? new Error('Review pin could not be saved.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Review pin save aborted.'));
    });
  } catch { return 'failed'; }
}

/** A received reviewer copy, its pin and its local association commit together. */
export async function idbInstallReviewCopy(input: StoredDocument, pin: ReviewRound, association: ReviewCopyLink): Promise<boolean> {
  try {
    const document = structuredClone(input), round = structuredClone(pin), link = structuredClone(association);
    if (document.id !== link.documentId || round.id !== link.roundId || round.baselineDigest !== link.baselineDigest) return false;
    const db = await openDb();
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([DOCS_STORE, APP_STORE], 'readwrite');
      const documents = transaction.objectStore(DOCS_STORE), app = transaction.objectStore(APP_STORE);
      const existingDocument = documents.get(document.id), existingRound = app.get(reviewRoundKey(round.id));
      let remaining = 2, installed = false;
      const ready = () => {
        if (--remaining) return;
        const previous = existingRound.result?.value as ReviewRound | undefined;
        if (existingDocument.result || previous && (previous.baselineDigest !== round.baselineDigest
          || previous.sourceDocumentId !== round.sourceDocumentId)) return;
        try {
          documents.put(document);
          // Receiving a copy must never overwrite a local owner's established pin.
          if (!previous) app.put({ key: reviewRoundKey(round.id), value: { ...round, ownerDocumentId: undefined } });
          app.put({ key: reviewCopyKey(link.documentId), value: link });
          installed = true;
        } catch { transaction.abort(); }
      };
      existingDocument.onsuccess = ready;
      existingRound.onsuccess = ready;
      transaction.oncomplete = () => resolve(installed);
      transaction.onerror = () => reject(transaction.error ?? new Error('Review copy could not be saved.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Review copy save aborted.'));
    });
  } catch { return false; }
}

/** Restore one complete review section; conflicts or missing copied documents install nothing. */
export async function idbRestoreReviewRecords(pins: ReviewRound[], associations: ReviewCopyLink[]): Promise<boolean> {
  if (!pins.length && !associations.length) return true;
  try {
    const rounds = structuredClone(pins), copies = structuredClone(associations);
    if (new Set(rounds.map(round => round.id)).size !== rounds.length || new Set(copies.map(copy => copy.documentId)).size !== copies.length
      || copies.some(copy => !rounds.some(round => round.id === copy.roundId && round.baselineDigest === copy.baselineDigest))) return false;
    const db = await openDb();
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([APP_STORE, DOCS_STORE], 'readwrite');
      const app = transaction.objectStore(APP_STORE), documents = transaction.objectStore(DOCS_STORE);
      const roundReads = rounds.map(round => app.get(reviewRoundKey(round.id)));
      const copyReads = copies.map(copy => app.get(reviewCopyKey(copy.documentId)));
      const documentReads = copies.map(copy => documents.get(copy.documentId));
      const requests = [...roundReads, ...copyReads, ...documentReads];
      let remaining = requests.length, restored = false;
      const ready = () => {
        if (--remaining) return;
        if (rounds.some((round, index) => {
          const existing = roundReads[index].result?.value as ReviewRound | undefined;
          return existing && (existing.baselineDigest !== round.baselineDigest || existing.sourceDocumentId !== round.sourceDocumentId);
        }) || copies.some((copy, index) => {
          const existing = copyReads[index].result?.value as ReviewCopyLink | undefined;
          return !documentReads[index].result || existing && (existing.roundId !== copy.roundId || existing.baselineDigest !== copy.baselineDigest);
        })) return;
        try {
          rounds.forEach((round, index) => { if (!roundReads[index].result) app.put({ key: reviewRoundKey(round.id), value: round }); });
          copies.forEach((copy, index) => { if (!copyReads[index].result) app.put({ key: reviewCopyKey(copy.documentId), value: copy }); });
          restored = true;
        } catch { transaction.abort(); }
      };
      requests.forEach(request => { request.onsuccess = ready; });
      transaction.oncomplete = () => resolve(restored);
      transaction.onerror = () => reject(transaction.error ?? new Error('Review recovery failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Review recovery aborted.'));
    });
  } catch { return false; }
}

/** Release one reviewed pin and its local links together; editable documents remain. */
export async function idbDeleteReviewRound(id: string, expectedDigest: string): Promise<boolean> {
  try {
    const { reviewSuggestionRecordSchema, reviewSuggestionReceiptSchema } = await import('./reviewSuggestionWrites');
    const db = await openDb();
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction(APP_STORE, 'readwrite'), store = transaction.objectStore(APP_STORE);
      const pin = store.get(reviewRoundKey(id));
      const copies = store.getAll(IDBKeyRange.bound('review-copy:', 'review-copy:\uffff'));
      const receipts = store.getAll(IDBKeyRange.bound(`review-return:${id}:`, `review-return:${id}:\uffff`));
      const suggestions = store.getAll(IDBKeyRange.bound('review-suggestions:', 'review-suggestions:\uffff'));
      const suggestionReceipts = store.getAll(IDBKeyRange.bound('review-suggestion-write:', 'review-suggestion-write:\uffff'));
      let remaining = 5, deleted = false;
      const ready = () => {
        if (--remaining) return;
        if (pin.result && pin.result.value?.baselineDigest !== expectedDigest) return;
        const savedReceipts = receipts.result as Array<{ key: string; value?: { kind?: string; version?: number } }>;
        if (savedReceipts.some(receipt => receipt.value?.kind !== 'dondocs-review-return-receipt' || receipt.value.version !== 1)) return;
        if (suggestions.result.some(record => record.value?.state?.roundId === id && !reviewSuggestionRecordSchema.safeParse(record.value).success)
          || suggestionReceipts.result.some(record => record.value?.roundId === id && !reviewSuggestionReceiptSchema.safeParse(record.value).success)) return;
        try {
          store.delete(reviewRoundKey(id));
          for (const copy of copies.result as Array<{ key: string; value: ReviewCopyLink | null }>) {
            if (copy.value?.roundId === id) store.delete(copy.key);
          }
          for (const receipt of savedReceipts) store.delete(receipt.key);
          for (const record of suggestions.result as Array<{ key: string; value?: { state?: { roundId?: string } } }>) {
            if (record.value?.state?.roundId === id) store.delete(record.key);
          }
          for (const receipt of suggestionReceipts.result as Array<{ key: string; value?: { roundId?: string } }>) {
            if (receipt.value?.roundId === id) store.delete(receipt.key);
          }
          deleted = true;
        } catch { transaction.abort(); }
      };
      pin.onsuccess = ready;copies.onsuccess = ready;receipts.onsuccess = ready;suggestions.onsuccess = ready;suggestionReceipts.onsuccess = ready;
      transaction.oncomplete = () => resolve(deleted);
      transaction.onerror = () => reject(transaction.error ?? new Error('Review removal failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Review removal aborted.'));
    });
  } catch { return false; }
}

export async function putBatchOutput(id: string, data: Uint8Array): Promise<boolean> {
  try { await run(APP_STORE, 'readwrite', (s) => s.put({ key: `batch:${id}`, value: data })); return true; }
  catch { return false; }
}
export async function getBatchOutput(id: string): Promise<Uint8Array | null> {
  try { return (await run<{ value: Uint8Array } | undefined>(APP_STORE, 'readonly', (s) => s.get(`batch:${id}`)))?.value ?? null; }
  catch { return null; }
}
export async function deleteBatchOutput(id: string): Promise<void> {
  try { await run(APP_STORE, 'readwrite', (s) => s.delete(`batch:${id}`)); } catch { /* retry on the next new job */ }
}

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

export type DocumentWriteOutcome = 'committed' | 'already-committed' | 'conflict' | 'missing-document' | 'failed';

/** Compare and write in one transaction; ordinary saves and recovery share this contract. */
export async function idbWriteDocument(
  before: StoredDocument | null,
  after: StoredDocument,
  intermediates: StoredDocument[] = [],
  recovering = false,
): Promise<DocumentWriteOutcome> {
  if (!hasIndexedDb) return 'failed';
  if ((before && before.id !== after.id) || intermediates.some(item => item.id !== after.id)) return 'conflict';
  maybeRequestPersist();
  try {
    const db = await openDb();
    return await new Promise<DocumentWriteOutcome>((resolve, reject) => {
      const transaction = db.transaction(DOCS_STORE, 'readwrite');
      const store = transaction.objectStore(DOCS_STORE);
      const request = store.get(after.id);
      let outcome: DocumentWriteOutcome = 'conflict';
      request.onsuccess = () => {
        const current = request.result as StoredDocument | undefined;
        const equal = (value: StoredDocument | null | undefined) => JSON.stringify(current ?? null) === JSON.stringify(value ?? null);
        if (equal(after)) { outcome = 'already-committed'; return; }
        if (!current && (before || recovering)) { outcome = 'missing-document'; return; }
        if (!equal(before) && !intermediates.some(equal)) return;
        store.put(after);
        outcome = 'committed';
      };
      transaction.oncomplete = () => resolve(outcome);
      transaction.onabort = () => reject(transaction.error ?? new Error('Document write aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Document write failed'));
    });
  } catch (error) {
    debug.error('DocumentsDb', 'Conditional document write failed', error);
    return 'failed';
  }
}

export async function idbRecoverDocument(before: StoredDocument, after: StoredDocument): Promise<boolean> {
  return await idbWriteDocument(before, after, [], true) === 'committed';
}

export type DocumentDeleteOutcome = 'deleted' | 'already-deleted' | 'conflict' | 'failed';

/** Delete the reviewed revision and its history in the same transaction. */
export async function idbDeleteDocumentIfUnchanged(expected: StoredDocument): Promise<DocumentDeleteOutcome> {
  if (!hasIndexedDb || expected.meta.id !== expected.id) return 'failed';
  const owned = structuredClone(expected);
  try {
    const db = await openDb();
    return await new Promise<DocumentDeleteOutcome>((resolve, reject) => {
      const transaction = db.transaction([DOCS_STORE, APP_STORE], 'readwrite');
      const store = transaction.objectStore(DOCS_STORE);
      const request = store.get(owned.id);
      let outcome: DocumentDeleteOutcome = 'conflict';
      request.onsuccess = () => {
        const current = request.result as StoredDocument | undefined;
        if (current && JSON.stringify(current) !== JSON.stringify(owned)) return;
        if (current) store.delete(owned.id);
        transaction.objectStore(APP_STORE).delete(`snap:${owned.id}`);
        outcome = current ? 'deleted' : 'already-deleted';
      };
      transaction.oncomplete = () => resolve(outcome);
      transaction.onabort = () => reject(transaction.error ?? new Error('Document deletion aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Document deletion failed'));
    });
  } catch (error) {
    debug.error('DocumentsDb', 'conditional delete failed', error);
    return 'failed';
  }
}

export async function idbDeleteDocument(id: string): Promise<boolean> {
  if (!hasIndexedDb) return false;
  try {
    await run(DOCS_STORE, 'readwrite', (s) => s.delete(id));
    return true;
  } catch (err) {
    debug.error('DocumentsDb', 'delete failed', err);
    return false;
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

/** A recovery in one tab must not clear another tab's newer resume choice. */
export async function idbClearCurrentIdIfUnchanged(expected: string): Promise<boolean> {
  if (!hasIndexedDb) return false;
  try {
    const db = await openDb();
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction(APP_STORE, 'readwrite');
      const store = transaction.objectStore(APP_STORE);
      const request = store.get('currentId');
      let cleared = false;
      request.onsuccess = () => {
        if (request.result?.value !== expected) return;
        store.delete('currentId');
        cleared = true;
      };
      transaction.oncomplete = () => resolve(cleared);
      transaction.onabort = () => reject(transaction.error ?? new Error('Resume reset aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Resume reset failed'));
    });
  } catch { return false; }
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

/** Strict read for History: an unavailable/failed store must not look empty. */
export async function idbReadSnapshots(docId: string): Promise<DocSnapshot[]> {
  const rec = await run<{ key: string; value: DocSnapshot[] } | undefined>(
    APP_STORE, 'readonly', (s) => s.get(`snap:${docId}`)
  );
  return rec?.value ?? [];
}

/** Best-effort compatibility read for existing background callers. */
export async function idbGetSnapshots(docId: string, strict = false): Promise<DocSnapshot[]> {
  if (!hasIndexedDb) return [];
  try {
    return await idbReadSnapshots(docId);
  } catch (err) {
    debug.error('DocumentsDb', 'getSnapshots failed', err);
    if (strict) throw new Error(`History for ${docId} could not be read`, { cause: err });
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
        store.put({ key: `snap:${docId}`, value: [snap, ...existing].sort((a, b) => b.ts - a.ts).slice(0, MAX_SNAPSHOTS) });
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
export async function idbSetSnapshots(docId: string, snaps: DocSnapshot[], merge = false): Promise<boolean> {
  if (!hasIndexedDb) return false;
  try {
    if (merge) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(APP_STORE, 'readwrite');
        const store = tx.objectStore(APP_STORE);
        const key = `snap:${docId}`;
        const request = store.get(key);
        request.onsuccess = () => {
          const current: DocSnapshot[] = request.result?.value ?? [];
          const byTime = new Map([...snaps, ...current].map(snapshot => [snapshot.ts, snapshot]));
          store.put({ key, value: [...byTime.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_SNAPSHOTS) });
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('History merge aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('History merge failed'));
      });
    } else if (snaps.length === 0) {
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

/** Enrich only unchanged entries; a concurrent edit/delete must remain authoritative. */
export async function idbEnrichSnapshots(docId: string, before: DocSnapshot[], after: DocSnapshot[]): Promise<boolean> {
  if (!hasIndexedDb || before.length !== after.length || before.some((snapshot, index) => snapshot.ts !== after[index].ts)) return false;
  const expected = structuredClone(before);
  const prepared = structuredClone(after);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(APP_STORE, 'readwrite');
      const store = tx.objectStore(APP_STORE);
      const key = `snap:${docId}`;
      const request = store.get(key);
      request.onsuccess = () => {
        const current: DocSnapshot[] = request.result?.value ?? [];
        let changed = false;
        const value = current.map(snapshot => {
          const index = expected.findIndex(entry => JSON.stringify(entry) === JSON.stringify(snapshot));
          if (index < 0 || JSON.stringify(snapshot) === JSON.stringify(prepared[index])) return snapshot;
          changed = true;return prepared[index];
        });
        if (changed) store.put({ key, value });
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('History enrichment aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('History enrichment failed'));
    });
    return true;
  } catch (error) { debug.warn('DocumentsDb', 'History enrichment could not finish', error);return false; }
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
export async function idbPutAttachment(rec: StoredAttachment, onlyAbsent = false): Promise<boolean> {
  if (!hasIndexedDb) return false;
  maybeRequestPersist();
  try {
    await run(ATTACHMENTS_STORE, 'readwrite', (s) => onlyAbsent ? s.add(rec) : s.put(rec));
    return true;
  } catch (err) {
    debug.error('DocumentsDb', 'putAttachment failed', err);
    return false;
  }
}

export type AttachmentReadResult =
  | { readonly status: 'found'; readonly attachment: StoredAttachment }
  | { readonly status: 'missing' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'failed'; readonly error: unknown };

export async function idbReadAttachment(id: string): Promise<AttachmentReadResult> {
  if (!hasIndexedDb) return { status: 'unavailable' };
  try {
    const attachment = await run<StoredAttachment | undefined>(ATTACHMENTS_STORE, 'readonly', store => store.get(id));
    if (!attachment) return { status: 'missing' };
    if (attachment.id !== id || typeof attachment.name !== 'string' || typeof attachment.type !== 'string'
      || !(attachment.data instanceof ArrayBuffer)) {
      return { status: 'failed', error: new Error(`Invalid attachment record: ${id}`) };
    }
    return { status: 'found', attachment: { ...attachment, size: attachment.data.byteLength } };
  } catch (error) { return { status: 'failed', error }; }
}

/** Compatibility reader; callers requiring completeness use idbReadAttachment. */
export async function idbGetAttachment(id: string): Promise<StoredAttachment | null> {
  const result = await idbReadAttachment(id);
  if (result.status === 'failed') debug.error('DocumentsDb', 'getAttachment failed', result.error);
  return result.status === 'found' ? result.attachment : null;
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

/** Includes snapshots and soft-deleted documents; a failed read forbids cache eviction. */
export async function idbFormDefinitions(): Promise<import('@/services/forms/model').FormDefinition[] | null> {
  if (!hasIndexedDb) return null;
  try {
    const docs = await run<StoredDocument[]>(DOCS_STORE, 'readonly', s => s.getAll());
    const app = await run<Array<{ key: string; value: unknown }>>(APP_STORE, 'readonly', s => s.getAll());
    const sessions = docs.map(d => d.session);
    for (const entry of app) if (entry.key.startsWith('snap:') && Array.isArray(entry.value)) {
      for (const snapshot of entry.value as DocSnapshot[]) sessions.push(snapshot.session);
    }
    return sessions.flatMap(s => s.genericForm ? [s.genericForm.definition] : []);
  } catch { return null; }
}

export type ReviewReturnWriteOutcome = 'committed' | 'already-committed' | 'already-imported' | 'conflict' | 'missing-document' | 'stale' | 'failed';

/** Compare saved JSON and legacy inline buffers without treating different bytes as empty objects. */
export function sameReviewStoredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof ArrayBuffer || right instanceof ArrayBuffer || ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    const bytes = (value: unknown) => value instanceof ArrayBuffer ? new Uint8Array(value)
      : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;
    const a = bytes(left), b = bytes(right);
    return !!a && !!b && a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  // JSON journals omit optional object properties whose value is undefined.
  // Preserve array slots (including holes) and byte comparisons above.
  const keys = (value: object) => Object.keys(value).filter(key => Array.isArray(value) || (value as Record<string, unknown>)[key] !== undefined);
  const a = keys(left), b = keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key)
    && sameReviewStoredValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/** A comment-return fence cannot carry body, attachment or other metadata changes. */
export function isCommentOnlyReviewReturnChange(before: StoredDocument, after: StoredDocument): boolean {
  const withoutComments = (record: StoredDocument) => {
    const copy = structuredClone(record);delete copy.session.reviewComments;
    delete (copy.meta as Partial<DocumentMeta>).updatedAt;return copy;
  };
  return sameReviewStoredValue(withoutComments(before), withoutComments(after));
}

/** The discussion update and deduplication receipt either both commit or neither does. */
export async function idbApplyReviewReturn(
  inputBefore: StoredDocument,
  inputAfter: StoredDocument,
  inputRound: Pick<ReviewRound, 'id' | 'baselineDigest' | 'ownerDocumentId'>,
  inputReceipt: ReviewReturnReceipt,
  isCurrent: () => boolean = () => true,
): Promise<ReviewReturnWriteOutcome> {
  try {
    const before = structuredClone(inputBefore), after = structuredClone(inputAfter);
    const round = structuredClone(inputRound), receipt = structuredClone(inputReceipt);
    if (!isCurrent()) return 'stale';
    if (before.id !== after.id || before.meta.id !== before.id || after.meta.id !== before.id
      || round.ownerDocumentId !== before.id || receipt.documentId !== before.id
      || round.id !== receipt.roundId || round.baselineDigest !== receipt.baselineDigest) return 'conflict';
    if (!isCommentOnlyReviewReturnChange(before, after)) return 'conflict';
    const db = await openDb();
    return await new Promise<ReviewReturnWriteOutcome>((resolve, reject) => {
      const transaction = db.transaction([DOCS_STORE, APP_STORE], 'readwrite');
      const documents = transaction.objectStore(DOCS_STORE), app = transaction.objectStore(APP_STORE);
      const documentRequest = documents.get(before.id), roundRequest = app.get(reviewRoundKey(round.id));
      const receiptRequest = app.get(reviewReturnKey(round.id, receipt.returnId));
      let remaining = 3, outcome: ReviewReturnWriteOutcome = 'conflict';
      const ready = () => {
        if (--remaining) return;
        if (!isCurrent()) { outcome = 'stale'; return; }
        const owned = roundRequest.result?.value as ReviewRound | undefined;
        if (!owned || owned.id !== round.id || owned.baselineDigest !== round.baselineDigest || owned.ownerDocumentId !== before.id) return;
        const previous = receiptRequest.result?.value as ReviewReturnReceipt | undefined;
        if (previous) {
          if (previous.returnId === receipt.returnId && previous.returnDigest === receipt.returnDigest
            && previous.documentId === before.id && previous.roundId === round.id && previous.baselineDigest === round.baselineDigest) {
            outcome = sameReviewStoredValue(documentRequest.result, after) ? 'already-committed' : 'already-imported';
          }
          return;
        }
        const current = documentRequest.result as StoredDocument | undefined;
        if (!current) { outcome = 'missing-document'; return; }
        if (!sameReviewStoredValue(current, before)) return;
        try {
          documents.put(after);
          app.put({ key: reviewReturnKey(round.id, receipt.returnId), value: receipt });
          outcome = 'committed';
        } catch { transaction.abort(); }
      };
      documentRequest.onsuccess = ready;roundRequest.onsuccess = ready;receiptRequest.onsuccess = ready;
      transaction.oncomplete = () => resolve(outcome);
      transaction.onerror = () => reject(transaction.error ?? new Error('Review feedback could not be saved.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Review feedback save aborted.'));
    });
  } catch { return 'failed'; }
}

/** A replacement, its review state and its write receipt form one source-bound transaction. */
export async function idbApplyReviewSuggestions(inputBefore: StoredDocument, inputAfter: StoredDocument,
  input: ReviewSuggestionWrite, isCurrent: () => boolean = () => true): Promise<ReviewReturnWriteOutcome> {
  try {
    const { planReviewSuggestionWrite, isReviewSuggestionMetadataChange, reviewSuggestionWriteReceipt, reviewSuggestionWriteSchema, reviewSuggestionRecordSchema,
      reviewSuggestionReceiptSchema } = await import('./reviewSuggestionWrites');
    const before = structuredClone(inputBefore), after = structuredClone(inputAfter);
    const operation = reviewSuggestionWriteSchema.parse(input), receipt = await reviewSuggestionWriteReceipt(operation);
    if (!isCurrent()) return 'stale';
    if (before.id !== after.id || before.meta.id !== before.id || after.meta.id !== before.id || operation.documentId !== before.id
      || !supportsReviewComments(before.session) || !supportsReviewComments(after.session)) return 'conflict';
    if (!isReviewSuggestionMetadataChange(before.meta, after.meta, operation)) return 'conflict';
    const db = await openDb();
    return await new Promise<ReviewReturnWriteOutcome>((resolve, reject) => {
      const transaction = db.transaction([DOCS_STORE, APP_STORE], 'readwrite');
      const documents = transaction.objectStore(DOCS_STORE), app = transaction.objectStore(APP_STORE);
      const documentRequest = documents.get(before.id), roundRequest = app.get(reviewRoundKey(operation.round.id));
      const stateRequest = app.get(reviewSuggestionKey(before.id, operation.round.id));
      const receiptRequest = app.get(reviewSuggestionReceiptKey(operation.id)), copyRequest = app.get(reviewCopyKey(before.id));
      const incomingReceipt = operation.intent.kind === 'import' ? operation.intent.receipt : null;
      const incomingRequest = incomingReceipt ? app.get(reviewReturnKey(incomingReceipt.roundId, incomingReceipt.returnId)) : null;
      let remaining = incomingRequest ? 6 : 5, outcome: ReviewReturnWriteOutcome = 'conflict';
      const ready = () => {
        if (--remaining) return;
        if (!isCurrent()) { outcome = 'stale'; return; }
        try {
          const round = parseReviewRound(roundRequest.result?.value);
          if (round.id !== operation.round.id || round.baselineDigest !== operation.round.baselineDigest) return;
          const owner = round.ownerDocumentId === before.id;
          const copy = reviewCopyLinkSchema.safeParse(copyRequest.result?.value);
          if (!owner && (operation.intent.kind !== 'propose' || !copy.success || copy.data.documentId !== before.id
            || copy.data.roundId !== round.id || copy.data.baselineDigest !== round.baselineDigest)) return;
          const stored = stateRequest.result?.value === undefined ? null : reviewSuggestionRecordSchema.parse(stateRequest.result.value);
          if (stored && stored.documentId !== before.id) return;
          const currentState = stored?.state ?? null;
          const previous = receiptRequest.result?.value === undefined ? null : reviewSuggestionReceiptSchema.parse(receiptRequest.result.value);
          const previousReturn = incomingRequest?.result?.value;
          if (previousReturn && !sameReviewStoredValue(previousReturn, incomingReceipt)) return;
          if (previous) {
            if (sameReviewStoredValue(previous, receipt)) outcome = sameReviewStoredValue(documentRequest.result, after)
              && sameReviewStoredValue(currentState, operation.after) ? 'already-committed' : 'already-imported';
            return;
          }
          if (previousReturn) { outcome = 'already-imported';return; }
          const current = documentRequest.result as StoredDocument | undefined;
          if (!current) { outcome = 'missing-document';return; }
          if (!sameReviewStoredValue(current, before) || !sameReviewStoredValue(currentState, operation.before)) return;
          const planned = planReviewSuggestionWrite(round, before.session, operation, after.session);
          if (!sameReviewStoredValue(planned.session, after.session) || !sameReviewStoredValue(planned.state, operation.after)) return;
          documents.put(after);
          app.put({ key: reviewSuggestionKey(before.id, round.id), value: { documentId: before.id, state: operation.after } });
          app.put({ key: reviewSuggestionReceiptKey(operation.id), value: receipt });
          if (incomingReceipt) app.put({ key: reviewReturnKey(incomingReceipt.roundId, incomingReceipt.returnId), value: incomingReceipt });
          outcome = 'committed';
        } catch { transaction.abort(); }
      };
      documentRequest.onsuccess = ready;roundRequest.onsuccess = ready;stateRequest.onsuccess = ready;
      receiptRequest.onsuccess = ready;copyRequest.onsuccess = ready;
      if (incomingRequest) incomingRequest.onsuccess = ready;
      transaction.oncomplete = () => resolve(outcome);
      transaction.onerror = () => reject(transaction.error ?? new Error('Review suggestions could not be saved.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Review suggestion save aborted.'));
    });
  } catch { return 'failed'; }
}

/** Restore review side records only with the exact saved source revision; never replace local decisions. */
export async function idbRestoreReviewSuggestions(input: unknown[], inputReceipts: unknown[], expected: StoredDocument[]): Promise<boolean> {
  try {
    const { reviewSuggestionRecordSchema, reviewSuggestionReceiptSchema } = await import('./reviewSuggestionWrites');
    const { validateReviewSuggestionState } = await import('./reviewSuggestions');
    const records = input.map(value => reviewSuggestionRecordSchema.parse(value));
    const receipts = inputReceipts.map(value => reviewSuggestionReceiptSchema.parse(value));
    if (!records.length && !receipts.length) return true;
    if (new Set(records.map(record => reviewSuggestionKey(record.documentId, record.state.roundId))).size !== records.length
      || new Set(receipts.map(receipt => receipt.writeId)).size !== receipts.length) return false;
    const currentRecords = await idbGetAllDocuments();
    if (currentRecords === null) return false;
    const { materializeSignatureFallbacks } = await import('./signatureCompatibility');
    const portableRecords = await Promise.all(currentRecords.map(async document => JSON.parse(JSON.stringify({ ...document, session: await materializeSignatureFallbacks(document.session) })) as StoredDocument));
    const db = await openDb();
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([APP_STORE, DOCS_STORE], 'readwrite');
      const app = transaction.objectStore(APP_STORE), documents = transaction.objectStore(DOCS_STORE);
      const checks = records.map(record => ({ record, prior: app.get(reviewSuggestionKey(record.documentId, record.state.roundId)),
        round: app.get(reviewRoundKey(record.state.roundId)), copy: app.get(reviewCopyKey(record.documentId)), document: documents.get(record.documentId) }));
      const priorReceipts = receipts.map(receipt => app.get(reviewSuggestionReceiptKey(receipt.writeId)));
      const requests = [...checks.flatMap(check => [check.prior, check.round, check.copy, check.document]), ...priorReceipts];
      let remaining = requests.length, restored = false;
      const ready = () => {
        if (--remaining) return;
        try {
          for (const check of checks) {
            const { record } = check, round = parseReviewRound(check.round.result?.value);
            validateReviewSuggestionState(round, record.state);
            const current = check.document.result as StoredDocument | undefined;
            const snapshot = expected.find(document => document.id === record.documentId);
            const captured = currentRecords.find(document => document.id === record.documentId);
            const portable = portableRecords.find(document => document.id === record.documentId);
            if (!!current !== !!snapshot || current && (!sameReviewStoredValue(current, captured) || !sameReviewStoredValue(portable, snapshot))
              || check.prior.result && !sameReviewStoredValue(check.prior.result.value, record)) return;
            if (current && round.ownerDocumentId !== record.documentId) {
              const copy = reviewCopyLinkSchema.parse(check.copy.result?.value);
              if (copy.documentId !== record.documentId || copy.roundId !== round.id || copy.baselineDigest !== round.baselineDigest
                || record.state.decisions.length) return;
            }
          }
          if (receipts.some((receipt, index) => !records.some(record => record.documentId === receipt.documentId
            && record.state.roundId === receipt.roundId && record.state.baselineDigest === receipt.baselineDigest)
            || priorReceipts[index].result && !sameReviewStoredValue(priorReceipts[index].result.value, receipt))) return;
          checks.forEach(({ record, prior }) => { if (!prior.result) app.put({ key: reviewSuggestionKey(record.documentId, record.state.roundId), value: record }); });
          receipts.forEach((receipt, index) => { if (!priorReceipts[index].result) app.put({ key: reviewSuggestionReceiptKey(receipt.writeId), value: receipt }); });
          restored = true;
        } catch { transaction.abort(); }
      };
      requests.forEach(request => { request.onsuccess = ready; });
      transaction.oncomplete = () => resolve(restored);
      transaction.onerror = () => reject(transaction.error ?? new Error('Suggested edit recovery failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Suggested edit recovery aborted.'));
    });
  } catch { return false; }
}

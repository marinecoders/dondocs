import { idbWriteDocument, type StoredDocument, type DocumentWriteOutcome } from './documentsDb';

export const STORAGE_WAIT_MS = 15_000;

/** Stop waiting without cancelling or duplicating an operation that may still commit. */
export async function waitForStorage<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Storage is not responding. Keep this tab open and retry Save before updating.')), STORAGE_WAIT_MS);
    })]);
  } finally { clearTimeout(timer); }
}

export const WRITE_JOURNAL_KEY = 'dondocs-pending-writes';
export interface PendingDocumentWrite {
  before: StoredDocument | null;
  versions: StoredDocument[];
}

const revisionBrand = Symbol('document-write-revision');
const receiptBrand = Symbol('document-write-receipt');

export interface DocumentWriteRevision {
  readonly [revisionBrand]: true;
  readonly documentId: string;
  readonly sequence: number;
}
export interface DocumentWriteReceipt {
  readonly [receiptBrand]: true;
  readonly revision: DocumentWriteRevision;
  readonly committedAt: number;
}
export type DocumentRevisionStatus =
  | { readonly status: 'committed'; readonly receipt: DocumentWriteReceipt }
  | { readonly status: 'pending' | 'superseded' | 'cancelled' | 'failed' | 'conflict' | 'missing-document' };

/** Serializes each document's writes and retains unacknowledged content. */
export class DocumentWrites {
  private pending = new Map<string, PendingDocumentWrite>();
  private running = new Map<string, Promise<void>>();
  private failures = new Map<string, DocumentWriteOutcome>();

  private sequence = 0;
  private revisions = new WeakMap<StoredDocument, DocumentWriteRevision>();
  private states = new WeakMap<DocumentWriteRevision, DocumentRevisionStatus>();
  private receipts = new WeakMap<DocumentWriteReceipt, string>();
  private committed = new Map<string, DocumentWriteReceipt>();

  /** Only tokens issued by this queue can identify a revision or acknowledge it. */
  status(revision: DocumentWriteRevision): DocumentRevisionStatus | null {
    return this.states.get(revision) ?? null;
  }
  latestReceipt(id: string): DocumentWriteReceipt | undefined { return this.committed.get(id); }
  matches(receipt: DocumentWriteReceipt | undefined, document: StoredDocument): boolean {
    return !!receipt && this.receipts.get(receipt) === JSON.stringify(document);
  }
  private setStatus(document: StoredDocument, status: DocumentRevisionStatus): void {
    this.states.set(this.revisions.get(document)!, Object.freeze(status));
  }

  private journalAvailable = true;
  recoveryAvailable(): boolean { return this.journalAvailable; }

  private write: typeof idbWriteDocument;
  private changed: (id: string, saved?: StoredDocument, receipt?: DocumentWriteReceipt) => void;
  constructor(write = idbWriteDocument, changed: (id: string, saved?: StoredDocument, receipt?: DocumentWriteReceipt) => void = () => {}) {
    this.write = write;
    this.changed = changed;
  }

  has(id: string): boolean { return this.pending.has(id); }
  failure(id: string): DocumentWriteOutcome | undefined { return this.failures.get(id); }

  latest(): StoredDocument[] { return [...this.pending.values()].map(item => structuredClone(item.versions.at(-1)!)); }

  enqueue(before: StoredDocument | null, after: StoredDocument): DocumentWriteRevision {
    // Own the snapshot: later mutations by a caller cannot change a queued
    // transaction, its recovery journal, or what its receipt acknowledges.
    const owned = structuredClone(after);
    const pending = this.pending.get(owned.id);
    const latest = pending?.versions.at(-1);
    let revision: DocumentWriteRevision;
    if (latest && JSON.stringify(latest) === JSON.stringify(owned)) {
      revision = this.revisions.get(latest)!;
    } else {
      revision = Object.freeze({ [revisionBrand]: true as const, documentId: owned.id, sequence: ++this.sequence });
      this.revisions.set(owned, revision);
      this.setStatus(owned, { status: 'pending' });
      if (pending) {
        // Preserve the transaction in progress and the newest queued edit.
        if (pending.versions.length > 1) {
          this.setStatus(pending.versions[1], { status: 'superseded' });
          pending.versions[1] = owned;
        } else pending.versions.push(owned);
      } else this.pending.set(owned.id, { before: before ? structuredClone(before) : null, versions: [owned] });
    }
    this.persistJournal();
    this.changed(owned.id);
    this.retry(owned.id);
    return revision;
  }

  retry(id: string): void {
    if (!this.pending.has(id) || this.running.has(id)) return;
    this.failures.delete(id);
    this.setStatus(this.pending.get(id)!.versions[0], { status: 'pending' });
    this.changed(id);
    const task = this.drain(id).finally(() => {
      this.running.delete(id);
      if (this.pending.has(id) && !this.failures.has(id)) this.retry(id);
    });
    this.running.set(id, task);
  }

  private async drain(id: string): Promise<void> {
    while (this.pending.has(id)) {
      const pending = this.pending.get(id)!;
      const next = pending.versions[0];
      let outcome: DocumentWriteOutcome;
      const watchdog = setTimeout(() => {
        if (this.pending.get(id) !== pending) return;
        this.failures.set(id, 'failed');
        this.setStatus(next, { status: 'failed' });
        this.changed(id);
      }, STORAGE_WAIT_MS);
      try { outcome = await this.write(pending.before, next); }
      catch { outcome = 'failed'; }
      finally { clearTimeout(watchdog); }
      // Deletion cancels queued edits. Its database delete follows the in-flight transaction.
      if (this.pending.get(id) !== pending) return;
      if (outcome !== 'committed' && outcome !== 'already-committed') {
        this.failures.set(id, outcome);
        this.setStatus(next, { status: outcome });
        this.changed(id);
        return;
      }
      this.failures.delete(id);
      const receipt: DocumentWriteReceipt = Object.freeze({
        [receiptBrand]: true as const, revision: this.revisions.get(next)!, committedAt: Date.now(),
      });
      this.receipts.set(receipt, JSON.stringify(next));
      this.committed.set(id, receipt);
      this.setStatus(next, { status: 'committed', receipt });
      pending.before = next;
      pending.versions.shift();
      if (!pending.versions.length) this.pending.delete(id);
      this.persistJournal();
      this.changed(id, structuredClone(next), receipt);
    }
  }

  cancel(id: string): void {
    for (const document of this.pending.get(id)?.versions ?? []) this.setStatus(document, { status: 'cancelled' });
    this.committed.delete(id);
    this.pending.delete(id);
    this.failures.delete(id);
    this.persistJournal();
  }

  async flush(id?: string): Promise<boolean> {
    for (const documentId of id === undefined ? this.pending.keys() : [id]) this.retry(documentId);
    const running = id === undefined ? [...this.running.values()] : [this.running.get(id)];
    try { await waitForStorage(Promise.all(running)); }
    catch { return false; }
    return id === undefined ? this.pending.size === 0 : !this.pending.has(id);
  }

  private persistJournal(): void {
    try {
      if (this.pending.size) sessionStorage.setItem(WRITE_JOURNAL_KEY, JSON.stringify([...this.pending.values()]));
      else sessionStorage.removeItem(WRITE_JOURNAL_KEY);
      this.journalAvailable = true;
    } catch {
      // Continue the durable write, but expose the loss of reload recovery.
      this.journalAvailable = false;
    }
  }
}

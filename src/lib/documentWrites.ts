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

/** Serializes each document's writes and retains unacknowledged content. */
export class DocumentWrites {
  private pending = new Map<string, PendingDocumentWrite>();
  private running = new Map<string, Promise<void>>();
  private failures = new Map<string, DocumentWriteOutcome>();

  private journalAvailable = true;
  recoveryAvailable(): boolean { return this.journalAvailable; }

  private write: typeof idbWriteDocument;
  private changed: (id: string, saved?: StoredDocument) => void;
  constructor(write = idbWriteDocument, changed: (id: string, saved?: StoredDocument) => void = () => {}) {
    this.write = write;
    this.changed = changed;
  }

  has(id: string): boolean { return this.pending.has(id); }
  failure(id: string): DocumentWriteOutcome | undefined { return this.failures.get(id); }

  latest(): StoredDocument[] { return [...this.pending.values()].map(item => item.versions.at(-1)!); }

  enqueue(before: StoredDocument | null, after: StoredDocument): void {
    const pending = this.pending.get(after.id);
    if (pending) {
      if (JSON.stringify(pending.versions.at(-1)) !== JSON.stringify(after)) {
        // Keep the in-flight version and the newest edit; intermediate queued
        // snapshots have never reached the database and need not be retained.
        if (pending.versions.length > 1) pending.versions[1] = after;
        else pending.versions.push(after);
      }
    } else {
      this.pending.set(after.id, { before, versions: [after] });
    }
    this.persistJournal();
    this.changed(after.id);
    this.retry(after.id);
  }

  retry(id: string): void {
    if (!this.pending.has(id) || this.running.has(id)) return;
    this.failures.delete(id);
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
        this.changed(id);
      }, STORAGE_WAIT_MS);
      try { outcome = await this.write(pending.before, next); }
      catch { outcome = 'failed'; }
      finally { clearTimeout(watchdog); }
      // Deletion cancels queued edits. Its database delete follows the in-flight transaction.
      if (this.pending.get(id) !== pending) return;
      if (outcome !== 'committed' && outcome !== 'already-committed') {
        this.failures.set(id, outcome);
        this.changed(id);
        return;
      }
      this.failures.delete(id);
      pending.before = next;
      pending.versions.shift();
      if (!pending.versions.length) this.pending.delete(id);
      this.persistJournal();
      this.changed(id, next);
    }
  }

  cancel(id: string): void {
    this.pending.delete(id);
    this.failures.delete(id);
    this.persistJournal();
  }

  async flush(): Promise<boolean> {
    for (const id of this.pending.keys()) this.retry(id);
    try { await waitForStorage(Promise.all([...this.running.values()])); }
    catch { return false; }
    return this.pending.size === 0;
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

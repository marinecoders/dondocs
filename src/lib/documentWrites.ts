import { idbApplyReviewReturn, idbApplyReviewSuggestions, idbWriteDocument, type StoredDocument, type DocumentWriteOutcome } from './documentsDb';
import { reviewReturnWriteSchema, type ReviewReturnWrite } from './reviewReturns';
import { reviewSuggestionWriteSchema, type ReviewSuggestionWrite } from './reviewSuggestionWrites';

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
export type ReviewWrite = ReviewReturnWrite | ReviewSuggestionWrite;
export interface PendingDocumentWrite {
  before: StoredDocument | null;
  versions: StoredDocument[];
  reviewReturns?: Array<{ index: number; operation: ReviewWrite }>;
}

/** Older clients reject the nested review journal instead of dropping its receipt semantics. */
export function serializeDocumentWriteJournal(items: PendingDocumentWrite[]): string {
  return JSON.stringify(items.map(item => {
    const { reviewReturns, ...ordinary } = item;
    return reviewReturns?.length ? { kind: 'dondocs-review-write', version: reviewReturns.some(marker => marker.operation.kind === 'suggestion-write') ? 2 : 1, pending: item } : ordinary;
  }));
}

export function parseDocumentWriteJournal(value: unknown): PendingDocumentWrite[] {
  if (!Array.isArray(value)) throw new Error('Invalid document write journal.');
  return value.map(raw => {
    const wrapped = raw?.kind === 'dondocs-review-write';
    if (wrapped && (![1, 2].includes(raw.version) || Object.keys(raw).some(key => !['kind', 'version', 'pending'].includes(key)))) throw new Error('Unsupported review write journal.');
    const item = wrapped ? raw.pending : raw;
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['before', 'versions', ...(wrapped ? ['reviewReturns'] : [])].includes(key))
      || !Array.isArray(item.versions) || !item.versions.length) throw new Error('Invalid document write journal.');
    const id = item.versions[0]?.id;
    if (typeof id !== 'string' || !id || item.versions.some((version: StoredDocument) => version?.id !== id || version.meta?.id !== id || !version.session)
      || item.before !== null && (item.before?.id !== id || item.before.meta?.id !== id || !item.before.session)) throw new Error('Invalid queued document identity.');
    const result: PendingDocumentWrite = structuredClone(item);
    if (wrapped) {
      if (!item.before || !Array.isArray(item.reviewReturns) || !item.reviewReturns.length) throw new Error('Invalid review write markers.');
      const indices = new Set<number>();
      result.reviewReturns = item.reviewReturns.map((marker: { index: number; operation: unknown }) => {
        if (!marker || Object.keys(marker).some(key => !['index', 'operation'].includes(key))
          || !Number.isSafeInteger(marker.index) || marker.index < 0 || marker.index >= item.versions.length || indices.has(marker.index)) throw new Error('Invalid review write marker index.');
        indices.add(marker.index);
        const suggestion = !!marker.operation && typeof marker.operation === 'object' && 'kind' in marker.operation && marker.operation.kind === 'suggestion-write';
        if (suggestion && raw.version !== 2) throw new Error('Suggestion writes require review journal version 2.');
        const operation = suggestion ? reviewSuggestionWriteSchema.parse(marker.operation) : reviewReturnWriteSchema.parse(marker.operation);
        if ((operation.kind === 'suggestion-write' ? operation.documentId : operation.receipt.documentId) !== id) throw new Error('A review marker targets another document.');
        return { index: marker.index, operation };
      });
      if (raw.version === 2 && !result.reviewReturns?.some(marker => marker.operation.kind === 'suggestion-write')) throw new Error('Review journal version 2 requires a suggestion write.');
    }
    return result;
  });
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
  private sourcePayloads = new WeakMap<StoredDocument, string>();

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
  private prepare?: (document: StoredDocument) => Promise<StoredDocument> | undefined;
  private writeReview: typeof idbApplyReviewReturn;
  private writeSuggestions: typeof idbApplyReviewSuggestions;
  constructor(write = idbWriteDocument, changed: (id: string, saved?: StoredDocument, receipt?: DocumentWriteReceipt) => void = () => {}, prepare?: (document: StoredDocument) => Promise<StoredDocument> | undefined, writeReview: typeof idbApplyReviewReturn = (...args) => idbApplyReviewReturn(...args), writeSuggestions: typeof idbApplyReviewSuggestions = (...args) => idbApplyReviewSuggestions(...args)) {
    this.write = write;
    this.changed = changed;
    this.prepare = prepare;
    this.writeReview = writeReview;
    this.writeSuggestions = writeSuggestions;
  }

  has(id: string): boolean { return this.pending.has(id); }
  /** Verification of an unchanged record does not create edits to recover. */
  hasChanges(id: string): boolean {
    const pending = this.pending.get(id);
    const source = (document: StoredDocument | null) => document && this.sourcePayloads.get(document) || JSON.stringify(document);
    return !!pending && (!!pending.reviewReturns?.length || pending.versions.some(document => source(document) !== source(pending.before)));
  }
  failure(id: string): DocumentWriteOutcome | undefined { return this.failures.get(id); }

  latest(): StoredDocument[] { return [...this.pending.values()].map(item => structuredClone(item.versions.at(-1)!)); }

  hasReviewReturns(): boolean { return [...this.pending.values()].some(item => item.reviewReturns?.length); }
  reviewReturnDocumentIds(): string[] { return [...this.pending].filter(([, item]) => item.reviewReturns?.length).map(([id]) => id); }

  enqueue(before: StoredDocument | null, after: StoredDocument): DocumentWriteRevision {
    return this.enqueueVersion(before, after);
  }

  enqueueReviewReturn(before: StoredDocument, after: StoredDocument, input: ReviewReturnWrite): DocumentWriteRevision {
    const operation = reviewReturnWriteSchema.parse(input);
    if (before.id !== after.id || operation.receipt.documentId !== after.id) throw new Error('The return targets another document.');
    return this.enqueueVersion(before, after, operation);
  }

  enqueueReviewSuggestions(before: StoredDocument, after: StoredDocument, input: ReviewSuggestionWrite): DocumentWriteRevision {
    const operation = reviewSuggestionWriteSchema.parse(input);
    if (before.id !== after.id || operation.documentId !== after.id) throw new Error('A suggestion write requires its own source document.');
    return this.enqueueVersion(before, after, operation);
  }

  private enqueueVersion(before: StoredDocument | null, after: StoredDocument, operation?: ReviewWrite): DocumentWriteRevision {
    // Own the snapshot: later mutations by a caller cannot change a queued
    // transaction, its recovery journal, or what its receipt acknowledges.
    const owned = structuredClone(after);
    const pending = this.pending.get(owned.id);
    const latest = pending?.versions.at(-1);
    let revision: DocumentWriteRevision;
    if (!operation && latest && JSON.stringify(latest) === JSON.stringify(owned)) {
      revision = this.revisions.get(latest)!;
    } else {
      revision = Object.freeze({ [revisionBrand]: true as const, documentId: owned.id, sequence: ++this.sequence });
      this.revisions.set(owned, revision);
      this.sourcePayloads.set(owned, JSON.stringify(owned));
      this.setStatus(owned, { status: 'pending' });
      if (pending) {
        // Preserve the transaction in progress and the newest queued edit.
        const last = pending.versions.length - 1;
        if (!operation && last > 0 && !pending.reviewReturns?.some(marker => marker.index === last)) {
          this.setStatus(pending.versions[last], { status: 'superseded' });
          pending.versions[last] = owned;
        } else pending.versions.push(owned);
        if (operation) (pending.reviewReturns ??= []).push({ index: pending.versions.length - 1, operation });
      } else this.pending.set(owned.id, { before: before ? structuredClone(before) : null, versions: [owned],
        ...(operation ? { reviewReturns: [{ index: 0, operation }] } : {}) });
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
      try {
        const preparation = this.prepare?.(structuredClone(next));
        if (preparation) {
          const prepared = await preparation;
          if (this.pending.get(id) !== pending) return;
          if (prepared.id !== next.id || JSON.stringify(prepared.meta) !== JSON.stringify(next.meta)) throw new Error('Write preparation changed document identity.');
          next.session = structuredClone(prepared.session);
          this.persistJournal();
        }
        const review = pending.reviewReturns?.find(marker => marker.index === 0)?.operation;
        if (review) {
          if (!pending.before) throw new Error('A review return requires a saved owner document.');
          const result = review.kind === 'suggestion-write' ? await this.writeSuggestions(pending.before, next, review)
            : await this.writeReview(pending.before, next, review.round, review.receipt);
          outcome = result === 'already-imported' || result === 'stale' ? 'conflict' : result;
        } else outcome = await this.write(pending.before, next);
      }
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
      pending.reviewReturns = pending.reviewReturns?.filter(marker => marker.index > 0).map(marker => ({ ...marker, index: marker.index - 1 }));
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
    const settle = async (): Promise<boolean> => {
      for (;;) {
        // Keep cancelled writers for serialization, but wait only for revisions
        // still owned by the queue, including successors of a cancelled writer.
        const ids = id === undefined ? [...this.pending.keys()] : this.pending.has(id) ? [id] : [];
        if (!ids.length) return true;
        await Promise.all(ids.map(documentId => this.running.get(documentId)));
        const remaining = id === undefined ? [...this.pending.keys()] : this.pending.has(id) ? [id] : [];
        if (remaining.some(documentId => this.failures.has(documentId))) return false;
      }
    };
    try { return await waitForStorage(settle()); }
    catch { return false; }
  }

  private persistJournal(): void {
    try {
      const edits = [...this.pending.entries()].filter(([id]) => this.hasChanges(id)).map(([, pending]) => pending);
      if (edits.length) sessionStorage.setItem(WRITE_JOURNAL_KEY, serializeDocumentWriteJournal(edits));
      else sessionStorage.removeItem(WRITE_JOURNAL_KEY);
      this.journalAvailable = true;
    } catch {
      // Continue the durable write, but expose the loss of reload recovery.
      this.journalAvailable = false;
    }
  }
}

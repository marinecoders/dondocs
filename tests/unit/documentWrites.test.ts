import { expect, it, vi, beforeEach } from 'vitest';
import { DocumentWrites, WRITE_JOURNAL_KEY } from '@/lib/documentWrites';
import type { StoredDocument, DocumentWriteOutcome } from '@/lib/documentsDb';
const doc = (title: string, id = 'a') => ({ id, meta: { id, title, updatedAt: 1, docType: 'naval_letter' }, session: { formData: { subject: title } } }) as StoredDocument;
beforeEach(() => sessionStorage.clear());
it('keeps both pending versions and acknowledges each separately', async () => {
  const complete: Array<(result: DocumentWriteOutcome) => void> = [];
  const write = vi.fn(() => new Promise<DocumentWriteOutcome>(resolve => complete.push(resolve)));
  const changed = vi.fn();
  const queue = new DocumentWrites(write, changed);
  queue.enqueue(doc('base'), doc('one'));
  queue.enqueue(doc('one'), doc('two'));
  expect(write).toHaveBeenCalledTimes(1);
  expect(JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!)[0].versions).toHaveLength(2);
  complete[0]('committed');
  await Promise.resolve();
  expect(queue.has('a')).toBe(true);
  expect(write).toHaveBeenLastCalledWith(doc('one'), doc('two'));
  complete[1]('committed');
  expect(await queue.flush()).toBe(true);
  expect(queue.has('a')).toBe(false);
  expect(sessionStorage.getItem(WRITE_JOURNAL_KEY)).toBeNull();
});
it('retains failed writes and retries without a new edit', async () => {
  const write = vi.fn().mockResolvedValueOnce('failed').mockResolvedValueOnce('committed');
  const queue = new DocumentWrites(write);
  queue.enqueue(doc('base'), doc('edit'));
  expect(await queue.flush()).toBe(false);
  expect(queue.failure('a')).toBe('failed');
  expect(sessionStorage.getItem(WRITE_JOURNAL_KEY)).not.toBeNull();
  expect(await queue.flush()).toBe(true);
  expect(write).toHaveBeenCalledTimes(2);
});
it('cancels queued edits on deletion without resurrecting them', async () => {
  let finish!: (result: DocumentWriteOutcome) => void;
  const write = vi.fn(() => new Promise<DocumentWriteOutcome>(resolve => { finish = resolve; }));
  const queue = new DocumentWrites(write);
  queue.enqueue(doc('base'), doc('one'));
  queue.enqueue(doc('one'), doc('two'));
  queue.cancel('a');
  finish('committed');
  expect(await queue.flush()).toBe(true);
  expect(write).toHaveBeenCalledTimes(1);
});
it('keeps independent pending documents in the recovery journal', async () => {
  const write = vi.fn().mockResolvedValue('failed');
  const queue = new DocumentWrites(write);
  queue.enqueue(null, doc('one', 'a'));
  queue.enqueue(null, doc('two', 'b'));
  await queue.flush();
  expect(JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!)).toHaveLength(2);
});
it('bounds queued snapshots while keeping the in-flight and newest versions', async () => {
  let finish!: (result: DocumentWriteOutcome) => void;
  const write = vi.fn().mockImplementationOnce(() => new Promise<DocumentWriteOutcome>(resolve => { finish = resolve; })).mockResolvedValue('committed');
  const queue = new DocumentWrites(write);
  queue.enqueue(doc('base'), doc('first'));
  for (let i = 0; i < 100; i++) queue.enqueue(doc('first'), doc(`edit ${i}`));
  const journal = JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!);
  expect(journal[0].versions.map((item: StoredDocument) => item.meta.title)).toEqual(['first', 'edit 99']);
  finish('committed');
  expect(await queue.flush()).toBe(true);
  expect(write).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenLastCalledWith(doc('first'), doc('edit 99'));
});
it('reports stalled writes without starting an overlapping retry, then accepts a late commit', async () => {
  vi.useFakeTimers();
  try {
    let finish!: (outcome: DocumentWriteOutcome) => void;
    const write = vi.fn(() => new Promise<DocumentWriteOutcome>(resolve => { finish = resolve; }));
    const queue = new DocumentWrites(write);
    queue.enqueue(doc('base'), doc('late'));
    const waiting = queue.flush();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await waiting).toBe(false);
    expect(queue.failure('a')).toBe('failed');
    queue.retry('a');
    expect(write).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(WRITE_JOURNAL_KEY)).toContain('late');
    finish('committed');
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.failure('a')).toBeUndefined();
    expect(await queue.flush()).toBe(true);
  } finally { vi.useRealTimers(); }
});
it('exposes unavailable reload recovery while retaining a failed durable write', async () => {
  const storage = sessionStorage;
  vi.stubGlobal('sessionStorage', { setItem: () => { throw new DOMException('full', 'QuotaExceededError'); }, removeItem: storage.removeItem.bind(storage) });
  try {
    const write = vi.fn().mockResolvedValueOnce('failed').mockResolvedValueOnce('committed');
    const queue = new DocumentWrites(write);
    queue.enqueue(doc('base'), doc('unprotected'));
    expect(queue.recoveryAvailable()).toBe(false);
    expect(await queue.flush()).toBe(false);
    expect(queue.latest()[0].meta.title).toBe('unprotected');
    vi.stubGlobal('sessionStorage', storage);
    expect(await queue.flush()).toBe(true);
    expect(queue.recoveryAvailable()).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});
it('does not resurrect a deleted document when a late write completes', async () => {
  let finish!: (outcome: DocumentWriteOutcome) => void;
  const write = vi.fn(() => new Promise<DocumentWriteOutcome>(resolve => { finish = resolve; }));
  const changed = vi.fn();
  const queue = new DocumentWrites(write, changed);
  queue.enqueue(doc('base'), doc('deleted'));
  queue.cancel('a');
  changed.mockClear();
  finish('committed');
  await queue.flush();
  expect(changed).not.toHaveBeenCalled();
  expect(queue.latest()).toEqual([]);
});
it('owns queued snapshots and acknowledges only the revision actually committed', async () => {
  let finish!: (outcome: DocumentWriteOutcome) => void;
  const write = vi.fn(() => new Promise<DocumentWriteOutcome>(resolve => { finish = resolve; }));
  const queue = new DocumentWrites(write);
  const original = doc('owned'); const expected = structuredClone(original);
  const revision = queue.enqueue(null, original);
  original.meta.title = 'mutated';
  expect(write).toHaveBeenCalledWith(null, expected);
  expect(queue.latestReceipt('a')).toBeUndefined();
  finish('committed'); await queue.flush();
  const receipt = queue.latestReceipt('a')!;
  expect(queue.status(revision)).toEqual({ status: 'committed', receipt });
  expect(receipt.revision).toBe(revision);
  expect(queue.matches(receipt, expected)).toBe(true);
  expect(queue.matches(receipt, original)).toBe(false);
  expect(queue.matches({ ...receipt }, expected)).toBe(false);
  expect(queue.status({ ...revision })).toBeNull();
  expect(Object.isFrozen(receipt)).toBe(true);
});
it('identifies coalesced, cancelled, and failed revisions without issuing false receipts', async () => {
  let finish!: (outcome: DocumentWriteOutcome) => void;
  const queue = new DocumentWrites(() => new Promise<DocumentWriteOutcome>(resolve => { finish = resolve; }));
  const first = queue.enqueue(null, doc('first'));
  const skipped = queue.enqueue(null, doc('skipped'));
  const last = queue.enqueue(null, doc('last'));
  expect(queue.enqueue(null, doc('last'))).toBe(last);
  expect(queue.status(skipped)).toEqual({ status: 'superseded' });
  finish('conflict'); await queue.flush();
  expect(queue.status(first)).toEqual({ status: 'conflict' });
  expect(queue.latestReceipt('a')).toBeUndefined();
  queue.cancel('a');
  expect(queue.status(first)).toEqual({ status: 'cancelled' });
  expect(queue.status(last)).toEqual({ status: 'cancelled' });
});
it('retains revision identity across a failed write and successful retry', async () => {
  const queue = new DocumentWrites(vi.fn().mockResolvedValueOnce('failed').mockResolvedValueOnce('already-committed'));
  const revision = queue.enqueue(null, doc('retry'));
  expect(await queue.flush()).toBe(false);
  expect(queue.status(revision)).toEqual({ status: 'failed' });
  expect(await queue.flush()).toBe(true);
  expect(queue.latestReceipt('a')?.revision).toBe(revision);
});

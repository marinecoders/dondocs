import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentWrites, parseDocumentWriteJournal, WRITE_JOURNAL_KEY } from '@/lib/documentWrites';
import { createBlankSession } from '@/stores/documentStore';
import type { StoredDocument, ReviewReturnWriteOutcome } from '@/lib/documentsDb';
import type { ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import { createReviewSuggestion, emptyReviewSuggestionState } from '@/lib/reviewSuggestions';
import type { ReviewRound } from '@/lib/reviewRounds';

function fixture() {
  const session = createBlankSession();session.timestamp = 1;session.formData.subject = 'Original';
  const document: StoredDocument = { id: 'owner', meta: { id: 'owner', title: 'Draft', docType: 'naval_letter', updatedAt: 1 }, session };
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 1,
    label: 'Review', sourceDocumentId: 'owner', ownerDocumentId: 'owner', baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session } };
  const proposal = createReviewSuggestion(round, { author: 'Example', label: 'Subject', changes: [{ target: { kind: 'field', field: 'subject', docType: 'naval_letter' }, proposed: 'Suggested subject' }] });
  const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: 'owner', createdAt: 2,
    round: { id: round.id, baselineDigest: round.baselineDigest }, before: null, after: { ...emptyReviewSuggestionState(round), proposals: [proposal] },
    intent: { kind: 'propose', proposals: [proposal] } };
  return { document, operation };
}
beforeEach(() => sessionStorage.clear());

describe('suggestion fences in the shared document writer', () => {
  it('retains identical-document metadata operations separately and never acknowledges them before storage', async () => {
    const { document, operation } = fixture(), finish: Array<(value: ReviewReturnWriteOutcome) => void> = [];
    const suggestions = vi.fn(() => new Promise<ReviewReturnWriteOutcome>(resolve => finish.push(resolve)));
    const ordinary = vi.fn().mockResolvedValue('committed'), comments = vi.fn();
    const queue = new DocumentWrites(ordinary, () => {}, undefined, comments, suggestions);
    const first = queue.enqueueReviewSuggestions(document, document, operation);
    const second = queue.enqueueReviewSuggestions(document, document, { ...operation, id: `suggestion-write_${crypto.randomUUID()}` });
    expect(first).not.toBe(second);expect(queue.hasChanges('owner')).toBe(true);expect(queue.latestReceipt('owner')).toBeUndefined();
    const raw = JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!);
    expect(raw[0].version).toBe(2);expect(parseDocumentWriteJournal(raw)[0].reviewReturns).toHaveLength(2);
    finish[0]('committed');await vi.waitFor(() => expect(suggestions).toHaveBeenCalledTimes(2));
    expect(queue.status(first)?.status).toBe('committed');expect(queue.status(second)?.status).toBe('pending');
    finish[1]('committed');expect(await queue.flush()).toBe(true);
    expect(ordinary).not.toHaveBeenCalled();expect(comments).not.toHaveBeenCalled();expect(queue.matches(queue.latestReceipt('owner'), document)).toBe(true);
  });

  it('preserves the suggestion companion while coalescing ordinary edits during a held transaction', async () => {
    const { document, operation } = fixture();let finish!: (value: ReviewReturnWriteOutcome) => void;
    const suggestions = vi.fn(() => new Promise<ReviewReturnWriteOutcome>(resolve => { finish = resolve; }));
    const ordinary = vi.fn().mockResolvedValue('committed');
    const queue = new DocumentWrites(ordinary, () => {}, undefined, vi.fn(), suggestions);
    queue.enqueueReviewSuggestions(document, document, operation);
    let latest = document;
    for (let index = 0; index < 20; index++) { latest = structuredClone(document);latest.session.formData.subject = `Newer input ${index}`;queue.enqueue(document, latest); }
    const journal = parseDocumentWriteJournal(JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!))[0];
    expect(journal.versions).toHaveLength(2);expect(journal.reviewReturns?.map(marker => marker.index)).toEqual([0]);
    expect(ordinary).not.toHaveBeenCalled();finish('committed');expect(await queue.flush()).toBe(true);
    expect(ordinary).toHaveBeenCalledExactlyOnceWith(document, latest);
  });

  it('retains failed/previously-applied intents instead of faking a saved document receipt', async () => {
    const { document, operation } = fixture();
    const queue = new DocumentWrites(vi.fn(), () => {}, undefined, vi.fn(), vi.fn().mockResolvedValue('already-imported'));
    const revision = queue.enqueueReviewSuggestions(document, document, operation);
    expect(await queue.flush()).toBe(false);expect(queue.status(revision)?.status).toBe('conflict');
    expect(queue.latestReceipt('owner')).toBeUndefined();expect(parseDocumentWriteJournal(JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!))[0].reviewReturns).toHaveLength(1);
  });

  it('rejects downgraded, cross-document and unknown suggestion journal markers before replay', async () => {
    const { document, operation } = fixture();let finish!: (value: ReviewReturnWriteOutcome) => void;
    const queue = new DocumentWrites(vi.fn(), () => {}, undefined, vi.fn(), () => new Promise(resolve => { finish = resolve; }));
    queue.enqueueReviewSuggestions(document, document, operation);
    const raw = JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!);
    for (const mutate of [
      (value: typeof raw) => { value[0].version = 1; },
      (value: typeof raw) => { value[0].pending.reviewReturns[0].operation.documentId = 'other'; },
      (value: typeof raw) => { value[0].pending.reviewReturns[0].operation.intent.kind = 'arbitrary-write'; },
    ]) { const bad = structuredClone(raw);mutate(bad);expect(() => parseDocumentWriteJournal(bad)).toThrow(); }
    queue.cancel('owner');finish('committed');await Promise.resolve();
  });
});

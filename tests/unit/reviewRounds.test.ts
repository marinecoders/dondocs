import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { canonicalReviewPayload, parseReviewRound, readReviewRound, readReviewCopyLink, reviewCopyEnvelopeSchema, reviewPayloadDigest, type ReviewRound } from '@/lib/reviewRounds';
import { idbAddReviewRound, idbAddSnapshot, idbDeleteDocumentIfUnchanged, idbGetSnapshots, idbGetAllDocuments, idbInstallReviewCopy, idbPutDocument, type StoredDocument } from '@/lib/documentsDb';

function pin(index: number): ReviewRound {
  return { kind: 'dondocs-review-round', version: 1, id: `review_00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    createdAt: 1, label: 'Fictional review', sourceDocumentId: `source-${index}`, ownerDocumentId: `source-${index}`,
    baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session: createBlankSession() } };
}
function document(id: string): StoredDocument {
  return { id, meta: { id, title: 'Synthetic review copy', docType: 'naval_letter', updatedAt: 1 }, session: createBlankSession() };
}

describe('review round pins', () => {
  it('keeps the reviewed snapshot after the history ring advances and its source is deleted', async () => {
    const round = pin(1), source = document(round.sourceDocumentId);
    source.session.formData.subject = 'Original baseline';
    round.baseline.session = structuredClone(source.session);
    expect(await idbPutDocument(source)).toBe(true);
    expect(await idbAddReviewRound(round)).toBe('committed');
    for (let ts = 1; ts <= 13; ts++) await idbAddSnapshot(source.id, { ts, session: { ...source.session, formData: { subject: `Later ${ts}` } } });
    expect((await idbGetSnapshots(source.id)).map(snapshot => snapshot.ts)).not.toContain(1);
    expect(await idbDeleteDocumentIfUnchanged(source)).toBe('deleted');
    expect(await idbGetSnapshots(source.id)).toEqual([]);
    expect((await readReviewRound(round.id))?.baseline.session.formData.subject).toBe('Original baseline');
  });

  it('owns the submitted pin and rejects an overwrite of its baseline', async () => {
    const round = pin(2), saving = idbAddReviewRound(round);
    round.label = 'Changed after submission';
    expect(await saving).toBe('committed');
    expect((await readReviewRound(round.id))?.label).toBe('Fictional review');
    expect(await idbAddReviewRound(round)).toBe('conflict');
  });

  it('installs the received document, pin and reviewer link while withholding local owner authority', async () => {
    const round = pin(3), copy = document('review-copy-3');
    expect(await idbInstallReviewCopy(copy, round, { documentId: copy.id, roundId: round.id, baselineDigest: round.baselineDigest })).toBe(true);
    expect((await readReviewRound(round.id))?.ownerDocumentId).toBeUndefined();
    expect((await readReviewCopyLink(copy.id))?.roundId).toBe(round.id);
    expect((await idbGetAllDocuments())?.find(entry => entry.id === copy.id)).toEqual(copy);
  });

  it('aborts all reviewer-copy records if writing the local association fails', async () => {
    const round = pin(4), copy = document('review-copy-4');
    const original = IDBObjectStore.prototype.put;
    const failing = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if ((value as { key?: string }).key === `review-copy:${copy.id}`) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.call(this, value, key);
    });
    try { expect(await idbInstallReviewCopy(copy, round, { documentId: copy.id, roundId: round.id, baselineDigest: round.baselineDigest })).toBe(false); }
    finally { failing.mockRestore(); }
    expect(await readReviewRound(round.id)).toBeNull();
    expect(await readReviewCopyLink(copy.id)).toBeNull();
    expect((await idbGetAllDocuments())?.some(entry => entry.id === copy.id)).toBe(false);
  });

  it('never downgrades an established local owner when opening its own reviewer copy', async () => {
    const round = pin(5), copy = document('review-copy-5');
    expect(await idbAddReviewRound(round)).toBe('committed');
    expect(await idbInstallReviewCopy(copy, round, { documentId: copy.id, roundId: round.id, baselineDigest: round.baselineDigest })).toBe(true);
    expect((await readReviewRound(round.id))?.ownerDocumentId).toBe(round.sourceDocumentId);
  });

  it('rejects unsupported form baselines and portable owner metadata', () => {
    expect(() => parseReviewRound({ ...pin(6), baseline: { ts: 1, session: createBlankSession('navmc_10274') } })).toThrow();
    const round = pin(7);
    expect(reviewCopyEnvelopeSchema.safeParse({ kind: 'dondocs-review-copy', version: 1, round, draft: {} }).success).toBe(false);
  });

  it('binds the captured payload independently of object insertion order and notices changed bytes', async () => {
    expect(canonicalReviewPayload({ b: 'second', a: { z: 3, c: 2 } })).toBe(canonicalReviewPayload({ a: { c: 2, z: 3 }, b: 'second' }));
    expect(await reviewPayloadDigest({ data: 'QUJD', timestamp: 1 })).not.toBe(await reviewPayloadDigest({ data: 'QUJE', timestamp: 1 }));
  });
});

import { describe, expect, it } from 'vitest';
import { createReviewReturn, parseReviewReturn, reviewReturnDigest } from '@/lib/reviewReturns';

const round = () => `review_${crypto.randomUUID()}`;
const digest = 'a'.repeat(64);

describe('bounded comment-only review return files', () => {
  it('binds comments to a round and exact baseline, with an independent return identity', () => {
    const payload = createReviewReturn(round(), digest, undefined);
    expect(payload.kind).toBe('dondocs-review-return');expect(payload.id).toMatch(/^return_/);
    expect(payload.baselineDigest).toBe(digest);expect(parseReviewReturn(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });
  it('rejects document content, owner authority and unsupported versions instead of silently stripping them', () => {
    const payload = createReviewReturn(round(), digest, undefined);
    for (const extra of [{ session: {} }, { ownerDocumentId: 'local-owner' }, { formData: {} }, { version: 2 }]) {
      expect(() => parseReviewReturn({ ...payload, ...extra })).toThrow();
    }
  });
  it('rejects ambiguous or malformed round and digest identities', () => {
    const payload = createReviewReturn(round(), digest, undefined);
    for (const extra of [{ roundId: 'constructor' }, { baselineDigest: 'short' }, { id: payload.roundId }, { createdAt: Infinity }]) {
      expect(() => parseReviewReturn({ ...payload, ...extra })).toThrow();
    }
  });
  it('includes a full payload digest so changing feedback under the same return ID is detectable', async () => {
    const payload = createReviewReturn(round(), digest, undefined);
    const first = await reviewReturnDigest(payload);
    expect(await reviewReturnDigest({ ...payload })).toBe(first);
    expect(await reviewReturnDigest({ ...payload, createdAt: payload.createdAt + 1 })).not.toBe(first);
  });
  it('validates every incoming comment and unique message ID before any merge', () => {
    const payload = createReviewReturn(round(), digest, undefined);
    const id = crypto.randomUUID();
    expect(() => parseReviewReturn({ ...payload, comments: { version: 1, threads: [{ id, anchor: { kind: 'document' }, resolved: false,
      messages: [{ id, author: 'Example', text: 'Feedback', createdAt: '2026-11-13T00:00:00Z' }] }] } })).toThrow();
  });
});

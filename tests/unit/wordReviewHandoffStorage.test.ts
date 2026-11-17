import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, commitCurrentDocument, flushDocumentWrites, isCurrentDocumentTarget, useDocumentsStore } from '@/stores/documentsStore';
import { buildReviewCopy, startReviewRound, transitionReviewRound } from '@/lib/reviewRoundActions';
import { readReviewRound } from '@/lib/reviewRounds';
import { idbAppendWordHandoff, idbReadReviewRounds, idbRestoreReviewRecords } from '@/lib/documentsDb';
import { buildBackup, restoreBackup } from '@/lib/backup';
import type { WordReviewHandoff } from '@/lib/wordReviewModel';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().updateParagraph(0, { text: 'Exact Word review body' });
});
afterEach(async () => { await flushDocumentWrites();vi.clearAllTimers();vi.useRealTimers(); });
const receipt = (paragraphId: string): WordReviewHandoff => ({ version: 1, id: crypto.randomUUID(), createdAt: Date.now(), docxSha256: 'a'.repeat(64), staticDigest: 'c'.repeat(64),
  blocks: [{ kind: 'paragraph', sourceIndex: 3, paragraphId, prefix: '1. ', plainPrefixLength: 3, beforePlainDigest: 'b'.repeat(64) }] });

describe('local Word review receipt persistence', () => {
  it('commits only an append against the same stored owner round and preserves portable authority boundaries', async () => {
    const round = await startReviewRound('Exact local owner'), item = receipt(round.baseline.session.paragraphs[0].id!);
    const saved = await idbAppendWordHandoff(round, item, () => true);
    expect(saved?.wordHandoffs).toEqual([item]);expect(saved?.baseline).toEqual(round.baseline);
    expect(await idbAppendWordHandoff(round, { ...item, id: crypto.randomUUID() }, () => true)).toBeNull();
    expect((await readReviewRound(round.id))?.wordHandoffs).toEqual([item]);
    expect((await buildReviewCopy(saved!)).round).not.toHaveProperty('wordHandoffs');
    expect((await buildReviewCopy(saved!)).round).not.toHaveProperty('ownerDocumentId');
  });
  it('does not persist cancelled, stale, duplicate or inactive issuance', async () => {
    const round = await startReviewRound('No partial receipt'), item = receipt(round.baseline.session.paragraphs[0].id!);
    expect(await idbAppendWordHandoff(round, item, () => false)).toBeNull();
    const target = captureDocumentTarget()!;useDocumentStore.getState().setField('subject', 'Newer work');
    expect(await idbAppendWordHandoff(round, item, () => isCurrentDocumentTarget(target))).toBeNull();
    const saved = await idbAppendWordHandoff(round, item, () => true);
    expect(await idbAppendWordHandoff(saved!, item, () => true)).toBeNull();
    const closed = await transitionReviewRound(saved!, 'close');
    expect(await idbAppendWordHandoff(closed, { ...item, id: crypto.randomUUID() }, () => true)).toBeNull();
    expect((await readReviewRound(round.id))?.wordHandoffs).toHaveLength(1);
  });
  it('uses a fail-closed backup protocol version and retains the complete local baseline', async () => {
    const round = await startReviewRound('Recoverable Word review'), item = receipt(round.baseline.session.paragraphs[0].id!);
    await idbAppendWordHandoff(round, item, () => true);await commitCurrentDocument();
    const backup = JSON.parse(await buildBackup());
    expect(backup.version).toBe(15);
    expect(backup.reviewRounds.find((value: { id: string }) => value.id === round.id).wordHandoffs).toEqual([item]);
    await expect(restoreBackup(JSON.stringify({ ...backup, version: 14 }))).rejects.toThrow('version 15');
  });
  it('unions full-backup receipts without rolling back local ones or granting public-copy authority', async () => {
    const round = await startReviewRound('Merge owned Word receipts'), first = receipt(round.baseline.session.paragraphs[0].id!);
    const saved = (await idbAppendWordHandoff(round, first, () => true))!, second = { ...first, id: crypto.randomUUID() };
    expect(await idbRestoreReviewRecords([{ ...saved, wordHandoffs: [first, second] }], [])).toBe(true);
    expect((await readReviewRound(round.id))?.wordHandoffs).toEqual([first, second]);
    expect(await idbRestoreReviewRecords([saved], [])).toBe(true);
    expect(await idbRestoreReviewRecords([{ ...round, ownerDocumentId: undefined }], [])).toBe(true);
    expect((await readReviewRound(round.id))?.wordHandoffs).toEqual([first, second]);
    expect((await readReviewRound(round.id))?.ownerDocumentId).toBe(round.ownerDocumentId);
  });
  it('rejects conflicting receipt IDs atomically instead of losing either issued copy', async () => {
    const round = await startReviewRound('Conflicting Word recovery'), first = receipt(round.baseline.session.paragraphs[0].id!);
    const saved = (await idbAppendWordHandoff(round, first, () => true))!, before = await idbReadReviewRounds();
    const additional = { ...round, id: `review_${crypto.randomUUID()}`, ownerDocumentId: undefined };
    expect(await idbRestoreReviewRecords([additional, { ...saved, wordHandoffs: [{ ...first, docxSha256: 'd'.repeat(64) }] }], [])).toBe(false);
    expect(await idbReadReviewRounds()).toEqual(before);
  });
  it('refuses an incoming Word receipt set under another source owner', async () => {
    const round = await startReviewRound('Guard Word recovery owner'), first = receipt(round.baseline.session.paragraphs[0].id!);
    const saved = (await idbAppendWordHandoff(round, first, () => true))!;
    useDocumentsStore.getState().newDocument();await commitCurrentDocument();
    expect(await idbRestoreReviewRecords([{ ...saved, ownerDocumentId: useDocumentsStore.getState().currentId! }], [])).toBe(false);
    expect(await readReviewRound(round.id)).toEqual(saved);
  });
  it('enforces the issued receipt limit when two complete backup histories are combined', async () => {
    const round = await startReviewRound('Bound merged Word receipts'), item = receipt(round.baseline.session.paragraphs[0].id!);
    const receipts = Array.from({ length: 10 }, () => ({ ...item, id: crypto.randomUUID() }));
    expect(await idbRestoreReviewRecords([{ ...round, wordHandoffs: receipts }], [])).toBe(true);
    expect(await idbRestoreReviewRecords([{ ...round, wordHandoffs: [{ ...item, id: crypto.randomUUID() }] }], [])).toBe(false);
    expect((await readReviewRound(round.id))?.wordHandoffs).toEqual(receipts);
  });
});

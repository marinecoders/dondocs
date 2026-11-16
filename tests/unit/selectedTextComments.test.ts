import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore, captureDocumentScope, changeDocumentHistory, recordDocumentHistory, commitCurrentDocument, openSessionAsNew } from '@/stores/documentsStore';
import { applyCommentMutation, reviewCommentMutation } from '@/lib/reviewCommentActions';
import { captureTextRange, resolveTextRange } from '@/lib/reviewTextRanges';
import { reviewCommentsSchema } from '@/lib/reviewComments';
import { parseSavedSession } from '@/lib/savedSession';
import { createSharedPayload, parseSharedSession } from '@/lib/sharedSession';
import { buildDraftFile, parseDraftFile } from '@/lib/draftFile';
import { encryptSharePayload, decryptSharePayload } from '@/lib/shareCrypto';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { documentTextFields } from '@/lib/documentFields';
import { detectTextPII } from '@/services/pii/detector';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { normalizeReturnedRangeComments } from '@/lib/reviewCommentRanges';
import { mergeReturnedComments } from '@/lib/reviewCommentMerge';

const TEXT = 'Before selected words after.';
beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ paragraphs: [{ id: 'first', text: TEXT, level: 0 }, { id: 'second', text: TEXT, level: 0 }] });
});
function pending() {
  const range = captureTextRange(useDocumentStore.getState(), 'second', 7, 21)!;
  return reviewCommentMutation({ kind: 'add', range, author: 'Chief', text: 'Check only these words.' });
}
function add() {
  expect(applyCommentMutation(pending())).toBe('applied');
  return useDocumentStore.getState().reviewComments!.threads.at(-1)!;
}
function currentAnchor() { const anchor = useDocumentStore.getState().reviewComments!.threads[0].anchor; if (anchor.kind !== 'range') throw Error('Expected range'); return anchor; }

describe('selected text comments use the existing discussion writer', () => {
  it('adds/replies/resolves with exact quote, follows moves and outside edits, and undoes/redoes as one document history', () => {
    const thread = add();
    expect(useDocumentStore.getState().reviewComments?.version).toBe(3);
    const scope = captureDocumentScope();
    recordDocumentHistory(scope);
    useDocumentStore.getState().updateParagraph(1, { text: 'New ' + TEXT });
    useDocumentStore.getState().reorderParagraphs(1, 0);
    recordDocumentHistory(scope);
    expect(resolveTextRange(useDocumentStore.getState(), currentAnchor())).toMatchObject({ status: 'current', start: 11, end: 25, text: 'selected words' });
    expect(currentAnchor().context).toBe(TEXT);
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'reply', threadId: thread.id, author: 'Drafter', text: 'Checked the selection.' }))).toBe('applied');
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'resolve', threadId: thread.id, resolved: true }))).toBe('applied');
    expect(changeDocumentHistory('undo', scope)).toBe('applied');
    expect(useDocumentStore.getState().reviewComments!.threads[0].resolved).toBe(false);
    expect(changeDocumentHistory('redo', scope)).toBe('applied');
    expect(useDocumentStore.getState().reviewComments!.threads[0].resolved).toBe(true);
    expect(currentAnchor().context).toBe(TEXT);
  });
  it('permanently detaches edited spans and never matches repeated replacement text', () => {
    add();
    useDocumentStore.getState().updateParagraph(1, { text: 'Before changed words after.' });
    expect(currentAnchor().detached).toBe(true);
    useDocumentStore.getState().updateParagraph(1, { text: TEXT });
    expect(resolveTextRange(useDocumentStore.getState(), currentAnchor()).status).toBe('changed');
    useDocumentStore.getState().removeParagraph(1);
    useDocumentStore.getState().addParagraph(TEXT, 0, 0);
    expect(resolveTextRange(useDocumentStore.getState(), currentAnchor()).status).toBe('unavailable');
  });
  it('rejects wrong-owner, stale, reused and forged requests atomically', () => {
    const stale = pending();
    useDocumentStore.getState().updateParagraph(1, { text: 'New ' + TEXT });
    const before = useDocumentStore.getState().getSnapshot();
    expect(applyCommentMutation(stale)).toBe('stale');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    const owner = pending();
    useDocumentsStore.getState().newDocument();
    expect(applyCommentMutation(owner)).toBe('stale');
    useDocumentStore.setState({ paragraphs: [{ id: 'second', text: TEXT, level: 0 }] });
    const single = pending();
    expect(applyCommentMutation(single)).toBe('applied');
    expect(applyCommentMutation(single)).toBe('stale');
    expect(applyCommentMutation({ ...pending() })).toBe('stale');
    const range = captureTextRange(useDocumentStore.getState(), 'second', 7, 21)!;
    const forged = { ...range, context: 'Fake retained ' + TEXT, start: 21, end: 35, tracking: { context: TEXT, start: 7, end: 21 } };
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', range: forged, author: 'Chief', text: 'Forgery' }))).toBe('invalid');
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', range, paragraphId: 'second', author: 'Chief', text: 'Ambiguous' }))).toBe('invalid');
  });
  it('deliberately reattaches a detached discussion, retains original context and obeys stale/Undo boundaries', () => {
    const thread = add();
    useDocumentStore.getState().updateParagraph(1, { text: 'Before different words after.' });
    const range = captureTextRange(useDocumentStore.getState(), 'first', 7, 21)!;
    const request = reviewCommentMutation({ kind: 'reattach', threadId: thread.id, range });
    expect(applyCommentMutation(request)).toBe('applied');
    expect(useDocumentStore.getState().reviewComments!.threads).toHaveLength(1);
    const attached = useDocumentStore.getState().reviewComments!.threads[0];
    expect(attached.anchor).toEqual(range);
    expect(attached.anchorHistory?.[0].anchor.context).toBe(TEXT);
    expect(attached.messages).toEqual(thread.messages);
    expect(applyCommentMutation(request)).toBe('stale');
    const scope = captureDocumentScope();
    expect(changeDocumentHistory('undo', scope)).toBe('applied');
    expect(currentAnchor().detached).toBe(true);
    expect(useDocumentStore.getState().reviewComments!.threads[0].anchorHistory).toBeUndefined();
    expect(changeDocumentHistory('redo', scope)).toBe('applied');
    expect(currentAnchor()).toEqual(range);
    expect(parseSavedSession(getSerializedSession()).reviewComments!.threads[0].anchorHistory).toEqual(attached.anchorHistory);
    expect(documentTextFields(getSerializedSession(), 'share').some(field => field.path.includes('anchorHistory') && field.text === TEXT)).toBe(true);
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'reattach', threadId: thread.id, range }))).toBe('invalid');
    useDocumentStore.getState().updateParagraph(0, { text: 'Before changed words after.' });
    const fresh = captureTextRange(useDocumentStore.getState(), 'second', 7, 22)!;
    const stale = reviewCommentMutation({ kind: 'reattach', threadId: thread.id, range: fresh });
    useDocumentStore.getState().reorderParagraphs(1, 0);
    expect(applyCommentMutation(stale)).toBe('stale');
    const owner = reviewCommentMutation({ kind: 'reattach', threadId: thread.id, range: fresh });
    useDocumentsStore.getState().newDocument();
    expect(applyCommentMutation(owner)).toBe('stale');
  });
  it('validates format versions, duplicate IDs, malformed boundaries and aggregate limits without publishing', () => {
    const thread = add();
    const comments = useDocumentStore.getState().reviewComments!;
    for (const version of [1, 2, 4]) expect(reviewCommentsSchema.safeParse({ ...comments, version }).success).toBe(false);
    expect(reviewCommentsSchema.safeParse({ ...comments, threads: [thread, thread] }).success).toBe(false);
    expect(reviewCommentsSchema.safeParse({ ...comments, threads: [{ ...thread, anchor: { ...currentAnchor(), start: 0, end: 0 } }] }).success).toBe(false);
    const range = captureTextRange(useDocumentStore.getState(), 'first', 7, 21)!;
    useDocumentStore.setState({ reviewComments: { version: 3, threads: Array.from({ length: 100 }, () => ({ ...thread, id: crypto.randomUUID(), messages: [{ ...thread.messages[0], id: crypto.randomUUID() }] })) } });
    const before = useDocumentStore.getState().getSnapshot();
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', range, author: 'Chief', text: 'Over limit' }))).toBe('invalid');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
  });
  it('detaches when tracking all ranges would exceed the context budget and still reloads valid comments', () => {
    const text = 'Prefix ' + 'a'.repeat(990) + ' End';
    useDocumentStore.setState({ paragraphs: [{ id: 'second', text, level: 0 }] });
    const range = captureTextRange(useDocumentStore.getState(), 'second', 7, 15)!;
    for (let i = 0; i < 100; i++) expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', range, author: 'A', text: 'x' }))).toBe('applied');
    useDocumentStore.getState().updateParagraph(0, { text: 'New prefix ' + text });
    expect(useDocumentStore.getState().reviewComments?.threads.every(thread => thread.anchor.kind === 'range' && thread.anchor.detached)).toBe(true);
    expect(() => parseSavedSession(getSerializedSession())).not.toThrow();
  });
});

describe('range comments survive native persistence and review transport', () => {
  it('roundtrips original and tracked ranges through save, draft, encryption, backup restore and an independent document', async () => {
    add();
    useDocumentStore.getState().updateParagraph(1, { text: 'New ' + TEXT });
    const session = getSerializedSession();
    expect(parseSavedSession(session).reviewComments).toEqual(session.reviewComments);
    expect(parseDraftFile(await buildDraftFile()).session.reviewComments).toEqual(session.reviewComments);
    const shared = createSharedPayload(session);
    expect(parseSharedSession(await decryptSharePayload(await encryptSharePayload(shared, 'synthetic-password'), 'synthetic-password')).reviewComments).toEqual(session.reviewComments);
    await commitCurrentDocument();
    const backup = await buildBackup();
    expect(JSON.parse(backup).documents.some((record: { session: typeof session }) => JSON.stringify(record.session.reviewComments) === JSON.stringify(session.reviewComments))).toBe(true);
    await restoreBackup(backup);
    expect(openSessionAsNew(parseSavedSession(session))).toBe('applied');
    expect(getSerializedSession().reviewComments).toEqual(session.reviewComments);
    expect(resolveTextRange(useDocumentStore.getState(), currentAnchor())).toMatchObject({ status: 'current', text: 'selected words', start: 11 });
  });
  it('includes every retained context in disclosure scans while keeping clean output/substitution/templates free of review metadata', () => {
    useDocumentStore.setState({ paragraphs: [{ id: 'second', text: 'SSN 123-45-6789 selected words after.', level: 0 }] });
    const range = captureTextRange(useDocumentStore.getState(), 'second', 15, 29)!;
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', range, author: 'reviewer@example.com', text: 'Review this quote.' }))).toBe('applied');
    useDocumentStore.getState().updateParagraph(0, { text: 'Call 555-234-5678. ' + range.context });
    useDocumentStore.getState().removeParagraph(0);
    const session = getSerializedSession();
    for (const projection of ['draft', 'share', 'backup', 'search'] as const) {
      const fields = documentTextFields(session, projection).filter(field => field.path[0] === 'reviewComments');
      expect(fields.some(field => field.path.includes('tracking') && field.text.includes('555-234-5678'))).toBe(true);
      expect(detectTextPII(fields.map(field => ({ field: field.label, value: field.text }))).findings.some(finding => finding.type === 'SSN')).toBe(true);
    }
    for (const projection of ['output', 'substitution'] as const) expect(documentTextFields(session, projection).some(field => field.path[0] === 'reviewComments')).toBe(false);
    const id = useUserTemplatesStore.getState().saveTemplate('Synthetic range template', session);
    expect(useUserTemplatesStore.getState().templates[id].session.reviewComments).toBeUndefined();
  });
  it('keeps owner tracking when returning replies, while rejecting deliberate retargeting or altered anchor history', () => {
    add();
    const baseline = structuredClone(useDocumentStore.getState().reviewComments!);
    useDocumentStore.getState().updateParagraph(1, { text: 'New ' + TEXT });
    const owner = useDocumentStore.getState().reviewComments!;
    const returned = structuredClone(baseline);
    if (returned.threads[0].anchor.kind !== 'range') throw Error('Expected range');
    returned.threads[0].anchor.detached = true;
    returned.threads[0].messages.push({ id: crypto.randomUUID(), author: 'Drafter', text: 'Reply from reviewer', createdAt: '2026-11-15T12:00:00Z' });
    const merged = mergeReturnedComments(baseline, owner, returned);
    expect(merged.status).toBe('ready');
    expect(merged.comments!.threads[0].anchor).toEqual(owner.threads[0].anchor);
    expect(merged.comments!.threads[0].messages.at(-1)!.text).toBe('Reply from reviewer');
    const retargeted = structuredClone(returned);
    retargeted.threads[0].anchor = { ...returned.threads[0].anchor, paragraphId: 'first' };
    expect(() => mergeReturnedComments(baseline, owner, retargeted)).toThrow('Keep the incoming return file');
    const changedHistory = structuredClone(returned);
    changedHistory.threads[0].anchorHistory = [{ anchor: { ...returned.threads[0].anchor, context: 'Earlier selected words', start: 8, end: 22 }, reattachedAt: '2026-11-15T12:00:00Z' }];
    expect(() => mergeReturnedComments(baseline, owner, changedHistory)).toThrow('anchor history');
  });
  it('validates new returned ranges against the reviewed baseline and ignores reviewer mappings into newer owner text', () => {
    const baseline = getSerializedSession();
    add();
    const returned = structuredClone(useDocumentStore.getState().reviewComments!);
    const range = currentAnchor();
    if (returned.threads[0].anchor.kind !== 'range') throw Error('Expected range');
    returned.threads[0].anchor.tracking = { context: TEXT + ' ' + TEXT, start: TEXT.length + 8, end: TEXT.length + 22 };
    const honest = normalizeReturnedRangeComments(baseline, baseline, returned)!;
    expect(honest.threads[0].anchor).toEqual(range);
    const owner = { ...baseline, paragraphs: baseline.paragraphs.map(paragraph => ({ ...paragraph, text: TEXT + ' ' + TEXT })) };
    const detached = normalizeReturnedRangeComments(baseline, owner, returned)!;
    expect(detached.threads[0].anchor).toMatchObject({ start: 7, end: 21, detached: true });
    expect(detached.threads[0].anchor).not.toHaveProperty('tracking');
    const forged = structuredClone(returned);
    forged.threads[0].anchor = { ...range, context: 'Fake original selected words', start: 14, end: 28 };
    expect(() => normalizeReturnedRangeComments(baseline, owner, forged)).toThrow('reviewed baseline');
    const forgedHistory = structuredClone(returned);
    forgedHistory.threads[0].anchorHistory = [{ anchor: { ...range, paragraphId: 'foreign' }, reattachedAt: '2026-11-15T12:00:00Z' }];
    expect(() => normalizeReturnedRangeComments(baseline, owner, forgedHistory)).toThrow('anchor history');
  });
  it('reserves deleted range IDs during legacy migration and keeps range threads through return merging', () => {
    const thread = add();
    const comments = useDocumentStore.getState().reviewComments;
    const returned = structuredClone(comments!);
    returned.threads[0].messages.push({ id: crypto.randomUUID(), author: 'Drafter', text: 'Reply', createdAt: '2026-11-15T12:00:00Z' });
    expect(mergeReturnedComments(comments, comments, returned).comments).toEqual(returned);
    const session = { ...getSerializedSession(), paragraphs: [{ text: TEXT, level: 0 }] };
    const parsed = parseSavedSession(session);
    expect(resolveTextRange(parsed, thread.anchor as ReturnType<typeof currentAnchor>).status).toBe('unavailable');
    const malformed = { ...session, reviewComments: { ...comments, version: 2 } };
    expect(() => parseSavedSession(malformed)).toThrow();
    expect(() => parseSharedSession(malformed)).toThrow();
  });
});

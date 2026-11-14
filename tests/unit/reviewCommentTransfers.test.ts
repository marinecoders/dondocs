import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore, openSessionAsNew, commitCurrentDocument } from '@/stores/documentsStore';
import { applyCommentMutation, reviewCommentMutation } from '@/lib/reviewCommentActions';
import { buildDraftFile, parseDraftFile } from '@/lib/draftFile';
import { buildBackup, classifyBackup, restoreBackup, BACKUP_KIND, BACKUP_VERSION } from '@/lib/backup';
import { idbSetSnapshots } from '@/lib/documentsDb';
import { createSharedPayload, parseSharedSession } from '@/lib/sharedSession';
import { encryptSharePayload, decryptSharePayload } from '@/lib/shareCrypto';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
});
function add() { expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', author: 'Chief', text: 'Review note 😀' }))).toBe('applied'); }

describe('comment-bearing transfer boundaries', () => {
  it('exports a comment-bearing draft with an envelope old share readers reject, then restores notes into a separate document', async () => {
    add();
    const originalId = useDocumentsStore.getState().currentId;
    const original = getSerializedSession();
    const exported = await buildDraftFile();
    expect(exported).toMatchObject({ kind: 'dondocs-draft', version: 2 });
    const parsed = parseDraftFile(exported);
    expect(parsed.session.reviewComments).toEqual(original.reviewComments);
    expect(openSessionAsNew(parsed.session)).toBe('applied');
    expect(useDocumentsStore.getState().currentId).not.toBe(originalId);
    expect(getSerializedSession().reviewComments).toEqual(original.reviewComments);
    const oldEnvelope = { kind: 'dondocs-share', version: 1 };
    expect(exported).not.toMatchObject(oldEnvelope);
  });
  it('preserves notes through real encryption and decryption', async () => {
    add();
    const payload = createSharedPayload(getSerializedSession());
    const encrypted = await encryptSharePayload(payload, 'comments-test-password');
    const decrypted = await decryptSharePayload(encrypted, 'comments-test-password');
    expect(parseSharedSession(decrypted).reviewComments).toEqual(payload.reviewComments);
  });
  it('keeps new documents and reusable templates independent of existing comments', () => {
    add();
    const session = getSerializedSession();
    const id = useUserTemplatesStore.getState().saveTemplate('Reusable', session);
    expect(useUserTemplatesStore.getState().templates[id].session.reviewComments).toBeUndefined();
    useDocumentsStore.getState().newDocument();
    expect(getSerializedSession().reviewComments).toBeUndefined();
    expect(session.reviewComments!.threads[0].messages[0].text).toBe('Review note 😀');
  });
  it('uses the new backup boundary for active notes, historical notes, and notes in trash', async () => {
    expect(JSON.parse(await buildBackup()).version).toBe(5);
    add();
    await commitCurrentDocument();
    const commented = getSerializedSession();
    const id = useDocumentsStore.getState().currentId!;
    expect(JSON.parse(await buildBackup()).version).toBe(6);
    useDocumentStore.setState({ reviewComments: undefined });
    await commitCurrentDocument();
    expect(await idbSetSnapshots(id, [{ ts: 1, session: commented }])).toBe(true);
    const historical = JSON.parse(await buildBackup());
    expect(historical.version).toBe(6);
    expect(historical.snapshots[id][0].session.reviewComments).toEqual(commented.reviewComments);
    useDocumentStore.setState({ reviewComments: commented.reviewComments });
    await commitCurrentDocument();
    useDocumentsStore.getState().remove(id);
    const trashed = JSON.parse(await buildBackup());
    expect(trashed.version).toBe(6);
    expect(trashed.documents.find((record: { id: string }) => record.id === id).session.reviewComments).toEqual(commented.reviewComments);
  });
  it.each(['documents', 'history'] as const)('rejects unsupported review schema in backup %s before replacing the active document', async location => {
    const before = useDocumentStore.getState().getSnapshot();
    const session = { ...getSerializedSession(), reviewComments: { version: 3, threads: [] } };
    const data = location === 'documents'
      ? { documents: [{ id: 'incoming', meta: { id: 'incoming', updatedAt: 1 }, session }] }
      : { snapshots: { incoming: [{ ts: 1, session }] } };
    await expect(restoreBackup(JSON.stringify({ kind: BACKUP_KIND, version: 6, ...data }))).rejects.toThrow();
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
  });
  it('recognizes current backup and library versions while rejecting unknown future versions', () => {
    expect(classifyBackup(JSON.stringify({ kind: BACKUP_KIND, version: 6 })).kind).toBe(BACKUP_KIND);
    expect(classifyBackup(JSON.stringify({ kind: 'dondocs-library', version: 2 })).kind).toBe('dondocs-library');
    expect(classifyBackup(JSON.stringify({ kind: BACKUP_KIND, version: 7 })).kind).toBe(BACKUP_KIND);
    expect(classifyBackup(JSON.stringify({ kind: BACKUP_KIND, version: 8 })).kind).toBe(BACKUP_KIND);
    expect(classifyBackup(JSON.stringify({ kind: BACKUP_KIND, version: 9 })).kind).toBe(BACKUP_KIND);
    expect(classifyBackup(JSON.stringify({ kind: BACKUP_KIND, version: 10 })).kind).toBe(BACKUP_KIND);
    expect(classifyBackup(JSON.stringify({ kind: BACKUP_KIND, version: BACKUP_VERSION })).kind).toBe(BACKUP_KIND);
    expect(() => classifyBackup(JSON.stringify({ kind: BACKUP_KIND, version: BACKUP_VERSION + 1 }))).toThrow();
  });
});

import 'fake-indexeddb/auto';
import { storedSignature } from '@/lib/signatureProjection';
import { expect, it, vi } from 'vitest';
import { persistSignature, resolveSignature } from '@/lib/signatureAssets';
import { serializeDocumentSnapshot } from '@/lib/documentSerialization';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { parseSavedSession } from '@/lib/savedSession';
import { collectAttachmentIds } from '@/lib/backup';
import * as attachments from '@/lib/attachments';

it('persists a signature once, retains inline compatibility bytes in saved content and resolves the same image', async () => {
  const image = await persistSignature({ name: 'signature.png', size: 3, data: 'YWJj' });
  const document = prepareSessionState(createBlankSession());document.formData.signatureImage = image;
  const session = serializeDocumentSnapshot(document, 1);
  expect(session.formData.signatureImage).toEqual(image);
  expect(parseSavedSession(session).formData.signatureImage?.fileRef).toEqual(image.fileRef);
  expect(await resolveSignature(session.formData.signatureImage)).toEqual(image);
  expect(await persistSignature(image)).toEqual(image);
  expect(collectAttachmentIds([{ session }])).toContain(image.fileRef!.id);
  const captured = captureDocumentRevision({ documentId: 'A', epoch: 1, editSequence: 1, capturedAt: 1 }, document);
  image.data = 'mutated';
  expect(copyCapturedDocument(captured).document.formData.signatureImage?.data).toBe('YWJj');
});
it('retains legacy bytes after a failed asset write and reports missing references', async () => {
  const image = { name: 'legacy.png', size: 3, data: 'YWJj' };
  const write = vi.spyOn(attachments, 'persistAttachment').mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(persistSignature(image)).rejects.toThrow('Storage unavailable');
  expect(storedSignature(image)).toEqual(image);write.mockRestore();
  await expect(resolveSignature({ ...image, data: '', fileRef: { id: 'missing', name: image.name, size: 3, type: 'image/png' } })).rejects.toThrow('Reattach');
});
it('keeps NAVMC signature references in saved forms and materializes independent render bytes', async () => {
  const { storedFormSignatures } = await import('@/lib/signatureProjection');
  const { resolveFormSignatures } = await import('@/lib/signatureAssets');
  const owned = await persistSignature({ name: 'form.png', size: 3, data: 'YWJj' });
  const block = { name: 'Signer', statement: '', style: 'image' as const, image: owned.data, imageRef: owned.fileRef };
  const session = createBlankSession('navmc_118_11');
  session.forms!.navmc11811!.signatureBlocks = [block];
  const saved = serializeDocumentSnapshot(prepareSessionState(session), 1);
  const decoded = parseSavedSession(saved);
  const form = decoded.forms!.navmc11811!;
  expect(form.signatureBlocks[0].image).toBe('YWJj');
  expect(form.signatureBlocks[0].imageRef).toEqual(owned.fileRef);
  expect((await resolveFormSignatures(form)).signatureBlocks[0].image).toBe('YWJj');
  expect(storedFormSignatures({ signatureBlocks: [block] }).signatureBlocks[0].image).toBe('YWJj');
  expect(collectAttachmentIds([{ session: saved }])).toContain(owned.fileRef!.id);
});
it('does not insert a selected profile signature when reopening a saved document', async () => {
  const { useDocumentsStore, flushDocumentWrites } = await import('@/stores/documentsStore');
  const { useDocumentStore } = await import('@/stores/documentStore');
  const { useProfileStore } = await import('@/stores/profileStore');
  useDocumentsStore.setState({ hydrated: true, currentId: null, docs: {}, trash: {}, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Unsigned saved document');
  useDocumentsStore.getState().saveCurrent();
  const id = useDocumentsStore.getState().currentId!;
  useProfileStore.setState({ selectedProfile: 'Other', profiles: { Other: {
    unitLine1: '', unitLine2: '', unitAddress: '', ssic: '', from: '', sigFirst: 'Other', sigMiddle: '', sigLast: 'Signer', sigRank: '', sigTitle: '',
    signatureImage: { name: 'other.png', size: 3, data: 'YWJj' },
  } } });
  useDocumentsStore.getState().switchTo(id);
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
  await flushDocumentWrites();
});

it('does not read an inactive form signature asset', async () => {
  const { resolveFormSignatures } = await import('@/lib/signatureAssets');
  const form = { signatureBlocks: [{ name: 'Typed', style: 'typed', imageRef: { id: 'absent', name: 'old.png', size: 3, type: 'image/png' } }] };
  expect(await resolveFormSignatures(form)).toEqual(form);
});

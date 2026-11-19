import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { createBlankSession, useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import * as assets from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { editPackageMember, savePackageWorkingCopy } from '@/lib/actionPackageWorkingCopy';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
beforeEach(() => {
  vi.restoreAllMocks();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
});
async function fixture() {
  const member = await assets.capturePackageMember(captureDocumentRevision({ documentId: 'source', epoch: 0, editSequence: 0, capturedAt: 1 },
    { ...createBlankSession(), endItems: [], publicationTables: {} }), 'Request letter', 'basic-letter');
  const original = await reviseActionPackage(await createActionPackage('Working copy test'), [member]);
  return { member, record: await editPackageMember(original, member) };
}
it('saves captured content once and keeps the same editable document attached to the new version', async () => {
  const { record, member } = await fixture(), documentId = useDocumentsStore.getState().currentId!;
  useDocumentStore.getState().setField('subject', 'Saved working copy content');
  const saved = await savePackageWorkingCopy(record, member);
  expect(saved.revisions).toHaveLength(record.revisions.length + 1);
  expect(getPackageRevision(saved).members[0]).toMatchObject({ session: { formData: { subject: 'Saved working copy content' } } });
  expect(saved.workingCopies?.find(copy => copy.documentId === documentId)?.revisionId).toBe(saved.currentRevisionId);
  await editPackageMember(saved, getPackageRevision(saved).members[0] as typeof member);
  expect(useDocumentsStore.getState().currentId).toBe(documentId);
  expect(Object.keys(useDocumentsStore.getState().docs)).toEqual([documentId]);
});
it.each(['edit', 'switch'] as const)('rejects a late save after the active document changes by %s', async mode => {
  const { record, member } = await fixture(), capture = assets.capturePackageMember;
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(assets, 'capturePackageMember').mockImplementationOnce(async (...args) => { await held; return capture(...args); });
  const pending = savePackageWorkingCopy(record, member);
  if (mode === 'edit') useDocumentStore.getState().setField('subject', 'Newer unsaved edit');
  else useDocumentsStore.setState(state => ({ activationEpoch: state.activationEpoch + 1 }));
  release(); await expect(pending).rejects.toThrow();
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});

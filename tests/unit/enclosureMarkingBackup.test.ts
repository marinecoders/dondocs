import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { validateBackupSession } from '@/lib/backupValidation';
import { createBlankSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { idbGetAllDocuments, idbDeleteDocument, idbAddSnapshot } from '@/lib/documentsDb';

beforeEach(async () => {
  for (const record of await idbGetAllDocuments() ?? []) await idbDeleteDocument(record.id);
  useDocumentsStore.setState({ currentId: null, hydrated: true, baseline: null, docs: {} });
  useUserTemplatesStore.setState({ templates: {} });
  useUIStore.setState({ storageHealth: 'ok' });
});

it.each(['enclosure', 'transmittal', 'history'] as const)('requires a current backup reader for retained %s declarations', async kind => {
  const session = createBlankSession();
  session.enclosures = [{ title: 'Synthetic appendix' }];
  if (kind === 'transmittal') session.formData.cuiTransmittalNote = true;
  else session.enclosures[0].marking = { classLevel: 'cui', cuiCategory: 'Privacy' };
  if (kind === 'history') {
    await idbAddSnapshot(`marked-${kind}`, { ts: 42, session: structuredClone(session) });
    delete session.enclosures[0].marking;
  }
  const id = `marked-${kind}`;
  useDocumentsStore.setState({ docs: { [id]: { meta: { id, title: id, docType: 'naval_letter', updatedAt: 1 }, session } } });
  const bundle = JSON.parse(await buildBackup());
  expect(bundle.version).toBe(16);
  await expect(restoreBackup(JSON.stringify({ ...bundle, version: 15 }))).rejects.toThrow(/backup version 16/);
  expect(await idbGetAllDocuments()).toEqual([]);
  const restored = await restoreBackup(JSON.stringify(bundle));
  expect(restored.issues).toBeUndefined();
  expect(restored.documents.imported).toBe(1);
  const retained = (await idbGetAllDocuments())![0].session;
  if (kind === 'enclosure') expect(retained.enclosures[0].marking).toEqual({ classLevel: 'cui', cuiCategory: 'Privacy' });
  if (kind === 'transmittal') expect(retained.formData.cuiTransmittalNote).toBe(true);
});

it('rejects malformed nested declarations before restoring documents', () => {
  const session = createBlankSession();
  session.enclosures = [{ title: 'Invalid', marking: { classLevel: 'unknown' as never } }];
  expect(() => validateBackupSession(session)).toThrow();
  session.enclosures = [];
  session.formData.cuiTransmittalNote = 'yes' as never;
  expect(() => validateBackupSession(session)).toThrow(/transmittal confirmation/);
});

import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createBlankSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { buildPortableActionPackage, importPortableActionPackage } from '@/lib/actionPackageTransfer';
import { buildBackup } from '@/lib/backup';
import type { DocumentSnapshot } from '@/stores/historyStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));

async function clearWorkspace() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dondocs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([...database.objectStoreNames], 'readwrite');
      for (const name of database.objectStoreNames) transaction.objectStore(name).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
  useDocumentsStore.setState({ currentId: null, hydrated: true, baseline: null, docs: {} });
  useUIStore.setState({ storageHealth: 'ok' });
}

it('installs a transferred marked package in an empty workspace with exact original PDFs and a current backup reader', async () => {
  await createActionPackage('Initialize synthetic workspace');
  await clearWorkspace();
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText('SYNTHETIC RETAINED ORIGINAL');
  const bytes = new Uint8Array(await pdf.save());
  const session: DocumentSnapshot = { ...createBlankSession(), endItems: [], publicationTables: {} };
  session.formData.classLevel = 'cui';
  session.formData.cuiCategory = 'Privacy';
  const file = { name: 'synthetic.pdf', size: bytes.byteLength, data: bytes.buffer };
  session.enclosures = [
    { title: 'Public appendix', marking: { classLevel: 'unclassified' }, file },
    { title: 'Controlled appendix', marking: { classLevel: 'custom', customClassification: 'CUI//PRVCY' }, file },
  ];
  const captured = captureDocumentRevision({ documentId: 'source-synthetic', epoch: 1, editSequence: 0, capturedAt: 42 },
    { ...session, endItems: [], publicationTables: {} });
  const member = await capturePackageMember(captured, 'Synthetic letter', 'basic-letter');
  const record = await reviseActionPackage(await createActionPackage('Synthetic marked package'), [member]);
  const portable = await buildPortableActionPackage(record);
  session.enclosures[0].marking = { classLevel: 'cui' };
  await clearWorkspace();
  const imported = await importPortableActionPackage(portable);
  const retained = getPackageRevision(imported).members[0];
  if (retained.kind !== 'native') throw new Error('Expected captured native member');
  expect(retained.source?.local).toBe(false);
  expect(retained.session.enclosures.map(enclosure => enclosure.marking)).toEqual([
    { classLevel: 'unclassified' }, { classLevel: 'custom', customClassification: 'CUI//PRVCY' },
  ]);
  const reopened = await readPackageMemberDraft(retained);
  expect(reopened.draft).toMatchObject({ kind: 'dondocs-draft', version: 5 });
  expect(reopened.reviewed.files).toHaveLength(2);
  for (const file of reopened.reviewed.files) expect(new Uint8Array(file!.data)).toEqual(bytes);
  const backup = JSON.parse(await buildBackup());
  expect(backup.documents).toEqual([]);
  expect(backup.version).toBe(16);
  expect(backup.actionPackages).toHaveLength(1);
});

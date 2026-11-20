import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { persistAttachment } from '@/lib/attachments';
import sharp from 'sharp';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, preparePackageMember, readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { buildPortableActionPackage, importPortableActionPackage } from '@/lib/actionPackageTransfer';
import { publicationVolumeErrors } from '@/lib/publicationVolume';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { volumeFixture } from './_helpers/volumeFixture';
import type { DocumentSnapshot } from '@/stores/historyStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));

it('recovers a captured volume and exact figure bytes from a portable package after all source storage is removed', async () => {
  await createActionPackage('Initialize synthetic workspace');
  const bytes = new Uint8Array(await sharp({ create: { width: 24, height: 16, channels: 4, background: '#abcdef' } }).png().toBuffer());
  const fileRef = await persistAttachment({ name: 'volume.png', size: bytes.byteLength, type: 'image/png' }, new Uint8Array(bytes).buffer);
  const session: DocumentSnapshot = { ...createBlankSession(), ...volumeFixture(), documentCategory: 'correspondence', formType: 'navmc_10274' };
  session.paragraphs.push({ id: 'captured-figure', volumeSectionId: 'section-intro', text: 'Captured synthetic figure', level: 0,
    figure: { fileRef, name: 'volume.png', type: 'image/png', placement: 'body', altText: 'Synthetic retained image' } });
  session.paragraphs.find(paragraph => paragraph.bodyTable)!.bodyTable!.columnWidths = [30, 70];
  const expected = structuredClone(session);
  const captured = captureDocumentRevision({ documentId: 'source-volume', epoch: 1, editSequence: 0, capturedAt: 42 }, session);
  const member = await capturePackageMember(captured, 'Synthetic volume', 'supporting-document');
  const record = await reviseActionPackage(await createActionPackage('Portable volume'), [member]);
  const portable = await buildPortableActionPackage(record);
  session.formData.volume!.chapters.reverse();
  session.paragraphs[0].text = 'Newer source work must not replace the captured content.';

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

  const restored = await importPortableActionPackage(portable);
  const retained = getPackageRevision(restored).members[0];
  if (retained.kind !== 'native') throw new Error('Expected captured native volume');
  expect(retained.source?.local).toBe(false);
  expect(retained.session.formData.volume).toEqual(expected.formData.volume);
  expect(retained.session.paragraphs).toEqual(member.session.paragraphs);
  const reopened = await readPackageMemberDraft(retained);
  expect(new Uint8Array(reopened.reviewed.figures.at(-1)!.data)).toEqual(bytes);
  const { snapshot } = await preparePackageMember(retained);
  expect(publicationVolumeErrors(snapshot.formData.volume, snapshot.paragraphs)).toEqual([]);
  const generated = generateAllLatexFiles(snapshot);
  expect(snapshot.paragraphs[0].text).toBe(expected.paragraphs[0].text);
  expect(generated.texFiles['body.tex']).toContain('\\dondocsReferenceAnchor{volume.node.intro}');
  expect(generated.texFiles['body.tex']).not.toContain('Newer source work');
  expect(generated.figures).toHaveLength(1);
  expect(snapshot.paragraphs.find(paragraph => paragraph.bodyTable)!.bodyTable!.columnWidths).toEqual([30, 70]);
  expect(useDocumentsStore.getState().docs).toEqual({});
});

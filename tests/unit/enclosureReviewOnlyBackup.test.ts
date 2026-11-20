import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, flushDocumentWrites } from '@/stores/documentsStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { useProfileStore } from '@/stores/profileStore';
import { useUIStore } from '@/stores/uiStore';
import { startReviewRound } from '@/lib/reviewRoundActions';
import { idbDeleteDocument } from '@/lib/documentsDb';
import { buildBackup, restoreBackup } from '@/lib/backup';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));

it('requires the new reader for an enclosure declaration retained only by a review baseline', async () => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useUserTemplatesStore.setState({ templates: {} });
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useUIStore.setState({ storageHealth: 'ok' });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Synthetic orphaned review source');
  useDocumentStore.setState({ enclosures: [{ title: 'Retained controlled enclosure', marking: { classLevel: 'cui', cuiCategory: 'Privacy' } }] });
  const round = await startReviewRound('Retained source review');
  await flushDocumentWrites();
  await idbDeleteDocument(round.sourceDocumentId);
  useDocumentsStore.setState({ docs: {}, currentId: null, baseline: null });
  const backup = JSON.parse(await buildBackup());
  expect(backup.documents).toEqual([]);
  expect(backup.reviewRounds).toHaveLength(1);
  expect(backup.reviewRounds[0].baseline.session.enclosures[0].marking).toEqual({ classLevel: 'cui', cuiCategory: 'Privacy' });
  expect(backup.version).toBe(16);
  await expect(restoreBackup(JSON.stringify({ ...backup, version: 15 }))).rejects.toThrow('backup version 16');
});

import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { openPackageReview, startPackageReview } from '@/lib/packageReviewRounds';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { useDocumentsStore } from '@/stores/documentsStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
it('refuses an unrestorable backup when exact review capture crosses the import complexity budget', async () => {
  useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null });
  const session = createBlankSession();
  session.paragraphs = Array.from({ length: 650 }, (_, index) => ({ id: `synthetic-${index}`, text: 'Synthetic retained policy paragraph.', level: 0 }));
  const member = await capturePackageMember(captureDocumentRevision({ documentId: 'synthetic-source', capturedAt: 100, editSequence: 1, epoch: 0 },
    { ...session, endItems: [], publicationTables: {} }), 'Synthetic member', 'basic-letter');
  const members = Array.from({ length: 20 }, (_, index) => ({ ...structuredClone(member), id: `synthetic-member-${index}`, revisionId: `synthetic-member-revision-${index}`,
    role: index === 0 ? 'basic-letter' as const : 'supporting-document' as const }));
  const record = await reviseActionPackage(await createActionPackage('Synthetic recovery boundary'), members);
  const before = await buildBackup();
  await expect(restoreBackup(before)).resolves.toBeDefined();
  const reviewed = await startPackageReview(record);
  await expect(buildBackup()).rejects.toThrow('Backup is too complex to import');
  const retained = (await listActionPackages()).find(value => value.id === record.id)!;
  expect(retained).toEqual(reviewed);
  expect((await openPackageReview(retained, reviewed.reviewRounds![0].id)).baseline).toEqual(reviewed.reviewRounds![0].baseline);
});

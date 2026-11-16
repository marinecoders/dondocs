import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createBlankSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { composeBasicLetterId } from '@/lib/endorsement';
import { capturePackageMember, preparePackageMember, readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { createActionPackage, reviseActionPackage, getPackageRevision } from '@/lib/actionPackages';
import { capturePackageTemplate, exportPackageTemplate, importPackageTemplate, instantiatePackageTemplate, packageTemplateFileSlots, deletePackageTemplate, listPackageTemplates } from '@/lib/packageTemplateLibrary';
import { preparePackageAssembly } from '@/lib/actionPackageAssembly';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));

beforeEach(() => { useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true }); useUIStore.setState({ storageHealth: 'ok' }); });

it.each(['enclosure', 'basic-letter'] as const)('requires fresh embedded %s bytes before creating a complete package', async kind => {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]); const data = new Uint8Array(await pdf.save()).buffer;
  const freshPdf = await PDFDocument.create(); freshPdf.addPage([612, 792]); freshPdf.setTitle('FRESH REPLACEMENT'); const freshData = new Uint8Array(await freshPdf.save()).buffer;
  const session = createBlankSession(); session.documentMode = 'custom';
  if (kind === 'basic-letter') session.docType = 'new_page_endorsement';
  session.formData = { ...session.formData, subject: 'Reusable embedded file action', from: 'Training Office', to: 'Training Officer', sigLast: 'EXAMPLE', signatureType: 'none' };
  const mainSnapshot = { ...session, docType: 'naval_letter', endItems: [], publicationTables: {}, paragraphs: [{ id: 'main', text: 'Fictional training main letter.', level: 0 }], enclosures: [] };
  const main = await capturePackageMember(captureDocumentRevision({ documentId: 'main_source', capturedAt: 100, editSequence: 1, epoch: 0 }, mainSnapshot), 'Main letter', 'basic-letter');
  if (kind === 'basic-letter') session.formData = { ...session.formData, basicLetterId: composeBasicLetterId(mainSnapshot), endorsementOrdinal: 'FIRST' };
  const captured = captureDocumentRevision({ documentId: 'embedded_source', capturedAt: 100, editSequence: 1, epoch: 0 }, {
    ...session, endItems: [], publicationTables: {}, paragraphs: [{ id: 'body', text: 'Review this training action.', level: 0 }],
    ...(kind === 'basic-letter' ? { formData: { ...session.formData, basicLetterFile: { name: 'previous.pdf', size: data.byteLength, data } } } : {}),
    enclosures: kind === 'enclosure' ? [{ title: 'Required native enclosure', file: { name: 'previous.pdf', size: data.byteLength, data } }] : [],
  });
  const member = await capturePackageMember(captured, 'Letter', kind === 'basic-letter' ? 'endorsement' : 'basic-letter');
  const source = await reviseActionPackage(await createActionPackage('Embedded source'), kind === 'basic-letter' ? [main, member] : [member]);
  const template = await capturePackageTemplate(source, source.currentRevisionId, 'Embedded starter');
  const slots = packageTemplateFileSlots(template);
  expect(slots).toHaveLength(1); expect(slots[0].required).toBe(true); expect(slots[0].native).toBe(true);
  expect(JSON.stringify(template)).not.toContain('previous.pdf');
  const imported = await importPackageTemplate(await exportPackageTemplate(template));
  expect(packageTemplateFileSlots(imported)).toEqual(slots);
  const { buildBackup, restoreBackup } = await import('@/lib/backup');
  const backup = await buildBackup();
  await deletePackageTemplate(template); await deletePackageTemplate(imported);
  await restoreBackup(backup);
  expect(packageTemplateFileSlots((await listPackageTemplates()).find(value => value.id === imported.id)!)).toEqual(slots);
  await expect(instantiatePackageTemplate(imported, 'Missing native file', {}, {})).rejects.toThrow('Attach a fresh PDF');
  const created = await instantiatePackageTemplate(imported, 'Fresh native file action', {}, { [slots[0].key]: { name: 'fresh.pdf', data: freshData, signedOriginal: false } });
  const freshMember = getPackageRevision(created).members[kind === 'basic-letter' ? 1 : 0];
  if (freshMember.kind !== 'native') throw new Error('Expected native member');
  const fresh = await readPackageMemberDraft(freshMember);
  const file = kind === 'enclosure' ? fresh.reviewed.files[0] : fresh.reviewed.basicLetter;
  expect(file?.name).toBe('fresh.pdf'); expect(new Uint8Array(file!.data)).toEqual(new Uint8Array(freshData));
  const working = await preparePackageMember(freshMember);
  expect(kind === 'enclosure' ? working.snapshot.enclosures[0].file?.name : working.snapshot.formData.basicLetterFile?.name).toBe('fresh.pdf');
  const portable = await parsePortableActionPackage(await buildPortableActionPackage(created));
  expect(portable.record.revisions[0].members[0]).toMatchObject({ kind: 'native' });
  const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
  expect((await preparePackageAssembly(created, created.currentRevisionId, policy)).readiness.state).toBe('ready');
  const original = await readPackageMemberDraft(member);
  expect(kind === 'enclosure' ? original.reviewed.files[0]?.name : original.reviewed.basicLetter?.name).toBe('previous.pdf');
});

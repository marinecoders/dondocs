import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { configuredMaintenanceFixture, maintenanceFixture } from '../_helpers/packageTemplateMaintenance';
import { prepareConditionalPackage, applyPreparedConditionalPackage } from '@/lib/packageConditional';
import type { FormInstance } from '@/services/forms/model';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { preparePackageRoster, savePreparedPackageRoster, createPreparedPackageRosterRow, prepareSavedPackageRoster, listPackageRosters, packageRosterRowsFromWorksheet, removePackageRoster } from '@/lib/packageRoster';
import { packageRosterSchema, validPackageRosterTransition, validatePackageRoster } from '@/lib/packageRosterModel';
import { readPackageAsset } from '@/lib/actionPackageAssets';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import * as db from '@/lib/documentsDb';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { useUIStore } from '@/stores/uiStore';
import type { ExcelRoster } from '@/lib/excelRoster';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(async () => {
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy); useUIStore.setState({ storageHealth: 'ok' });
  await createActionPackage('Initialize'); const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); });
  await new Promise<void>(resolve => { const tx = database.transaction([...database.objectStoreNames], 'readwrite'); for (const name of database.objectStoreNames) tx.objectStore(name).clear(); tx.oncomplete = () => resolve(); }); database.close();
});
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const template = maintenanceFixture(); template.members.push({ kind: 'attachment', key: 'support', label: 'Fresh supporting PDF', role: 'supporting-document', required: true });
  if (template.members[0].kind === 'native') template.members[0].draft.paragraphs = [{ id: 'shared-starter', text: 'Common synthetic instructions only.', level: 0 }];
  const bytes = async (width: number) => { const pdf = await PDFDocument.create(); pdf.addPage([width, 600]); return new Uint8Array(await pdf.save()).buffer; };
  const a = await bytes(400), b = await bytes(480), key = JSON.stringify(['support', null]);
  const rows = [{ number: 2, name: 'Synthetic action Alpha', answers: { version: 1 as const, values: { subject: 'Alpha only' }, groups: {} }, attachments: { [key]: { name: 'Alpha original.pdf', data: a, signedOriginal: true } } },
    { number: 3, name: 'Synthetic action Bravo', answers: { version: 1 as const, values: { subject: 'Bravo only' }, groups: {} }, attachments: { [key]: { name: 'Bravo original.pdf', data: b, signedOriginal: false } } }];
  return { template, rows, a, b };
}
async function attachmentCount() {
  const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); });
  const count = await new Promise<number>(resolve => { const request = database.transaction('attachments').objectStore('attachments').count(); request.onsuccess = () => resolve(request.result); }); database.close(); return count;
}
it('creates independent owning packages with exact per-row files, fresh identities and no cross-row facts or authority', async () => {
  const { template, rows, a, b } = await fixture(), pending = preparePackageRoster(template, 'Synthetic roster', rows, policy);
  rows[0].answers.values.subject = 'Caller mutation'; const prepared = await pending;
  expect(prepared.ready).toBe(true); expect(await listActionPackages()).toEqual([]); expect(await attachmentCount()).toBe(0);
  await expect(savePreparedPackageRoster(prepared, policy, false)).rejects.toThrow('review');
  const journal = await savePreparedPackageRoster(prepared, policy, true); expect(journal.rows.map(row => row.status)).toEqual(['pending', 'pending']); expect(await listActionPackages()).toEqual([]);
  await expect(createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, false)).rejects.toThrow('Review this exact');
  const first = await createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, true), second = await createPreparedPackageRosterRow(prepared, prepared.rows[1].id, policy, true);
  const alpha = getPackageRevision(first.record), bravo = getPackageRevision(second.record);
  expect(first.record.id).not.toBe(second.record.id); expect(alpha.members[0].id).not.toBe(bravo.members[0].id); expect(alpha.members[0].revisionId).not.toBe(bravo.members[0].revisionId);
  if (alpha.members[0].kind !== 'native' || bravo.members[0].kind !== 'native') throw new Error('Native expected');
  expect(alpha.members[0].session.formData.subject).toBe('ALPHA ONLY'); expect(bravo.members[0].session.formData.subject).toBe('BRAVO ONLY');
  expect(alpha.members[0].session.paragraphs[0].id).not.toBe(bravo.members[0].session.paragraphs[0].id);
  expect(alpha.information!.facts[0].id).not.toBe(bravo.information!.facts[0].id); expect(JSON.stringify(first.record)).not.toContain('Bravo only');
  const alphaFile = alpha.members.find(member => member.kind === 'original')!, bravoFile = bravo.members.find(member => member.kind === 'original')!;
  if (alphaFile.kind !== 'original' || bravoFile.kind !== 'original') throw new Error('Original expected');
  expect(await readPackageAsset(alphaFile.original)).toEqual(a); expect(await readPackageAsset(bravoFile.original)).toEqual(b); expect(alphaFile.original.id).not.toBe(bravoFile.original.id);
  expect(first.record.reviewRounds).toBeUndefined(); expect(alpha.signing).toBeUndefined(); expect(alpha.work).toBeUndefined(); expect(first.record.workingCopies).toBeUndefined();
  expect(second.roster.rows.map(row => row.status)).toEqual(['created', 'created']); expect((await listActionPackages())).toHaveLength(2);
  await expect(parsePortableActionPackage(await buildPortableActionPackage(first.record))).resolves.toBeDefined();
});
it('keeps partial success durable and resumes pending rows after newer work without duplicating an existing action', async () => {
  const { template, rows } = await fixture(), prepared = await preparePackageRoster(template, 'Partial roster', rows, policy); await savePreparedPackageRoster(prepared, policy, true);
  const first = await createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, true), newer = await reviseActionPackage(first.record, getPackageRevision(first.record).members);
  const saved = (await listPackageRosters())[0], resumed = await prepareSavedPackageRoster(saved, policy);
  expect(resumed.resuming).toBe(true); expect(resumed.rows[0].status).toBe('created'); expect(resumed.rows[0].ready).toBe(true);
  await expect(createPreparedPackageRosterRow(resumed, resumed.rows[1].id, policy, false)).rejects.toThrow('Review');
  await createPreparedPackageRosterRow(resumed, resumed.rows[1].id, policy, true);
  expect((await listActionPackages()).find(record => record.id === first.record.id)).toEqual(newer); expect(await listActionPackages()).toHaveLength(2);
  await expect(createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, true)).rejects.toThrow(); expect(await listActionPackages()).toHaveLength(2);
  await removePackageRoster((await listPackageRosters())[0]); expect(await listPackageRosters()).toEqual([]); expect(await listActionPackages()).toHaveLength(2);
});
it('gives configured form rows and retained page assets fresh ownership without changing their exact template bytes', async () => {
  const template = await configuredMaintenanceFixture(), starter = template.members[0]; if (starter.kind !== 'native') throw new Error('Native expected');
  const form = starter.draft.genericForm as FormInstance; form.rows.roster = [{ id: 'seed-row', answers: { grade: 'e1' } }];
  const rows = ['Alpha', 'Bravo'].map((name, index) => ({ number: index + 1, name: `Synthetic ${name}`, answers: { version: 1 as const, values: { subject: name }, groups: {} } }));
  const prepared = await preparePackageRoster(template, 'Configured action roster', rows, policy); await savePreparedPackageRoster(prepared, policy, true);
  const alpha = getPackageRevision((await createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, true)).record).members[0];
  const bravo = getPackageRevision((await createPreparedPackageRosterRow(prepared, prepared.rows[1].id, policy, true)).record).members[0];
  if (alpha.kind !== 'native' || bravo.kind !== 'native') throw new Error('Native expected');
  expect(alpha.session.genericForm!.rows.roster[0].id).not.toBe(bravo.session.genericForm!.rows.roster[0].id);
  expect(alpha.session.genericForm!.rows.roster[0].id).not.toBe('seed-row'); expect(form.rows.roster[0].id).toBe('seed-row');
  expect(alpha.templates!['page1.pdf'].id).not.toBe(bravo.templates!['page1.pdf'].id); expect(await readPackageAsset(alpha.templates!['page1.pdf'])).toEqual(await readPackageAsset(bravo.templates!['page1.pdf']));
});
it('rejects a reserved creation identity colliding with an existing owning package', async () => {
  const existing = await createActionPackage('Existing owning action'), prepared = await prepareConditionalPackage({ template: maintenanceFixture(), newPackageId: existing.id, name: 'Do not replace', answers: { version: 1, values: { subject: 'Synthetic' }, groups: {} } }, policy);
  await expect(applyPreparedConditionalPackage(prepared, policy, true)).rejects.toThrow('changed'); expect(await listActionPackages()).toEqual([existing]); expect(await attachmentCount()).toBe(0);
});
it('publishes neither package nor orphan files when the shared atomic writer fails, and retries only after fresh row review', async () => {
  const { template, rows } = await fixture(), prepared = await preparePackageRoster(template, 'Atomic roster', rows.slice(0, 1), policy); await savePreparedPackageRoster(prepared, policy, true);
  const count = await attachmentCount(), writer = vi.spyOn(db, 'idbCompareActionPackage').mockResolvedValueOnce(false);
  await expect(createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, true)).rejects.toThrow('package changed'); writer.mockRestore();
  expect(await listActionPackages()).toEqual([]); expect(await attachmentCount()).toBe(count); expect((await listPackageRosters())[0].rows[0].status).toBe('failed');
  const resumed = await prepareSavedPackageRoster((await listPackageRosters())[0], policy);
  await createPreparedPackageRosterRow(resumed, resumed.rows[0].id, policy, true); expect(await listActionPackages()).toHaveLength(1); expect((await listPackageRosters())[0].rows[0].status).toBe('created');
});
it('fences concurrent tabs and never lets a journal-only update invent a created package', async () => {
  const { template, rows } = await fixture(), prepared = await preparePackageRoster(template, 'Concurrent roster', rows, policy), journal = await savePreparedPackageRoster(prepared, policy, true);
  const forged = structuredClone(journal); forged.sequence++; forged.updatedAt++; forged.rows[0].status = 'created'; forged.rows[0].receipt = { revisionId: 'fake', contentSha256: '0'.repeat(64), policySha256: '0'.repeat(64), createdAt: Date.now() };
  expect(await db.idbComparePackageRoster(journal, forged, () => true)).toBe(false);
  const other = await prepareSavedPackageRoster(journal, policy);
  const result = await Promise.allSettled([createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, true), createPreparedPackageRosterRow(other, other.rows[0].id, policy, true)]);
  expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(await listActionPackages()).toHaveLength(1); expect((await listPackageRosters())[0].rows[0].status).toBe('created');
});
it('rejects invalid rows before saving and stops on policy, cancellation, stale ownership or changed source bytes', async () => {
  const { template, rows } = await fixture(); rows[0].answers.values.subject = '';
  const invalid = await preparePackageRoster(template, 'Invalid roster', rows, policy); expect(invalid.ready).toBe(false); await expect(savePreparedPackageRoster(invalid, policy, true)).rejects.toThrow('Resolve every');
  rows[0].answers.values.subject = 'Alpha only'; const prepared = await preparePackageRoster(template, 'Guarded roster', rows, policy), journal = await savePreparedPackageRoster(prepared, policy, true);
  const controller = new AbortController(); controller.abort(); await expect(createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, true, controller.signal)).rejects.toThrow();
  await expect(createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, true, undefined, () => false)).rejects.toThrow('no longer current');
  const changed = structuredClone(journal); new Uint8Array(Object.values(changed.rows[0].attachments)[0].data)[0] ^= 1; await expect(validatePackageRoster(changed)).rejects.toThrow('corrupt');
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } }));
  await expect(createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, true)).rejects.toThrow('Deployment'); expect(await listActionPackages()).toEqual([]);
});
it('reviews raw multiline warning and created-row text on stricter-policy resume', async () => {
  const { template, rows } = await fixture();
  await expect(preparePackageRoster(template, 'Raw warning', [{ ...rows[0], warnings: ['Synthetic warning\nSECRET\nRetained notice'] }], policy)).rejects.toThrow('configured levels');
  const permissive = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'secret', allowedLevels: ['unclassified', 'confidential', 'secret'] }, runtime: { status: 'absent' } });
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(permissive); vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(permissive);
  const marked = [{ ...rows[0], answers: { version: 1 as const, values: { subject: 'Synthetic subject\nSECRET\nPrior content' }, groups: {} } }];
  const prepared = await preparePackageRoster(template, 'Marked created row', marked, permissive); await savePreparedPackageRoster(prepared, permissive, true); await createPreparedPackageRosterRow(prepared, prepared.rows[0].id, permissive, true);
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(policy); vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(policy);
  await expect(prepareSavedPackageRoster((await listPackageRosters())[0], policy)).rejects.toThrow('configured levels');
});
it('maps existing Excel provenance, boolean false and fresh per-row participants without copying IDs', () => {
  const template = maintenanceFixture(); template.program.questions.push({ id: 'include', label: 'Include?', kind: 'boolean', required: true }, { id: 'reference', label: 'Reference', kind: 'identifier', required: true }, { id: 'personName', label: 'Person name', kind: 'text', required: true, groupId: 'people' });
  template.program.participantGroups = [{ id: 'people', label: 'People', role: 'subject', min: 1, max: 2 }];
  const people = JSON.stringify([{ label: 'Synthetic participant', answers: { personName: 'Synthetic Example' } }]);
  const roster: ExcelRoster = { sheetName: 'Synthetic', columnCount: 5, rows: [{ number: 1, cells: ['Action', 'Subject', 'Include', 'Reference', 'People'].map(value => ({ value })) },
    { number: 2, cells: [{ value: 'Alpha' }, { value: 'Alpha subject' }, { value: 'false' }, { value: '123', numericIdentifierRisk: true }, { value: people }] },
    { number: 3, cells: [{ value: 'Bravo' }, { value: 'Bravo subject' }, { value: 'yes' }, { value: '000123' }, { value: people }] }] };
  const rows = packageRosterRowsFromWorksheet(template, { roster, headerRow: 1 }, { name: 0, 'question:subject': 1, 'question:include': 2, 'question:reference': 3, 'group:people': 4 });
  expect(rows[0].answers.values.include).toBe(false); expect(rows[1].answers.values.reference).toBe('000123'); expect(rows[0].warnings!.join(' ')).toContain('leading zeros');
  expect(rows[0].answers.groups.people[0].id).not.toBe(rows[1].answers.groups.people[0].id);
  const invalid = structuredClone(roster); invalid.rows[1].cells[4].value = '{bad'; expect(() => packageRosterRowsFromWorksheet(template, { roster: invalid, headerRow: 1 }, { name: 0, 'group:people': 4 })).toThrow('row 2');
});
it('bounds inventories and rejects duplicate participant ownership and receipt/source identity mutation', async () => {
  const { template, rows } = await fixture(), prepared = await preparePackageRoster(template, 'Bounded roster', rows, policy), journal = await savePreparedPackageRoster(prepared, policy, true);
  const changed = structuredClone(journal); changed.rows[0].name = 'A different action'; changed.sequence++; expect(validPackageRosterTransition(journal, changed)).toBe(false);
  const duplicate = structuredClone(journal); duplicate.rows[0].answers.groups.people = [{ id: 'shared-person', label: 'Example', answers: {} }]; duplicate.rows[1].answers.groups.people = duplicate.rows[0].answers.groups.people;
  expect(() => packageRosterSchema.parse(duplicate)).toThrow('fresh participant');
  await expect(preparePackageRoster(template, 'Too many', Array.from({ length: 26 }, (_, index) => ({ ...rows[0], number: index + 1 })), policy)).rejects.toThrow('25');
});

it('rejects a policy change at the real publication writer without creating a receipt or orphan assets', async () => {
  const { template, rows } = await fixture(), prepared = await preparePackageRoster(template, 'Final publication guard', rows.slice(0, 1), policy);
  await savePreparedPackageRoster(prepared, policy, true); const beforeAssets = await attachmentCount(), write = db.idbCompareActionPackage;
  vi.spyOn(db, 'idbCompareActionPackage').mockImplementationOnce(async (...args) => {
    vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } }));
    return write(...args);
  });
  await expect(createPreparedPackageRosterRow(prepared, prepared.rows[0].id, policy, true)).rejects.toThrow(/no longer current|Deployment settings changed/);
  expect(await listActionPackages()).toEqual([]); expect(await attachmentCount()).toBe(beforeAssets);
  expect((await listPackageRosters())[0].rows[0].status).toBe('pending');
});
it('recovers a different-row journal CAS race without duplicating or changing the completed action', async () => {
  const { template, rows } = await fixture(), first = await preparePackageRoster(template, 'Independent row race', rows, policy), journal = await savePreparedPackageRoster(first, policy, true);
  const other = await prepareSavedPackageRoster(journal, policy);
  const results = await Promise.allSettled([
    createPreparedPackageRosterRow(first, first.rows[0].id, policy, true),
    createPreparedPackageRosterRow(other, other.rows[1].id, policy, true),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); const original = (await listActionPackages())[0];
  const updated = (await listPackageRosters())[0], missing = updated.rows.find(row => row.status !== 'created')!, resumed = await prepareSavedPackageRoster(updated, policy);
  await createPreparedPackageRosterRow(resumed, missing.id, policy, true);
  expect(await listActionPackages()).toHaveLength(2); expect((await listActionPackages()).find(record => record.id === original.id)).toEqual(original);
  expect((await listPackageRosters())[0].rows.map(row => row.status)).toEqual(['created', 'created']);
});

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActionPackage, listActionPackages } from '@/lib/actionPackages';
import { listPackageTemplates } from '@/lib/packageTemplateLibrary';
import { preparePackageTemplateMaintenance, savePreparedPackageTemplateMaintenance } from '@/lib/packageTemplateMaintenance';
import { packageTemplateInstanceKey } from '@/lib/packageConditionalState';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { maintenanceFixture } from '../_helpers/packageTemplateMaintenance';
import { useUIStore } from '@/stores/uiStore';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });

const scenario = (subject = 'Synthetic subject') => ({ name: subject, answers: { version: 1 as const, values: { subject }, groups: {} }, expectedMembers: [packageTemplateInstanceKey('main')] });
beforeEach(async () => {
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  useUIStore.setState({ storageHealth: 'ok' }); await createActionPackage('Initialize');
  const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); });
  await new Promise<void>(resolve => { const tx = db.transaction([...db.objectStoreNames], 'readwrite'); for (const name of db.objectStoreNames) tx.objectStore(name).clear(); tx.oncomplete = () => resolve(); }); db.close();
});
afterEach(() => vi.restoreAllMocks());
it('validates real generated intake without storage writes, then saves a separate template without sample answers', async () => {
  const template = maintenanceFixture(), preview = await preparePackageTemplateMaintenance(template, [scenario()], policy);
  expect(preview.ready).toBe(true); expect(await listActionPackages()).toEqual([]); expect(await listPackageTemplates()).toEqual([]);
  template.members[0].label = 'Caller mutation';
  const saved = await savePreparedPackageTemplateMaintenance(preview, policy, true);
  expect(saved.id).not.toBe(template.id); expect(saved.members[0].label).toBe('Synthetic letter'); expect(saved.program.revision).toBe('2');
  expect(JSON.stringify(saved)).not.toContain('Synthetic subject'); expect(await listActionPackages()).toEqual([]); expect(await listPackageTemplates()).toEqual([saved]);
  await expect(savePreparedPackageTemplateMaintenance(preview, policy, true)).rejects.toThrow('Validate complete');
});
it('requires complete scenarios, independent expected membership and both outcomes of conditions', async () => {
  const template = maintenanceFixture(); template.program.questions.push({ id: 'optional', label: 'Extra letter?', kind: 'boolean', required: true });
  template.members.push({ ...structuredClone(template.members[0]), key: 'extra', role: 'supporting-document', when: { op: 'equals', questionId: 'optional', value: true } });
  const off = { ...scenario('Without extra'), answers: { version: 1 as const, values: { subject: 'Without extra', optional: false }, groups: {} } };
  const on = { ...scenario('With extra'), answers: { version: 1 as const, values: { subject: 'With extra', optional: true }, groups: {} }, expectedMembers: [packageTemplateInstanceKey('main'), packageTemplateInstanceKey('extra')] };
  expect((await preparePackageTemplateMaintenance(template, [], policy)).ready).toBe(false);
  expect((await preparePackageTemplateMaintenance(template, [off], policy)).issues.join(' ')).toContain('both outcomes');
  expect((await preparePackageTemplateMaintenance(template, [off, { ...on, expectedMembers: [] }], policy)).ready).toBe(false);
  const ready = await preparePackageTemplateMaintenance(template, [off, on], policy); expect(ready.ready).toBe(true);
  await expect(savePreparedPackageTemplateMaintenance(ready, policy, false)).rejects.toThrow('review');
});
it('rejects unqualified mappings, hidden high markings, changed policy, cancellation and stale ownership', async () => {
  const bad = maintenanceFixture(); if (bad.members[0].kind === 'native') (bad.members[0].draft.formData as Record<string, unknown>).subject = 'Prior person';
  await expect(preparePackageTemplateMaintenance(bad, [scenario()], policy)).rejects.toThrow('must be empty');
  const marked = maintenanceFixture(); marked.name = '(S) Synthetic template'; await expect(preparePackageTemplateMaintenance(marked, [scenario()], policy)).rejects.toThrow('configured levels');
  const preview = await preparePackageTemplateMaintenance(maintenanceFixture(), [scenario()], policy), controller = new AbortController(); controller.abort();
  await expect(savePreparedPackageTemplateMaintenance(preview, policy, true, controller.signal)).rejects.toThrow();
  await expect(savePreparedPackageTemplateMaintenance(preview, policy, true, undefined, () => false)).rejects.toThrow('no longer current');
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } }));
  await expect(savePreparedPackageTemplateMaintenance(preview, policy, true)).rejects.toThrow('Deployment'); expect(await listPackageTemplates()).toEqual([]);
});

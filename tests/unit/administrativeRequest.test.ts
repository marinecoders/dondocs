import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { prepareAdministrativeRequest, createPreparedAdministrativeRequest } from '@/lib/administrativeRequest';
import { getPackageRevision, listActionPackages, createActionPackage } from '@/lib/actionPackages';
import { idbGetAllAttachments } from '@/lib/documentsDb';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { resolvePackageFieldBinding } from '@/lib/packageFieldBindings';
import { preparePackageUpdate, applyPreparedPackageUpdate } from '@/lib/packageUpdates';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { renderForm } from '@/services/forms/render';
import { readPackageAsset } from '@/lib/actionPackageAssets';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
const otherPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });
vi.mock('@/config/classification', async original => ({ ...await original<typeof classification>(),
  getExportDeploymentPolicy: vi.fn(), getExportDeploymentPolicySync: vi.fn(),
}));
const input = { requester: 'Alex Example', organization: 'Training Unit', recipient: 'Training Officer', subject: 'Attend training',
  requestDate: '2026-11-17', ssic: '1500', details: 'Request attendance at the local training course. This supports assigned duties.', signatureName: 'A. EXAMPLE' };

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(policy);
  vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(policy);
  await createActionPackage('Initialize');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('dondocs'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...db.objectStoreNames], 'readwrite');
    for (const name of db.objectStoreNames) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); db.close();
});

it('prepares without writes then atomically creates owned letter, worksheet, facts and qualified links', async () => {
  const source = structuredClone(input), prepared = await prepareAdministrativeRequest(source, policy);
  source.requester = 'Later caller mutation';
  expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]);
  const record = await createPreparedAdministrativeRequest(prepared, policy, true), revision = getPackageRevision(record);
  expect(record.sequence).toBe(0); expect(record.revisions).toHaveLength(1);
  expect(revision.members).toHaveLength(2); expect(revision.information?.facts).toHaveLength(7); expect(revision.bindings?.items).toHaveLength(12);
  for (const link of revision.bindings!.items) expect((await resolvePackageFieldBinding(revision, link)).state).toBe('current');
  for (const member of revision.members) {
    if (member.kind !== 'native') throw new Error('Expected native member');
    const { reviewed } = await readPackageMemberDraft(member);
    expect(reviewed.session).toEqual(member.session); expect(member.source).toBeUndefined();
    if (member.session.genericForm) {
      const pdf = await renderForm(member.session.genericForm, 'export', async (_directory, file) => new Uint8Array(await readPackageAsset(member.templates![file])));
      expect(pdf.bytes.byteLength).toBeGreaterThan(1000); expect(pdf.diagnostics).toEqual([]);
    }
  }
  const letter = revision.members[0];
  if (letter.kind !== 'native') throw new Error('Expected letter');
  expect(letter.session.formData.from).toBe(input.requester);
  expect(letter.session.formData.sigLast).toBe(input.signatureName);
  expect(letter.session.formData.signatureType).toBe('none');
  expect(JSON.stringify(letter.session.paragraphs)).not.toContain(input.requester);
  expect(JSON.stringify(letter.session)).not.toContain('john.doe');
  const portable = await parsePortableActionPackage(await buildPortableActionPackage(record));
  expect(getPackageRevision(portable.record).information).toEqual(revision.information);
  expect(getPackageRevision(portable.record).bindings).toEqual(revision.bindings);
});

it('creates independent actions and preserves prior content while applying shared updates and a local exception', async () => {
  const first = await createPreparedAdministrativeRequest(await prepareAdministrativeRequest(input, policy), policy, true);
  const secondInput = { ...input, requester: 'Blair Sample', subject: 'Second request', signatureName: 'B. SAMPLE' };
  const second = await createPreparedAdministrativeRequest(await prepareAdministrativeRequest(secondInput, policy), policy, true);
  const before = getPackageRevision(first), fresh = getPackageRevision(second);
  expect(fresh.information?.facts.map(fact => fact.id).some(id => before.information!.facts.some(fact => fact.id === id))).toBe(false);
  expect(fresh.members.some(member => before.members.some(other => other.id === member.id))).toBe(false);
  expect(JSON.stringify(second)).not.toContain(input.requester); expect(second.revisions).toHaveLength(1);
  const firstWorksheet = before.members[1], secondWorksheet = fresh.members[1];
  if (firstWorksheet.kind !== 'native' || secondWorksheet.kind !== 'native') throw new Error('Expected worksheets');
  expect(firstWorksheet.session.genericForm!.definition).toEqual(secondWorksheet.session.genericForm!.definition);
  const information = structuredClone(before.information!);
  information.facts.find(fact => fact.label === 'Request subject')!.value = 'Changed request';
  const letterLink = before.bindings!.items.find(link => link.target.kind === 'correspondence' && link.target.field === 'subject')!;
  const planned = await preparePackageUpdate(first, information, before.bindings, { [letterLink.id]: 'keep-local' }, policy);
  const { record } = await applyPreparedPackageUpdate(planned, policy, true);
  const changed = getPackageRevision(record);
  expect(record.revisions[0]).toEqual(before);
  expect(changed.bindings!.items.find(link => link.id === letterLink.id)?.mode).toBe('override');
  const letter = changed.members[0], worksheet = changed.members[1];
  if (letter.kind !== 'native' || worksheet.kind !== 'native') throw new Error('Expected native members');
  expect(letter.session.formData.subject).toBe(input.subject.toUpperCase());
  expect(worksheet.session.genericForm?.answers.subject).toBe('Changed request');
  const again = structuredClone(changed.information!);
  again.facts.find(fact => fact.label === 'Request subject')!.value = 'Later shared subject';
  const next = await applyPreparedPackageUpdate(await preparePackageUpdate(record, again, changed.bindings, {}, policy), policy, true);
  const latest = getPackageRevision(next.record), laterLetter = latest.members[0], laterWorksheet = latest.members[1];
  if (laterLetter.kind !== 'native' || laterWorksheet.kind !== 'native') throw new Error('Expected native members');
  expect(laterLetter.session.formData.subject).toBe(input.subject.toUpperCase());
  expect(laterWorksheet.session.genericForm?.answers.subject).toBe('Later shared subject');
  const portable = await parsePortableActionPackage(await buildPortableActionPackage(next.record));
  expect(getPackageRevision(portable.record).bindings).toEqual(latest.bindings);
  expect((await listActionPackages()).find(record => record.id === second.id)).toEqual(second);
});

it('refuses invalid print content, forged review, cancelled/stale intake and deployment changes without storage writes', async () => {
  await expect(prepareAdministrativeRequest({ ...input, requestDate: '2026-02-30' }, policy)).rejects.toThrow();
  await expect(prepareAdministrativeRequest({ ...input, requester: '😀' }, policy)).rejects.toThrow(/cannot print/);
  const prepared = await prepareAdministrativeRequest(input, policy);
  await expect(createPreparedAdministrativeRequest({ ...prepared }, policy, true)).rejects.toThrow(/Prepare and review/);
  await expect(createPreparedAdministrativeRequest(prepared, policy, false)).rejects.toThrow(/Review the request/);
  await expect(createPreparedAdministrativeRequest(prepared, policy, true, undefined, () => false)).rejects.toThrow(/details changed/);
  const controller = new AbortController(); controller.abort();
  await expect(createPreparedAdministrativeRequest(prepared, policy, true, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(otherPolicy);
  await expect(createPreparedAdministrativeRequest(prepared, policy, true)).rejects.toThrow(/Deployment settings changed/);
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(policy);
  let checks = 0;
  vi.mocked(classification.getExportDeploymentPolicySync).mockImplementation(() => ++checks > 1 ? otherPolicy : policy);
  await expect(createPreparedAdministrativeRequest(prepared, policy, true)).rejects.toThrow(/Deployment settings changed/);
  expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]);
});

it('rolls back every staged file when the initial package transaction aborts', async () => {
  const prepared = await prepareAdministrativeRequest(input, policy), put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    const result = put.apply(this, args); if (this.name === 'app') this.transaction.abort(); return result;
  });
  await expect(createPreparedAdministrativeRequest(prepared, policy, true)).rejects.toThrow(/could not be saved/);
  spy.mockRestore();
  expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]);
  const record = await createPreparedAdministrativeRequest(prepared, policy, true);
  expect(record.revisions).toHaveLength(1); expect((await listActionPackages())).toHaveLength(1);
  await expect(createPreparedAdministrativeRequest(prepared, policy, true)).rejects.toThrow(/Prepare and review/);
});

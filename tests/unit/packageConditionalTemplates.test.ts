import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { createBlankSession, type SerializedSession } from '@/stores/documentStore';
import { createActionPackage, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageTemplate, exportPackageTemplate, importPackageTemplate, instantiatePackageTemplate, listPackageTemplates,
  packageTemplatePlaceholders, restorePackageTemplates, validatePackageTemplate, validatePackageTemplateLibrary } from '@/lib/packageTemplateLibrary';
import { packageTemplateProgramText, packageTemplateV2Schema, type PackageTemplateV2 } from '@/lib/packageTemplateSchema';
import { listPackageBindingFields } from '@/lib/packageBindingTargets';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { uint8ArrayToBase64 } from '@/lib/encoding';
import { reviewPackageText } from '@/lib/actionPackageDisclosure';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { useUIStore } from '@/stores/uiStore';
import { validateBackup } from '@/lib/backupValidation';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction([...db.objectStoreNames], 'readwrite'); for (const name of db.objectStoreNames) transaction.objectStore(name).clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });db.close();
}
beforeEach(async () => { vi.restoreAllMocks(); await listActionPackages(); await clearDb(); useUIStore.setState({ storageHealth: 'ok' }); });
async function fixture(): Promise<PackageTemplateV2> {
  const session = createBlankSession();Object.assign(session.formData, { subject: '', sigFirst: '', sigMiddle: '', sigLast: '', signatureType: 'none' });
  session.paragraphs = [{ id: 'paragraph', text: 'Enter any additional request narrative in the document editor.', level: 0 }];
  const member = await capturePackageMember(captureDocumentRevision({ documentId: 'training', epoch: 0, editSequence: 1, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), 'Request letter', 'basic-letter');
  const record = await reviseActionPackage(await createActionPackage('Training'), [member]);
  const legacy = await capturePackageTemplate(record, record.currentRevisionId, 'Conditional request');
  return { ...legacy, version: 2, program: { revision: '1.0', participantGroups: [], questions: [{ id: 'subject', label: 'Request subject', kind: 'text', required: true }], requirements: [] },
    members: legacy.members.map(member => ({ ...member, key: 'letter', links: [{ questionId: 'subject', target: { kind: 'correspondence', docType: session.docType, field: 'subject' }, format: 'field' }] })) };
}
async function configured(): Promise<PackageTemplateV2> {
  const page = await fixturePage(), template = await fixture(), genericForm = fixtureInstance(); genericForm.answers = {}; genericForm.definition.pages[0].sha256 = page.sha256;
  const session: SerializedSession = { documentMode: 'compliant', documentCategory: 'forms', docType: 'standard_letter', formType: 'fixture', genericForm, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 0 };
  const fields = await listPackageBindingFields({ kind: 'native', id: 'blueprint', revisionId: 'blueprint', role: 'basic-letter', label: 'Worksheet', required: true, session,
    draft: { id: 'draft', name: 'draft.json', type: 'application/json', size: 1, sha256: '0'.repeat(64) } });
  template.members = [{ kind: 'native', key: 'letter', label: 'Worksheet', required: true, role: 'basic-letter',
    draft: { ...session, kind: 'dondocs-draft', version: 2, documentKind: 'configured-form' }, pages: { 'page1.pdf': { name: 'page1.pdf', type: 'application/pdf', data: uint8ArrayToBase64(page.bytes) } },
    links: [{ questionId: 'subject', target: fields.find(field => field.target.kind === 'configured-form' && field.target.fieldId === 'name')!.target, format: 'field' }] }];
  return template;
}

it('keeps legacy version 1 capture and transfer byte-for-byte unchanged', async () => {
  const conditional = await fixture(), stored = (await listPackageTemplates())[0];
  expect(stored.version).toBe(1); expect('program' in stored).toBe(false);
  const exported = await exportPackageTemplate(stored); expect(JSON.parse(exported)).toEqual(stored);
  expect(await validatePackageTemplate(JSON.parse(exported))).toEqual(stored);
  expect(packageTemplatePlaceholders(conditional)).toEqual([]);
});
it('imports, exports and recovers all conditional declarations without inventing answers', async () => {
  const template = await fixture(), json = await exportPackageTemplate(template), imported = await importPackageTemplate(json);
  expect(imported.version).toBe(2); expect(imported).toMatchObject({ program: template.program, members: template.members });
  expect(imported.id).not.toBe(template.id);
  const snapshots = await validatePackageTemplateLibrary(await listPackageTemplates());validateBackup({ packageTemplates: snapshots });
  await clearDb();expect(await restorePackageTemplates(snapshots)).toBe(snapshots.length);
  expect(await listPackageTemplates()).toEqual(snapshots);
  expect(JSON.stringify(imported)).not.toContain('"answers":');
});
it('round-trips exact configured blueprint definitions and page bytes through library recovery', async () => {
  const template = await configured(), imported = await importPackageTemplate(await exportPackageTemplate(template));
  const retained = imported.members[0]; expect(retained).toMatchObject({ draft: template.members[0].kind === 'native' ? template.members[0].draft : undefined });
  await clearDb(); expect(await restorePackageTemplates([imported])).toBe(1);
  const restored = (await listPackageTemplates())[0];expect(restored).toEqual(imported);
  expect(restored.members[0].kind === 'native' && restored.members[0].pages).toEqual(template.members[0].kind === 'native' ? template.members[0].pages : {});
});
it('keeps version 2 unavailable to the legacy placeholder creation path without any storage changes', async () => {
  const template = await fixture(), before = await listActionPackages();
  await expect(instantiatePackageTemplate(template, 'No legacy creation', {}, {})).rejects.toThrow(/conditional intake/);
  expect(await listActionPackages()).toEqual(before);
});
it('rejects populated linked values, unsafe target paths and printed signer names', async () => {
  const template = await fixture(), member = template.members[0];if(member.kind !== 'native') throw new Error('Expected native');
  const form = member.draft.formData as Record<string, unknown>;form.subject = 'Previous person';await expect(validatePackageTemplate(template)).rejects.toThrow(/must be empty/);
  form.subject = '';form.sigLast = 'Previous signer';await expect(validatePackageTemplate(template)).rejects.toThrow(/printed signature/);
  form.sigLast = '';const invalid = structuredClone(template) as unknown as Record<string, unknown>;
  (invalid.members as Array<{links:Array<{target:unknown}>}>)[0].links[0].target = { kind: 'correspondence', docType: 'naval_letter', field: 'sigLast' };
  expect(() => packageTemplateV2Schema.parse(invalid)).toThrow();
});
it('qualifies pinned configured fields and every choice option, rejecting changed definitions and nonempty false', async () => {
  const template = await configured();expect((await validatePackageTemplate(template)).version).toBe(2);
  const member = template.members[0];if(member.kind !== 'native') throw new Error('Expected native');
  const form = member.draft.genericForm as ReturnType<typeof fixtureInstance>;
  form.definition.fields.name.label = 'Changed definition';await expect(validatePackageTemplate(template)).rejects.toThrow(/unavailable/);
  const boolean = await configured(), native = boolean.members[0];if(native.kind !== 'native') throw new Error('Expected native');
  const instance = native.draft.genericForm as ReturnType<typeof fixtureInstance>;
  const session = { ...native.draft } as unknown as SerializedSession;
  const fields = await listPackageBindingFields({ kind: 'native', id: 'b', revisionId: 'b', label: 'B', required: true, role: 'basic-letter', session, draft: { id: 'a', name: 'a', size: 1, type: 'application/json', sha256: '0'.repeat(64) } });
  boolean.program.questions = [{ id: 'flag', label: 'Flag', kind: 'boolean', required: true }];
  native.links = [{ questionId: 'flag', target: fields.find(field => field.target.kind === 'configured-form' && field.target.fieldId === 'a')!.target, format: 'field' }];
  instance.answers.a = false;await expect(validatePackageTemplate(boolean)).rejects.toThrow(/must be empty/);delete instance.answers.a;
  expect((await validatePackageTemplate(boolean)).version).toBe(2);
  boolean.program.questions = [{ id: 'decision', label: 'Decision', kind: 'choice', required: true, options: [{ id: 'yes', label: 'Yes' }, { id: 'invalid', label: 'Invalid' }] }];
  native.links = [{ questionId: 'decision', target: fields.find(field => field.target.kind === 'configured-form' && field.target.fieldId === 'decision')!.target, format: 'field' }];
  await expect(validatePackageTemplate(boolean)).rejects.toThrow(/defined by this form/);
});
it('rejects placeholders in hidden drafts and branch declarations and enforces one fixed main document', async () => {
  const template = await fixture(), native = template.members[0];if(native.kind !== 'native') throw new Error('Expected native');
  (native.draft.paragraphs as Array<{text:string}>)[0].text = 'Prior {{PERSON}}';await expect(validatePackageTemplate(template)).rejects.toThrow(/placeholder substitution/);
  const ambiguous = await fixture();ambiguous.members[0].when = { op: 'answered', questionId: 'subject' };expect(() => packageTemplateV2Schema.parse(ambiguous)).toThrow(/unconditional/);
  delete ambiguous.members[0].when;ambiguous.members.push({ ...ambiguous.members[0], key: 'other' });expect(() => packageTemplateV2Schema.parse(ambiguous)).toThrow(/exactly one/);
});
it('reviews inactive branch literals and new declaration metadata for transfer handling', async () => {
  const template = await fixture();template.program.questions.push({ id: 'branch', label: 'Routing branch', kind: 'text', required: false });
  template.program.requirements = [{ id: 'restricted', label: 'Supporting evidence', kind: 'document', operations: ['portable'], when: { op: 'equals', questionId: 'branch', value: 'SECRET' } }];
  const validated = await validatePackageTemplate(template), text = packageTemplateProgramText(validated);
  expect(text).toContain('SECRET');expect(text).toContain('portable');
  const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
  expect(() => reviewPackageText(text, 'All template declarations', policy)).toThrow(/outside.*configured levels/);
});

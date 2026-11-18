import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { maintenanceFixture } from '../_helpers/packageTemplateMaintenance';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { prepareConditionalPackage, applyPreparedConditionalPackage, prepareConditionalTemplateUpgrade, readConditionalPackageTemplate } from '@/lib/packageConditional';
import { applyPackageDefinitionUpgrade, preparePackageDefinitionUpgrade } from '@/lib/packageDefinitionUpgrades';
import { getPackageRevision, createActionPackage, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { updatePackageRequirements } from '@/lib/packageRequirements';
import { captureOriginalPackageMember, readPackageAsset, readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { updatePackageInformation } from '@/lib/packageInformation';
import { listPackageBindingFields } from '@/lib/packageBindingTargets';
import { uint8ArrayToBase64 } from '@/lib/encoding';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { useUIStore } from '@/stores/uiStore';
import type { SerializedSession } from '@/stores/documentStore';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(async () => {
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy); useUIStore.setState({ storageHealth: 'ok' });
  await createActionPackage('Initialize'); const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); });
  await new Promise<void>(resolve => { const tx = db.transaction([...db.objectStoreNames], 'readwrite'); for (const name of db.objectStoreNames) tx.objectStore(name).clear(); tx.oncomplete = () => resolve(); }); db.close();
});
afterEach(() => vi.restoreAllMocks());
async function action() {
  const template = maintenanceFixture(); template.program.questions.push({ id: 'retired', label: 'Prior answer', kind: 'text', required: false });
  if (template.members[0].kind === 'native') template.members[0].draft.paragraphs = [{ id: 'preserved-body', text: 'PRESERVE CURRENT DOCUMENT TEXT', level: 0 }];
  const answers = { version: 1 as const, values: { subject: 'Synthetic subject', retired: 'Keep this old answer' }, groups: {} };
  const record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template, answers, name: 'Synthetic upgrade action' }, policy), policy, true)).record;
  const target = structuredClone(template); target.id = 'synthetic_new_template'; target.program.revision = '3'; target.program.questions = target.program.questions.filter(item => item.id !== 'retired');
  target.members.push({ ...structuredClone(target.members[0]), key: 'added', label: 'New supporting letter', role: 'supporting-document' });
  if (target.members[0].kind === 'native') target.members[0].draft.paragraphs = [{ id: 'new-starter', text: 'NEW STARTER MUST NOT OVERWRITE CURRENT WORK', level: 0 }];
  return { template, record, target, answers: { version: 1 as const, values: { subject: 'Synthetic subject' }, groups: {} }, questionMappings: { subject: 'subject', retired: null }, memberMappings: { main: 'main' } };
}
it('adopts template membership while preserving exact existing documents, original bytes and unmapped answers portably', async () => {
  const setup = await action(), pdf = await PDFDocument.create(); pdf.addPage([400, 600]);
  const original = await captureOriginalPackageMember({ name: 'Synthetic signed original.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'supporting-document', true);
  const record = await reviseActionPackage(setup.record, [...getPackageRevision(setup.record).members, original]), before = getPackageRevision(record), main = before.members[0];
  const prepared = await prepareConditionalTemplateUpgrade({ ...setup, record, template: setup.target, preserveUnmapped: true }, policy);
  expect(prepared.ready).toBe(true); expect(prepared.upgrade.preservedAnswers).toBe(1); expect((await listActionPackages())[0]).toEqual(record);
  const saved = (await applyPreparedConditionalPackage(prepared, policy, true)).record, current = getPackageRevision(saved);
  expect(current.members).toHaveLength(3); expect(current.members.find(item => item.id === main.id)).toEqual(main); expect(current.members.find(item => item.id === original.id)).toEqual(original);
  expect(current.templateState!.upgrades![0].answers.values.retired).toBe('Keep this old answer'); expect(saved.revisions.slice(0, -1)).toEqual(record.revisions);
  const imported = await parsePortableActionPackage(await buildPortableActionPackage(saved));
  expect((await readConditionalPackageTemplate(imported.record)).program.revision).toBe('3'); expect(getPackageRevision(imported.record).templateState!.upgrades![0].answers.values.retired).toBe('Keep this old answer');
  if (original.kind !== 'original') throw new Error('Original expected');
  expect(await readPackageAsset(original.original)).toEqual(new Uint8Array(await pdf.save()).buffer);
});
it('retains newer package values and requires explicit, compatible mappings without writes on failure', async () => {
  const setup = await action(), information = structuredClone(getPackageRevision(setup.record).information!); information.facts.find(item => item.label === 'Subject')!.value = 'NEWER SUBJECT';
  const record = await updatePackageInformation(setup.record, information), input = { ...setup, record, template: setup.target, preserveUnmapped: true };
  await expect(prepareConditionalTemplateUpgrade({ ...input, preserveUnmapped: false }, policy)).rejects.toThrow('Explicitly preserve');
  await expect(prepareConditionalTemplateUpgrade({ ...input, memberMappings: {} }, policy)).rejects.toThrow('every source');
  const preview = await prepareConditionalTemplateUpgrade(input, policy);
  expect(preview.ready).toBe(true); const saved = (await applyPreparedConditionalPackage(preview, policy, true)).record;
  const current = getPackageRevision(saved), member = current.members[0];
  expect(current.information!.facts.find(item => item.label === 'Subject')!.value).toBe('NEWER SUBJECT');
  expect(member.kind === 'native' && member.session.formData.subject).toBe('SYNTHETIC SUBJECT');
});
it('retains prior requirement decisions in the receipt and requires fresh confirmation for the new template', async () => {
  const template = maintenanceFixture(); template.program.requirements.push({ id: 'coordination', label: 'Coordination confirmed', kind: 'confirmation', operations: ['review'] });
  const answers = { version: 1 as const, values: { subject: 'Synthetic subject' }, groups: {} };
  const initial = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template, answers, name: 'Synthetic requirements upgrade' }, policy), policy, true)).record;
  const requirements = getPackageRevision(initial).requirements!; const confirmation = requirements.items.find(item => item.kind === 'confirmation')!;
  if (confirmation.kind !== 'confirmation') throw new Error('Confirmation expected'); confirmation.confirmed = true;
  const record = await updatePackageRequirements(initial, requirements, policy), target = structuredClone(template); target.program.revision = '3';
  const preview = await prepareConditionalTemplateUpgrade({ record, template: target, answers, questionMappings: { subject: 'subject' }, memberMappings: { main: 'main' }, preserveUnmapped: true }, policy);
  const saved = (await applyPreparedConditionalPackage(preview, policy, true)).record, current = getPackageRevision(saved);
  expect(current.templateState!.upgrades![0].requirements!.items).toContainEqual(confirmation);
  expect(current.requirements!.items.find(item => item.kind === 'confirmation')).toMatchObject({ kind: 'confirmation', label: 'Coordination confirmed' });
  expect(current.requirements!.items.find(item => item.kind === 'confirmation')).not.toHaveProperty('confirmed');
});
it('rejects stale/cancelled template adoption and disclosure violations before an atomic commit', async () => {
  const setup = await action(), input = { ...setup, template: setup.target, preserveUnmapped: true };
  const prepared = await prepareConditionalTemplateUpgrade(input, policy), controller = new AbortController(); controller.abort();
  await expect(applyPreparedConditionalPackage(prepared, policy, true, controller.signal)).rejects.toThrow();
  const newer = await reviseActionPackage(setup.record, getPackageRevision(setup.record).members);
  await expect(applyPreparedConditionalPackage(prepared, policy, true)).rejects.toThrow('changed'); expect((await listActionPackages())[0]).toEqual(newer);
  const marked = structuredClone(setup.target); marked.name = '(S) Synthetic higher marking';
  await expect(prepareConditionalTemplateUpgrade({ ...input, record: newer, template: marked }, policy)).rejects.toThrow('configured levels');
});
async function formAction() {
  const template = maintenanceFixture(), page = await fixturePage(), instance = fixtureInstance(); instance.answers = {}; instance.definition.pages[0].sha256 = page.sha256;
  const session = { documentMode: 'compliant', documentCategory: 'forms', docType: 'standard_letter', formType: 'fixture', genericForm: instance, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {}, timestamp: 0 } as SerializedSession;
  const fields = await listPackageBindingFields({ kind: 'native', id: 'synthetic', revisionId: 'synthetic', role: 'basic-letter', label: 'Worksheet', required: true, session,
    draft: { id: 'synthetic', name: 's.json', type: 'application/json', size: 1, sha256: '0'.repeat(64) } });
  template.members = [{ kind: 'native', key: 'main', label: 'Synthetic form', role: 'basic-letter', required: true, draft: { ...session, kind: 'dondocs-draft', version: 2, documentKind: 'configured-form' },
    pages: { 'page1.pdf': { name: 'page1.pdf', type: 'application/pdf', data: uint8ArrayToBase64(page.bytes) } }, links: [{ questionId: 'subject', target: fields.find(item => item.target.kind === 'configured-form' && item.target.fieldId === 'name')!.target, format: 'field' }] }];
  const record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template, name: 'Synthetic form action', answers: { version: 1, values: { subject: '000123' }, groups: {} } }, policy), policy, true)).record;
  const target = structuredClone(template); target.id = 'synthetic_form_v2'; target.program.revision = '3';
  if (target.members[0].kind !== 'native') throw new Error('Native expected');
  const next = target.members[0].draft.genericForm as typeof instance; next.definition.definitionRevision = '2'; next.definition.fields.name.label = 'Updated name label'; target.members[0].links = [];
  return { record, target, member: getPackageRevision(record).members[0], migration: { from: instance.definition.definitionRevision, to: '2', fields: { name: 'name', decision: 'decision' } }, bindingId: getPackageRevision(record).bindings!.items[0].id };
}
it('migrates an exact configured definition and qualified links separately, preserving older captures and page bytes', async () => {
  const { record, target, member, migration, bindingId } = await formAction();
  const preview = await preparePackageDefinitionUpgrade(record, member.id, target, 'main', migration, { [bindingId]: 'remap' }, false, policy);
  const saved = await applyPackageDefinitionUpgrade(preview, policy, true), current = getPackageRevision(saved), updated = current.members[0];
  expect(updated.kind === 'native' && updated.session.genericForm!.definition.definitionRevision).toBe('2');
  expect(updated.kind === 'native' && updated.session.genericForm!.answers.name).toBe('000123'); expect(saved.revisions.slice(0, -1)).toEqual(record.revisions);
  expect(current.bindings!.items[0].target).toMatchObject({ definitionRevision: '2', fieldId: 'name' });
  expect(current.templateState!.templateRevision).toBe('2');
  await expect(parsePortableActionPackage(await buildPortableActionPackage(saved))).resolves.toBeDefined();
  if (member.kind !== 'native' || updated.kind !== 'native') throw new Error('Native expected');
  expect(await readPackageAsset(updated.templates!['page1.pdf'])).toEqual(await readPackageAsset(member.templates!['page1.pdf']));
  expect((await readPackageMemberDraft(member)).draft).not.toEqual((await readPackageMemberDraft(updated)).draft);
});
it('refuses unmapped answers and undecided links, and fences changed policy or newer work for definition upgrades', async () => {
  const { record, target, member, migration, bindingId } = await formAction();
  await expect(preparePackageDefinitionUpgrade(record, member.id, target, 'main', { ...migration, fields: {} }, { [bindingId]: 'detach' }, false, policy)).rejects.toThrow('Missing or ambiguous');
  await expect(preparePackageDefinitionUpgrade(record, member.id, target, 'main', migration, {}, false, policy)).rejects.toThrow('every affected');
  const preview = await preparePackageDefinitionUpgrade(record, member.id, target, 'main', migration, { [bindingId]: 'override' }, false, policy);
  await expect(applyPackageDefinitionUpgrade(preview, policy, false)).rejects.toThrow('Review');
  const newer = await reviseActionPackage(record, getPackageRevision(record).members); await expect(applyPackageDefinitionUpgrade(preview, policy, true)).rejects.toThrow('package changed');
  expect((await listActionPackages())[0]).toEqual(newer);
});
it('does not allow retained upgrade answers to change under an existing archive identity', async () => {
  const { actionPackageSchema } = await import('@/lib/actionPackages');
  const setup = await action();
  const prepared = await prepareConditionalTemplateUpgrade({ ...setup, record: setup.record, template: setup.target, preserveUnmapped: true }, policy);
  const adopted = (await applyPreparedConditionalPackage(prepared, policy, true)).record;
  const child = await reviseActionPackage(adopted, getPackageRevision(adopted).members);
  const changed = structuredClone(child), current = changed.revisions.find(revision => revision.id === changed.currentRevisionId)!;
  current.templateState!.upgrades![0].answers.values.retired = 'Changed historical answer under the same archive identity';
  expect(actionPackageSchema.safeParse(changed).success).toBe(false);
});
it('preserves stable repeating row identities, row order and explicit local bindings through a group migration', async () => {
  const { retainPackageAsset } = await import('@/lib/actionPackageAssets');
  const { validatePackageDraft } = await import('@/lib/actionPackageDraft');
  const { commitActionPackage, newPackageId } = await import('@/lib/actionPackages');
  const setup = await formAction(); if (setup.member.kind !== 'native') throw new Error('Native fixture expected');
  const original = await readPackageMemberDraft(setup.member), draft = structuredClone(original.draft) as Record<string, unknown>;
  const instance = structuredClone(setup.member.session.genericForm!);
  instance.rows.roster = [{ id: 'stable-second', answers: { grade: 'e2', date: '2026-11-18' } }, { id: 'stable-first', answers: { grade: 'e1', date: '2026-11-17' } }];
  draft.genericForm = instance;
  const parsed = await validatePackageDraft(draft), savedAsset = await retainPackageAsset(setup.member.draft.name, 'application/json', new TextEncoder().encode(JSON.stringify(draft)).buffer);
  let record = await reviseActionPackage(setup.record, [{ ...setup.member, revisionId: newPackageId('member-revision'), session: parsed.session, draft: savedAsset }]);
  const current = getPackageRevision(record), member = current.members[0];
  const field = (await listPackageBindingFields(member)).find(field => field.target.kind === 'configured-form' && field.target.row?.rowId === 'stable-second' && field.target.fieldId === 'grade')!;
  const revision = { ...current, id: newPackageId('revision'), parentId: current.id, createdAt: Date.now(), outputs: [], information: { ...current.information!, facts: [...current.information!.facts, { id: 'row-fact', label: 'Independent row grade', kind: 'text' as const, value: 'e1', source: { kind: 'entered' as const } }] },
    bindings: { version: 1 as const, items: [...current.bindings!.items, { id: 'row-link', memberId: member.id, factId: 'row-fact', target: field.target, expectedValue: 'e2', mode: 'override' as const, format: 'field' as const }] } };
  record = await commitActionPackage(record, { ...record, sequence: record.sequence + 1, currentRevisionId: revision.id, revisions: [...record.revisions, revision] });
  const target = structuredClone(setup.target); if (target.members[0].kind !== 'native') throw new Error('Native target expected');
  const next = target.members[0].draft.genericForm as typeof instance;
  next.definition.rowGroups.migrated = next.definition.rowGroups.roster; delete next.definition.rowGroups.roster;
  const migration = { ...setup.migration, rowGroups: { roster: { to: 'migrated', columns: { grade: 'grade', date: 'date' } } } };
  const prepared = await preparePackageDefinitionUpgrade(record, member.id, target, 'main', migration, { [setup.bindingId]: 'remap', 'row-link': 'override' }, false, policy);
  const saved = await applyPackageDefinitionUpgrade(prepared, policy, true), updated = getPackageRevision(saved).members[0]; if (updated.kind !== 'native') throw new Error('Native result expected');
  expect(updated.session.genericForm!.rows.migrated).toEqual(instance.rows.roster);
  expect(getPackageRevision(saved).bindings!.items.find(binding => binding.id === 'row-link')).toMatchObject({ mode: 'override', expectedValue: 'e2', target: { row: { groupId: 'migrated', rowId: 'stable-second' }, fieldId: 'grade' } });
  expect((await parsePortableActionPackage(await buildPortableActionPackage(saved))).record.currentRevisionId).toBe(saved.currentRevisionId);
});

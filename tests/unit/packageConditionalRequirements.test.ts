import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createBlankSession } from '@/stores/documentStore';
import { prepareConditionalPackage, applyPreparedConditionalPackage, saveConditionalPackageDraft } from '@/lib/packageConditional';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';
import type { PackageTemplateAnswers } from '@/lib/packageTemplateProgram';
import { getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { buildPortableActionPackage, parsePortableActionPackage, validateActionPackageResources } from '@/lib/actionPackageTransfer';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { captureLegacyConditionalRequirementIds, resolveConditionalPackageRequirements } from '@/lib/packageConditionalRequirements';
import { inspectPackageRequirements, updatePackageRequirements } from '@/lib/packageRequirements';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
const { currentPolicy } = vi.hoisted(() => ({ currentPolicy: { value: undefined as unknown } }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy.value, getExportDeploymentPolicySync: () => currentPolicy.value }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(() => { currentPolicy.value = policy; });
function template(): PackageTemplateV2 {
  const session = createBlankSession(undefined, 'standard_letter');
  session.formData = { ...session.formData, signatureType: 'none', subject: '', sigFirst: '', sigMiddle: '', sigLast: '', classLevel: 'unclassified' };
  return { kind: 'dondocs-package-template', version: 2, id: `evidence-${crypto.randomUUID()}`, name: 'Synthetic evidence action', createdAt: 0,
    program: { revision: '1', questions: [{ id: 'subject', label: 'Subject', kind: 'text', required: true }, { id: 'needsEvidence', label: 'Evidence needed', kind: 'boolean', required: true }], participantGroups: [],
      requirements: [{ id: 'external-evidence', label: 'External evidence', kind: 'document', operations: ['pdf'], when: { op: 'equals', questionId: 'needsEvidence', value: true } },
        { id: 'source-check', label: 'Source checked', kind: 'confirmation', operations: ['review', 'pdf'], when: { op: 'equals', questionId: 'needsEvidence', value: true } }] },
    members: [{ key: 'main', kind: 'native', label: 'Main letter', role: 'basic-letter', required: true,
      draft: { ...session, timestamp: 0, kind: 'dondocs-draft', version: 2, documentKind: 'correspondence' }, pages: {},
      links: [{ questionId: 'subject', target: { kind: 'correspondence', docType: 'standard_letter', field: 'subject' }, format: 'field' }] }] };
}
function answers(needsEvidence: boolean): PackageTemplateAnswers { return { version: 1, values: { subject: 'SYNTHETIC EVIDENCE ACTION', needsEvidence }, groups: {} }; }
async function create(needsEvidence = true) {
  const source = template(), plan = await prepareConditionalPackage({ template: source, answers: answers(needsEvidence) }, policy);
  expect(plan.issues).toEqual([]);
  return { source, record: (await applyPreparedConditionalPackage(plan, policy, true)).record };
}
it('materializes actual and missing document slots without placeholder members, with separate operation checks', async () => {
  const { record } = await create(), revision = getPackageRevision(record);
  expect(revision.members).toHaveLength(1);
  expect(revision.requirements?.items.find(item => item.definitionId === 'external-evidence')).toMatchObject({ kind: 'document', condition: 'active', operations: ['pdf'] });
  expect(revision.requirements?.items.find(item => item.definitionId === 'external-evidence')).not.toHaveProperty('memberId');
  expect((await inspectPackageRequirements(revision, 'pdf')).ready).toBe(false);
  expect((await inspectPackageRequirements(revision, 'portable')).ready).toBe(true);
  const parsed = await parsePortableActionPackage(await buildPortableActionPackage(record));
  expect(getPackageRevision(parsed.record).requirements).toEqual(revision.requirements);
});
it('retains explicit evidence and user confirmation across inactive/reactivated branches', async () => {
  const created = await create(), pdf = await PDFDocument.create(); pdf.addPage();
  const original = await captureOriginalPackageMember({ name: 'synthetic-proof.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'supporting-document', false);
  let record = await reviseActionPackage(created.record, [...getPackageRevision(created.record).members, original]);
  const reqs = structuredClone(getPackageRevision(record).requirements!);
  for (const item of reqs.items) {
    if (item.kind === 'document' && item.definitionId === 'external-evidence') item.memberId = original.id;
    if (item.kind === 'confirmation') item.confirmed = true;
  }
  record = await updatePackageRequirements(record, reqs, policy);
  const inactive = await prepareConditionalPackage({ template: created.source, answers: answers(false), record }, policy);
  expect(inactive.issues).toEqual([]);
  record = (await applyPreparedConditionalPackage(inactive, policy, true)).record;
  expect(getPackageRevision(record).members.some(member => member.id === original.id)).toBe(true);
  expect(getPackageRevision(record).requirements?.items.find(item => item.definitionId === 'external-evidence')).toMatchObject({ memberId: original.id, condition: 'inactive' });
  const active = await prepareConditionalPackage({ template: created.source, answers: answers(true), record }, policy);
  expect(active.issues).toEqual([]);
  record = (await applyPreparedConditionalPackage(active, policy, true)).record;
  expect((await inspectPackageRequirements(getPackageRevision(record), 'pdf')).ready).toBe(true);
});
it('rejects forged declaration changes, derives legacy omitted metadata and never lets omission bypass missing evidence', async () => {
  const { record } = await create(), revision = getPackageRevision(record), forged = structuredClone(record);
  const target = forged.revisions.find(item => item.id === forged.currentRevisionId)!.requirements!.items.find(item => item.definitionId === 'external-evidence')!; target.condition = 'inactive';
  await expect(inspectPackageRequirements(getPackageRevision(forged), 'pdf')).rejects.toThrow('do not match');
  await expect(validateActionPackageResources(forged, readPackageAsset)).rejects.toThrow('do not match');
  const legacy = structuredClone(revision); delete legacy.requirements;
  expect((await inspectPackageRequirements(legacy, 'pdf')).ready).toBe(false);
  expect((await inspectPackageRequirements(legacy, 'pdf')).items.some(item => item.label === 'External evidence' && item.state === 'missing')).toBe(true);
});
it('saves and transfers unfinished intake with unknown PDF criteria, while review remains blocked', async () => {
  const source = template(), record = await saveConditionalPackageDraft({ template: source, name: 'Unfinished synthetic evidence', answers: { version: 1, values: { subject: 'In progress' }, groups: {} } }, policy);
  const revision = getPackageRevision(record);
  expect(revision.members).toHaveLength(0); expect(revision.templateState?.pending).toBe(true);
  expect(revision.requirements?.items.some(item => item.condition === 'unknown')).toBe(true);
  await expect(startPackageReview(record)).rejects.toThrow();
  const parsed = await parsePortableActionPackage(await buildPortableActionPackage(record));
  expect(getPackageRevision(parsed.record).requirements).toEqual(revision.requirements);
  expect((await inspectPackageRequirements(getPackageRevision(parsed.record), 'portable')).ready).toBe(true);
});
it('recognizes saved intake people before information is applied without treating confirmations as approval', async () => {
  const source = template();
  source.program.participantGroups = [{ id: 'people', label: 'People', role: 'subject', min: 0, max: 5 }];
  source.program.requirements = [{ id: 'person-declaration', label: 'Source seen', kind: 'confirmation', repeatGroupId: 'people', operations: ['portable'] }];
  const record = await saveConditionalPackageDraft({ template: source, answers: { version: 1, values: {}, groups: { people: [{ id: 'person-one', label: 'Synthetic intake person', answers: {} }] } } }, policy);
  expect(getPackageRevision(record).information?.participants ?? []).toEqual([]);
  const reqs = structuredClone(getPackageRevision(record).requirements!);
  reqs.items = reqs.items.map(item => item.kind === 'confirmation' ? { ...item, confirmed: true } : item);
  const saved = await updatePackageRequirements(record, reqs, policy);
  const inspected = await inspectPackageRequirements(getPackageRevision(saved), 'portable');
  expect(inspected.ready).toBe(true); expect(inspected.items.find(item => item.kind === 'confirmation')?.message).toContain('not an approval');
});


it('keeps already reserved identities when first saving legacy requirement metadata', async () => {
  const { record } = await create(), legacy = getPackageRevision(record); delete legacy.requirements;
  const effective = (await resolveConditionalPackageRequirements(legacy))!;
  const changed = structuredClone(effective); changed.items[0].id = 'changed-existing-requirement';
  await expect(captureLegacyConditionalRequirementIds(legacy, changed)).rejects.toThrow('identity changed');
});

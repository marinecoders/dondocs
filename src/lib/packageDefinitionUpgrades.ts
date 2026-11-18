import { z } from 'zod';
import { actionPackageSchema, getPackageRevision, commitActionPackage, listActionPackages, newPackageId, type ActionPackage, type PackageAsset } from './actionPackages';
import { readPackageMemberDraft } from './actionPackageAssets';
import { validatePackageTemplate } from './packageTemplateLibrary';
import { packageTemplateV2Schema, type PackageTemplateV2 } from './packageTemplateSchema';
import { migrateForm, type FormMigration } from '@/services/forms/documents';
import { validatePackageDraft } from './actionPackageDraft';
import { base64ToUint8Array } from './encoding';
import { portableResourceDigest } from './portableResources';
import { sameReviewStoredValue, type StoredAttachment } from './documentsDb';
import { listPackageBindingFields, packageBindingTargetKey } from './packageBindingTargets';
import { formatPackageFactForField } from './packageFieldBindings';
import { comparePackageChangeImpact, type PackageChangeImpact } from './packageChangeImpact';
import { reviewPackageNative, reviewPackageOriginal, reviewPackageText } from './actionPackageDisclosure';
import { packageTemplateMaintenancePolicy } from './packageTemplateMaintenance';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { withAttachmentStaging } from './attachments';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import type { SerializedSession } from '@/stores/documentStore';
import type { Answer } from '@/services/forms/model';

const id = z.string().min(1).max(200).refine(value => !Object.hasOwn(Object.prototype, value) && value !== 'prototype');
const fields = z.record(id, id), options = z.record(id, fields);
const migrationSchema = z.object({ from: z.string().min(1).max(200), to: z.string().min(1).max(200), fields, options: options.optional(),
  rowGroups: z.record(id, z.object({ to: id, columns: fields, options: options.optional() }).strict()).optional() }).strict();
export type PackageDefinitionBindingChoice = 'detach' | 'remap' | 'override';
export interface PreparedPackageDefinitionUpgrade {
  readonly memberId: string; readonly label: string; readonly from: string; readonly to: string;
  readonly mappedAnswers: readonly { before: string; after: string; beforeValue: Answer; afterValue: Answer }[];
  readonly signatureAnswersOmitted: number; readonly bindingChoices: readonly { id: string; choice: PackageDefinitionBindingChoice }[];
  readonly reviews: readonly ExportReview[]; readonly impact: PackageChangeImpact;
}
const plans = new WeakMap<PreparedPackageDefinitionUpgrade, { before: ActionPackage; after: ActionPackage; staged: StoredAttachment[]; policy: string }>();
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

/** Upgrade only the selected configured form. Membership adoption is a separate reviewed operation. */
export async function preparePackageDefinitionUpgrade(input: ActionPackage, memberId: string, templateInput: PackageTemplateV2, blueprintKey: string,
  migrationInput: FormMigration, choicesInput: Readonly<Record<string, PackageDefinitionBindingChoice>>, preserveSignatureHistory: boolean,
  policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageDefinitionUpgrade> {
  signal?.throwIfAborted(); const key = packageTemplateMaintenancePolicy(policy);
  const before = actionPackageSchema.parse(structuredClone(input)), migration = migrationSchema.parse(structuredClone(migrationInput)), choices = structuredClone(choicesInput);
  const template = packageTemplateV2Schema.parse(await validatePackageTemplate(structuredClone(templateInput))), original = getPackageRevision(before), member = original.members.find(item => item.id === memberId);
  if (before.archived || before.reviewRounds?.some(round => round.ownerPackageId === undefined)) throw new Error('Open the current owning package before upgrading a form.');
  if (member?.kind !== 'native' || !member.session.genericForm) throw new Error('Choose a captured configured form.');
  const blueprint = template.members.find(item => item.key === blueprintKey);
  if (blueprint?.kind !== 'native') throw new Error('Choose an exact configured-form blueprint.');
  const target = (await validatePackageDraft(blueprint.draft)).session.genericForm;
  if (!target) throw new Error('The selected template member is not a configured form.');
  const source = structuredClone(member.session.genericForm);
  if (JSON.stringify(source.definition) === JSON.stringify(target.definition)) throw new Error('This exact form definition is already captured.');
  const signed = Object.entries(source.answers).filter(([field]) => source.definition.fields[field]?.kind === 'signature');
  const signedRows = Object.entries(source.rows).flatMap(([group, rows]) => rows.flatMap(row => Object.keys(row.answers).filter(field => source.definition.rowGroups[group]?.columns[field]?.kind === 'signature')));
  if ((signed.length || signedRows.length) && preserveSignatureHistory !== true) throw new Error('Explicitly preserve signature answers in history without carrying them into the upgraded form.');
  for (const [field] of signed) delete source.answers[field];
  for (const [group, rows] of Object.entries(source.rows)) for (const row of rows) for (const field of Object.keys(row.answers)) if (source.definition.rowGroups[group]?.columns[field]?.kind === 'signature') delete row.answers[field];
  const migrated = migrateForm(source, target.definition, migration);
  if (Object.keys(migrated.answers).some(field => migrated.definition.fields[field]?.kind === 'signature')
    || Object.entries(migrated.rows).some(([group, rows]) => rows.some(row => Object.keys(row.answers).some(field => migrated.definition.rowGroups[group]?.columns[field]?.kind === 'signature'))))
    throw new Error('A migration cannot carry answers into signature fields.');
  const { draft: oldDraft } = await readPackageMemberDraft(member), draft = { ...structuredClone(oldDraft as Record<string, unknown>), genericForm: migrated, timestamp: Date.now() };
  const parsed = await validatePackageDraft(draft), staged: StoredAttachment[] = [];
  const stage = async (name: string, type: string, data: ArrayBuffer): Promise<PackageAsset> => {
    if (!data.byteLength || data.byteLength > 25 * 1024 * 1024 || staged.reduce((sum, item) => sum + item.size, data.byteLength) > 64 * 1024 * 1024) throw new Error('Upgraded form files exceed supported storage limits.');
    const asset = { id: newPackageId('asset'), name, type, size: data.byteLength, sha256: await portableResourceDigest(data) }; staged.push({ ...asset, data }); return asset;
  };
  const pages: Record<string, PackageAsset> = {};
  const reviews = [reviewPackageText(`${before.name}\n${member.label}\n${JSON.stringify(migration)}\n${JSON.stringify(choices)}`, 'Form upgrade mappings and decisions', policy),
    reviewPackageNative(member.session, member.label, policy, oldDraft as unknown as SerializedSession), reviewPackageNative(parsed.session, member.label, policy, draft as unknown as SerializedSession)];
  for (const [file, page] of Object.entries(blueprint.pages)) {
    const data = new Uint8Array(base64ToUint8Array(page.data)).buffer; reviews.push(await reviewPackageOriginal(data, page.name, policy)); pages[file] = await stage(page.name, page.type, data);
  }
  const replacement = { ...structuredClone(member), revisionId: newPackageId('member-revision'), session: parsed.session, templates: pages,
    draft: await stage(member.draft.name, 'application/json', new TextEncoder().encode(JSON.stringify(draft)).buffer) };
  const qualified = await listPackageBindingFields(replacement), affected = original.bindings?.items.filter(binding => binding.memberId === member.id) ?? [];
  if (Object.keys(choices).length !== affected.length || affected.some(binding => !Object.hasOwn(choices, binding.id))
    || Object.entries(choices).some(([id, choice]) => !affected.some(binding => binding.id === id) || !['detach', 'remap', 'override'].includes(choice))) throw new Error('Choose a mapping, local override or detachment for every affected field link.');
  const bindings = original.bindings?.items.flatMap(binding => {
    if (binding.memberId !== member.id) return [structuredClone(binding)];
    const choice = choices[binding.id]; if (choice === 'detach') return [];
    if (binding.target.kind !== 'configured-form') throw new Error('Detach unsupported field links before this definition upgrade.');
    const old = binding.target, fieldId = old.row ? migration.rowGroups?.[old.row.groupId]?.columns[old.fieldId] : migration.fields[old.fieldId];
    const groupId = old.row ? migration.rowGroups?.[old.row.groupId]?.to : undefined;
    const field = qualified.find(item => item.target.kind === 'configured-form' && item.target.fieldId === fieldId
      && item.target.row?.groupId === groupId && item.target.row?.rowId === old.row?.rowId);
    if (!field) throw new Error('A linked field has no unambiguous qualified destination. Detach it explicitly or supply its mapping.');
    const fact = original.information?.facts.find(item => item.id === binding.factId);
    if (choice === 'remap' && binding.mode !== 'override' && (!fact || formatPackageFactForField(fact, field, binding.format) !== field.value))
      throw new Error('The migrated answer differs from its shared value. Preserve it as an explicit local override or detach the link.');
    return [{ ...structuredClone(binding), target: field.target, expectedValue: field.value, mode: choice === 'override' ? 'override' as const : binding.mode }];
  });
  if (bindings && new Set(bindings.map(binding => `${binding.memberId}:${packageBindingTargetKey(binding.target)}`)).size !== bindings.length) throw new Error('More than one field link maps to the same upgraded field.');
  const revision = { ...structuredClone(original), id: newPackageId('revision'), parentId: original.id, createdAt: Date.now(), outputs: [],
    members: original.members.map(item => item.id === member.id ? replacement : structuredClone(item)), ...(bindings ? { bindings: { version: 1 as const, items: bindings } } : {}) };
  const after = actionPackageSchema.parse({ ...before, sequence: before.sequence + 1, currentRevisionId: revision.id, revisions: [...before.revisions, revision] });
  signal?.throwIfAborted();
  const result = freeze({ memberId, label: member.label, from: source.definition.definitionRevision, to: target.definition.definitionRevision,
    mappedAnswers: [...Object.entries(source.answers).map(([field, value]) => ({ before: field, after: migration.fields[field], beforeValue: value, afterValue: migrated.answers[migration.fields[field]] })),
      ...Object.entries(source.rows).flatMap(([group, rows]) => rows.flatMap(row => Object.entries(row.answers).map(([field, value]) => {
        const mapping = migration.rowGroups![group], destination = migrated.rows[mapping.to].find(item => item.id === row.id)!;
        return { before: `${group} · ${row.id} · ${field}`, after: `${mapping.to} · ${row.id} · ${mapping.columns[field]}`, beforeValue: value, afterValue: destination.answers[mapping.columns[field]] };
      })))], signatureAnswersOmitted: signed.length + signedRows.length, bindingChoices: affected.map(binding => ({ id: binding.id, choice: choices[binding.id] })),
    reviews, impact: await comparePackageChangeImpact(original, revision, { reviewRounds: before.reviewRounds, packageId: before.id, signal }) });
  plans.set(result, { before, after, staged, policy: key }); return result;
}
export async function applyPackageDefinitionUpgrade(prepared: PreparedPackageDefinitionUpgrade, policy: PolicyResolution, reviewed: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const captured = plans.get(prepared), key = packageTemplateMaintenancePolicy(policy);
  if (!captured || reviewed !== true || captured.policy !== key) throw new Error('Review the exact form definition, answer mappings and link decisions before applying this upgrade.');
  if (packageTemplateMaintenancePolicy(await getExportDeploymentPolicy()) !== key) throw new Error('Deployment settings changed. Review the form upgrade again.');
  const current = () => { signal?.throwIfAborted(); return isCurrent() && packageTemplateMaintenancePolicy(getExportDeploymentPolicySync()) === key; };
  signal?.throwIfAborted(); if (!current() || !(await listActionPackages()).some(record => sameReviewStoredValue(record, captured.before))) throw new Error('The package changed. Prepare the form upgrade again.');
  const saved = await withAttachmentStaging(() => commitActionPackage(captured.before, captured.after, signal, current, captured.staged)); plans.delete(prepared); return saved;
}

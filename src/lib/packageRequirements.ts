import { packageRequirementOperationSchema, packageRequirementsSchema, type PackageRequirement, type PackageRequirementOperation, type PackageRequirements } from './packageRequirementsModel';
import { actionPackageSchema, commitActionPackage, getPackageRevision, newPackageId, packageMemberSchema, type ActionPackage, type PackageAsset, type PackageMember, type PackageRevision } from './actionPackages';
import { readPackageAsset, validatePackageOriginalPdf } from './actionPackageAssets';
import { validatePackageDraft } from './actionPackageDraft';
import { validatePackageMemberTemplates } from './actionPackageTemplates';
import { portableResourceDigest } from './portableResources';
import { sameReviewStoredValue } from './documentsDb';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import { reviewPackageRequirements } from './actionPackageDisclosure';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
export * from './packageRequirementsModel';

export interface PackageRequirementFinding {
  id: string;
  label: string;
  kind: PackageRequirement['kind'];
  state: 'satisfied' | 'missing' | 'unknown' | 'inactive' | 'invalid' | 'not-required';
  message: string;
  memberId?: string;
}
export interface PackageRequirementsInspection {
  operation: PackageRequirementOperation;
  ready: boolean;
  items: PackageRequirementFinding[];
}
interface InspectionOptions { readAsset?: (asset: PackageAsset) => Promise<ArrayBuffer>; signal?: AbortSignal }

async function validateMember(input: PackageMember, read: (asset: PackageAsset) => Promise<ArrayBuffer>, signal?: AbortSignal) {
  const member = packageMemberSchema.parse(input);
  const verifiedRead = async (asset: PackageAsset) => {
    signal?.throwIfAborted();
    const bytes = await read(asset);
    if (bytes.byteLength !== asset.size || await portableResourceDigest(bytes) !== asset.sha256)
      throw new Error(`Missing or corrupt captured file: ${asset.name}.`);
    signal?.throwIfAborted(); return bytes;
  };
  if (member.kind === 'original') { await validatePackageOriginalPdf(await verifiedRead(member.original)); return; }
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await verifiedRead(member.draft)));
  const parsed = await validatePackageDraft(raw);
  if (!sameReviewStoredValue(parsed.session, member.session)) throw new Error('The captured document does not match its saved draft.');
  await validatePackageMemberTemplates(member, verifiedRead);
}

/** Evaluates this operation only. It never stores completion or treats a declaration as approval. */
export async function inspectPackageRequirements(revision: PackageRevision, operation: PackageRequirementOperation, options: InspectionOptions = {}): Promise<PackageRequirementsInspection> {
  options.signal?.throwIfAborted();
  operation = packageRequirementOperationSchema.parse(operation);
  const requirements = revision.templateState
    ? await (await import('./packageConditionalRequirements')).resolveConditionalPackageRequirements(revision, options.readAsset ?? readPackageAsset)
    : revision.requirements ? packageRequirementsSchema.parse(revision.requirements) : undefined;
  const knownPeople = new Set([...(revision.information?.participants.map(person => person.id) ?? []),
    ...Object.values(revision.templateState?.answers.groups ?? {}).flatMap(people => people.map(person => person.id)),
    ...Object.values(revision.templateState?.appliedAnswers?.groups ?? {}).flatMap(people => people.map(person => person.id))]);
  const members = new Map(revision.members.map(member => [member.id, member]));
  if (members.size !== revision.members.length) throw new Error("The package has duplicate captured member identities.");
  const checked = new Map<string, Promise<void>>(), items: PackageRequirementFinding[] = [];
  for (const requirement of requirements?.items ?? []) {
    options.signal?.throwIfAborted();
    const base = { id: requirement.id, label: requirement.label, kind: requirement.kind,
      ...(requirement.kind === 'document' && requirement.memberId ? { memberId: requirement.memberId } : {}) };
    if (!requirement.operations.includes(operation)) { items.push({ ...base, state: 'not-required', message: 'This requirement does not apply to this operation.' }); continue; }
    if (requirement.condition === 'inactive') { items.push({ ...base, state: 'inactive', message: 'This requirement is inactive for the saved answers.' }); continue; }
    if (requirement.condition === 'unknown') { items.push({ ...base, state: 'unknown', message: 'The condition is unresolved. Complete the relevant package answers.' }); continue; }
    if (requirement.participantId && !knownPeople.has(requirement.participantId)) {
      items.push({ ...base, state: 'unknown', message: 'The requirement’s person is unavailable. Review its saved assignment.' }); continue;
    }
    if (requirement.kind === 'confirmation') {
      items.push({ ...base, state: requirement.confirmed === true ? 'satisfied' : 'missing', message: requirement.confirmed === true
        ? 'User-declared confirmation. This is not an approval or independent verification.' : 'A user-declared confirmation is still needed.' }); continue;
    }
    const member = requirement.memberId ? members.get(requirement.memberId) : undefined;
    if (!member) { items.push({ ...base, state: 'missing', message: 'Assign an actual captured document or PDF to this evidence slot.' }); continue; }
    try {
      let validation = checked.get(member.id);
      if (!validation) { validation = validateMember(member, options.readAsset ?? readPackageAsset, options.signal); checked.set(member.id, validation); }
      await validation; options.signal?.throwIfAborted();
      items.push({ ...base, state: 'satisfied', message: `Captured content is present and readable: ${member.label}. Content accuracy and approval are not established.` });
    } catch (cause) {
      options.signal?.throwIfAborted();
      items.push({ ...base, state: 'invalid', message: cause instanceof Error ? cause.message : 'The captured evidence could not be verified.' });
    }
  }
  return { operation, ready: items.every(item => ['satisfied', 'inactive', 'not-required'].includes(item.state)), items };
}
export const packageRequirementReadiness = inspectPackageRequirements;
export async function assertPackageRequirementsReady(revision: PackageRevision, operation: PackageRequirementOperation, options: InspectionOptions = {}): Promise<void> {
  const inspection = await inspectPackageRequirements(revision, operation, options);
  if (!inspection.ready) throw new Error(inspection.items.filter(item => ['missing', 'unknown', 'invalid'].includes(item.state)).map(item => `${item.label}: ${item.message}`).join(' '));
}

/** Assignment and confirmation are captured in a child revision; incomplete drafts remain saveable. */
export async function updatePackageRequirements(input: ActionPackage, next: PackageRequirements | undefined, policy: PolicyResolution, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  signal?.throwIfAborted();
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  const record = actionPackageSchema.parse(structuredClone(input));
  if (record.archived || record.reviewRounds?.some(round => round.ownerPackageId === undefined)) throw new Error('Only the current, unarchived owning package can change requirements.');
  const requirements = next === undefined ? undefined : packageRequirementsSchema.parse(structuredClone(next));
  const current = getPackageRevision(record);
  const legacy = current.templateState && current.requirements === undefined && requirements !== undefined
    ? await (await import('./packageConditionalRequirements')).captureLegacyConditionalRequirementIds(current, requirements) : undefined;
  const previous = current.requirements ?? legacy?.requirements;
  if (sameReviewStoredValue(current.requirements, requirements)) throw new Error('Package requirements already match this revision.');
  if (current.requirements) {
    const declaration = (item: PackageRequirement) => item.kind === 'document'
      ? (({ memberId: _member, ...value }) => value)(item)
      : (({ confirmed: _confirmed, ...value }) => value)(item);
    if (!requirements || !sameReviewStoredValue(current.requirements.items.map(declaration), requirements.items.map(declaration)))
      throw new Error('Only evidence assignments and user confirmations may change here. Reapply the package template to update declared requirements.');
  }
  // Definitions are immutable under their identity; assignments and confirmations may change.
  for (const item of requirements?.items ?? []) {
    const prior = previous?.items.find(value => value.id === item.id);
    if (prior && (prior.kind !== item.kind || prior.definitionId !== item.definitionId || prior.participantId !== item.participantId)) throw new Error('A requirement identity cannot change its kind, definition or person.');
    if (item.kind === 'document' && item.memberId && item.memberId !== (prior?.kind === 'document' ? prior.memberId : undefined)) {
      const member = current.members.find(member => member.id === item.memberId);
      if (!member) throw new Error('Choose a captured member of this package for the evidence slot.');
      await validateMember(member, readPackageAsset, signal);
    }
  }
  if (requirements) reviewPackageRequirements(requirements, policy);
  const fresh = await getExportDeploymentPolicy();
  if (fresh.status !== 'ready' || JSON.stringify(fresh.policy) !== JSON.stringify(policy.policy)) throw new Error('Deployment settings changed. Review the requirements again.');
  const revision: PackageRevision = { ...structuredClone(current), id: newPackageId('revision'), parentId: current.id, createdAt: Date.now(), requirements, ...(legacy ? { templateState: legacy.state } : {}), outputs: [] };
  return commitActionPackage(record, { ...record, sequence: record.sequence + 1, currentRevisionId: revision.id, revisions: [...record.revisions, revision] }, signal, () => {
    const currentPolicy = getExportDeploymentPolicySync();
    return isCurrent() && currentPolicy.status === 'ready' && JSON.stringify(currentPolicy.policy) === JSON.stringify(policy.policy);
  });
}

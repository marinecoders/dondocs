import { matchesExpectedForm, missingPackageSignatures, officialFormCompletionIssues } from './packageFormCompletion';
import { validatePackageAttachment } from './packageAttachmentCapabilities';
import { requirementDeclaration, packageRequirementOperationSchema, packageRequirementsSchema, type PackageRequirement, type PackageRequirementOperation, type PackageRequirements } from './packageRequirementsModel';
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
  signatureFields?: string[];
  fromIntake?: boolean;
}
export interface PackageRequirementsInspection {
  operation: PackageRequirementOperation;
  ready: boolean;
  items: PackageRequirementFinding[];
}
interface InspectionOptions { readAsset?: (asset: PackageAsset) => Promise<ArrayBuffer>; signal?: AbortSignal }

async function validateMember(input: PackageMember, read: (asset: PackageAsset) => Promise<ArrayBuffer>, signal?: AbortSignal, keepOriginal = false) {
  const member = packageMemberSchema.parse(input);
  const verifiedRead = async (asset: PackageAsset) => {
    signal?.throwIfAborted();
    const bytes = await read(asset);
    if (bytes.byteLength !== asset.size || await portableResourceDigest(bytes) !== asset.sha256)
      throw new Error(`Missing or corrupt captured file: ${asset.name}.`);
    signal?.throwIfAborted(); return bytes;
  };
  if (member.kind === 'attachment') { await validatePackageAttachment(member.original, await verifiedRead(member.original), signal); return; }
  if (member.kind === 'original') { const bytes = await verifiedRead(member.original); await validatePackageOriginalPdf(bytes); return keepOriginal ? bytes : undefined; }
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
  return inspectResolvedRequirements(revision, requirements, operation, options);
}

async function inspectResolvedRequirements(revision: PackageRevision, requirements: PackageRequirements | undefined, operation: PackageRequirementOperation, options: InspectionOptions): Promise<PackageRequirementsInspection> {
  const originalsNeeded = new Set(requirements?.items.flatMap(item =>
    operation === 'pdf' && item.kind === 'document' && item.condition === 'active' && item.operations.includes(operation)
    && (item.completion?.expectedForm || item.completion?.requiredPdfFields?.length) && item.memberId ? [item.memberId] : []));
  const answeredByMember = new Map<string, Promise<Set<string>>>();
  const knownPeople = new Set([...(revision.information?.participants.map(person => person.id) ?? []),
    ...Object.values(revision.templateState?.answers.groups ?? {}).flatMap(people => people.map(person => person.id)),
    ...Object.values(revision.templateState?.appliedAnswers?.groups ?? {}).flatMap(people => people.map(person => person.id))]);
  const members = new Map(revision.members.map(member => [member.id, member]));
  if (members.size !== revision.members.length) throw new Error("The package has duplicate captured member identities.");
  const checked = new Map<string, ReturnType<typeof validateMember>>(), items: PackageRequirementFinding[] = [];
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
      if (!validation) { validation = validateMember(member, options.readAsset ?? readPackageAsset, options.signal, originalsNeeded.has(member.id)); checked.set(member.id, validation); }
      const originalBytes = await validation; options.signal?.throwIfAborted();
      if (operation === 'pdf') {
        const rule = requirement.completion;
        const issues = officialFormCompletionIssues(member, rule);
        if (rule?.expectedForm && !await matchesExpectedForm(member, rule.expectedForm, originalBytes)) {
          issues.push('This slot needs the maintained form and edition named in the recipe.');
        } else if (rule?.requiredPdfFields?.length && originalBytes) {
          let answered = answeredByMember.get(member.id);
          if (!answered) {
            const { readAnsweredPdfFields } = await import('@/services/forms/readRequiredPdfFields');
            answered = readAnsweredPdfFields(originalBytes);
            answeredByMember.set(member.id, answered);
          }
          const fields = await answered;
          const missing = rule.requiredPdfFields.filter(field => !fields.has(field));
          if (missing.length) issues.push('The saved PDF is missing required answers: ' + missing.join(', ') + '.');
        } else if (rule?.requiredPdfFields?.length && !(member.kind === 'native' && member.session.genericForm)) {
          issues.push('The required fields cannot be verified on this document.');
        }
        if (issues.length) {
          items.push({ ...base, state: 'missing', message: issues.join(' '), signatureFields: missingPackageSignatures(member, rule) });
          continue;
        }
      }
      items.push({ ...base, state: 'satisfied', message: operation === 'pdf' && requirement.completion?.reviewedScan ? 'Signature on this exact scan reviewed manually. Certificate trust has not been established.' : `Captured content is present and readable: ${member.label}. Content accuracy and approval are not established.` });
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
  requireSatisfied(inspection);
}

export class PackageDeliveryBlocked extends Error {
  readonly findings: PackageRequirementFinding[];
  constructor(findings: PackageRequirementFinding[]) {
    super(findings.map(item => item.label + ': ' + item.message).join(' '));
    this.findings = findings;
  }
}

export async function assertDeliveryRequirements(revision: PackageRevision, selectedIds: readonly string[] | undefined, signal?: AbortSignal) {
  const state = revision.templateState;
  const requirements = state
    ? await (await import('./packageConditionalRequirements')).resolveConditionalPackageRequirements(revision)
    : revision.requirements;
  const selected = selectedIds && new Set(selectedIds);
  const applicable = selected && requirements ? { ...requirements, items: requirements.items.filter(item =>
    item.kind === 'document' && item.memberId && selected.has(item.memberId)) } : requirements;
  const inspected = await inspectResolvedRequirements(revision, applicable, 'pdf', { signal });
  const failures = inspected.items.filter(item => ['missing', 'invalid', 'unknown'].includes(item.state));
  if (state) {
    const { conditionalMembershipFindings } = await import('./packageConditionalSources');
    for (const issue of conditionalMembershipFindings(revision)) {
      if (selected && (!issue.memberId || !selected.has(issue.memberId))) continue;
      const slot = state.instances.find(instance => instance.memberId === issue.memberId);
      failures.push({ id: 'intake:' + failures.length, kind: 'document', state: 'missing', label: slot?.label ?? 'Package details',
        message: issue.message, memberId: issue.memberId, fromIntake: true });
    }
  }
  const linked = revision.members.filter(member => member.endorsementLink && (!selected || selected.has(member.id)));
  if (linked.length) {
    const { endorsementLinkIssue, packageEndorsementRoutes } = await import('./packageEndorsements');
    const routes = packageEndorsementRoutes(revision);
    for (const member of linked) {
      const message = endorsementLinkIssue(member, routes.get(member.id));
      if (message) failures.push({ id: 'endorsement:' + member.id, kind: 'document', state: 'invalid', label: member.label, memberId: member.id, message });
    }
  }
  if (failures.length) throw new PackageDeliveryBlocked(failures);
}

function requireSatisfied(inspection: PackageRequirementsInspection) {
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
    const declaration = (item: PackageRequirement) => requirementDeclaration(item, !!current.templateState);
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

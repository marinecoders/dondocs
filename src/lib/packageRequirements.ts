import { missingAnswerGroups } from './packageFormCompletion';
import { officialSignatureLabels, packageSignatureFieldLabel } from './packageSignatureFieldLabel';
import { matchesExpectedForm, missingPackageSignatures, officialFormCompletionIssues } from './packageFormCompletion';
import { resolvePackageRevisionSource } from './packageRevisionSources';
import { validatePackageAttachment } from './packageAttachmentCapabilities';
import { requirementDeclaration, packageRequirementOperationSchema, packageRequirementsSchema, type FormCompletion, type PackageRequirement, type PackageRequirementOperation, type PackageRequirements } from './packageRequirementsModel';
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
  documentIssues?: string[];
  corrections?: import('./packageDestinations').PackageCorrection[];
  signatureFields?: string[];
  signatureLabels?: Record<string, string>;
  fromIntake?: boolean;
  question?: import('./packageQuestionFindings').PackageQuestionFinding;
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
    && (item.completion?.expectedForm || item.completion?.requiredPdfFields?.length || item.completion?.answerGroups?.length || item.completion?.uncheckedPdfFields?.length) && item.memberId ? [item.memberId] : []));
  const answeredByMember = new Map<string, ReturnType<typeof import('@/services/forms/readRequiredPdfFields').readPdfAnswerStates>>();
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
    if (requirement.memberRevisionId && requirement.memberRevisionId !== member.revisionId) {
      items.push({ ...base, state: 'missing', message: 'This document has changed since its exact version was assigned. Review and select the intended version.' });
      continue;
    }
    try {
      let validation = checked.get(member.id);
      if (!validation) { validation = validateMember(member, options.readAsset ?? readPackageAsset, options.signal, originalsNeeded.has(member.id)); checked.set(member.id, validation); }
      const originalBytes = await validation; options.signal?.throwIfAborted();
      if (operation === 'pdf') {
        const rule = requirement.completion;
        const corrections: NonNullable<PackageRequirementFinding['corrections']> = [];
        const issues = officialFormCompletionIssues(member, rule, (_, target) => { if (target) corrections.push(target); });
        if (rule?.expectedForm && !await matchesExpectedForm(member, rule.expectedForm, originalBytes)) {
          issues.push('This slot needs the maintained form and edition named in the recipe.');
          if (member.kind === 'original' && !member.signedOriginal) corrections.push({ kind: 'replace', label: 'Replace PDF' });
        } else if ((rule?.requiredPdfFields?.length || rule?.answerGroups?.length || rule?.uncheckedPdfFields?.length) && originalBytes) {
          let answered = answeredByMember.get(member.id);
          if (!answered) {
            const { readPdfAnswerStates } = await import('@/services/forms/readRequiredPdfFields');
            answered = readPdfAnswerStates(originalBytes);
            answeredByMember.set(member.id, answered);
          }
          const fields = await answered;
          issues.push(...missingAnswerGroups(rule.answerGroups, fields.answered).map(group => group.label));
          const conflicting = rule.uncheckedPdfFields?.filter(field => !fields.unchecked.has(field));
          if (conflicting?.length) issues.push('The returned PDF has a conflicting selection: ' + conflicting.join(', ') + '.');
          const missing = (rule.requiredPdfFields ?? []).filter(field => !fields.answered.has(field));
          if (missing.length) issues.push('The saved PDF is missing required answers: ' + missing.join(', ') + '.');
          if (issues.length && member.kind === 'original' && !member.signedOriginal) corrections.push({ kind: 'replace', label: 'Replace PDF' });
        } else if ((rule?.requiredPdfFields?.length || rule?.answerGroups?.length || rule?.uncheckedPdfFields?.length) && !(member.kind === 'native' && member.session.genericForm)) {
          issues.push('The required fields cannot be verified on this document.');
        }
        const signatureFields = missingPackageSignatures(member, rule);
        if (issues.length || signatureFields.length) {
          const editionLabels = member.kind === 'original' && signatureFields.length && rule?.expectedForm
            ? await officialSignatureLabels(rule.expectedForm).catch(() => undefined) : undefined;
          options.signal?.throwIfAborted();
          const signatureLabels = Object.fromEntries(signatureFields.map(field =>
            [field, editionLabels?.get(field) || packageSignatureFieldLabel(member, field)]));
          const messages = signatureFields.length
            ? [...issues, 'Sign or verify: ' + signatureFields.map(field => signatureLabels[field]).join(', ') + '.']
            : issues;
          items.push({ ...base, state: 'missing', message: messages.join(' '), documentIssues: issues, corrections, signatureFields, signatureLabels });
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
/** Validate a proposed reuse with the same byte, field and signature checks used for final delivery. */
export async function verifyRevisionForEvidence(member: PackageMember, rules: FormCompletion[], options: InspectionOptions = {}) {
  if (!rules.length) {
    await validateMember(member, options.readAsset ?? readPackageAsset, options.signal);
    return;
  }
  const revision: PackageRevision = { id: 'selection', createdAt: 0, members: [member], outputs: [] };
  const requirements: PackageRequirements = { version: 1, items: rules.map((completion, i) => ({
    id: `rule-${i}`, label: member.label, kind: 'document', operations: ['pdf'], condition: 'active', memberId: member.id, completion,
  })) };
  requireSatisfied(await inspectResolvedRequirements(revision, requirements, 'pdf', options));
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
  if (failures.length && state) {
    const { loadConditionalPackageSource } = await import('./packageConditionalSources');
    const { packageQuestionFindings } = await import('./packageQuestionFindings');
    const source = await loadConditionalPackageSource(revision);
    if (source) {
      const questions = packageQuestionFindings(source.template, revision);
      for (const item of failures) {
        if (item.state === 'unknown') item.question = questions.get(item.id);
        if (item.fromIntake && item.memberId) item.question = questions.get(item.memberId);
      }
    }
  }
  if (failures.length) throw new PackageDeliveryBlocked(failures);
}

function requireSatisfied(inspection: PackageRequirementsInspection) {
  if (!inspection.ready) throw new Error(inspection.items.filter(item => ['missing', 'unknown', 'invalid'].includes(item.state)).map(item => `${item.label}: ${item.message}`).join(' '));
}

/** Materialize an older selection as an independent member so a current-only transfer includes its exact assets. */
export async function captureRequirementVersions(record: ActionPackage, next: PackageRequirements | undefined, signal?: AbortSignal) {
  const current = getPackageRevision(record), members = [...current.members], requirements = structuredClone(next);
  const copies = new Map<string, PackageMember>();
  for (const item of requirements?.items ?? []) {
    if (item.kind !== 'document' || !item.memberId || !item.memberRevisionId) continue;
    const prior = current.requirements?.items.find(existing => existing.id === item.id);
    if (prior?.kind === 'document' && prior.memberId === item.memberId && prior.memberRevisionId === item.memberRevisionId) continue;
    const source = resolvePackageRevisionSource(record, { memberId: item.memberId, revisionId: item.memberRevisionId });
    await verifyRevisionForEvidence(source, item.completion ? [item.completion] : [], { signal });
    if (members.some(member => member.id === source.id && member.revisionId === source.revisionId)) continue;
    const key = JSON.stringify([source.id, source.revisionId]);
    let copy = copies.get(key);
    if (!copy) {
      copy = { ...source, id: newPackageId('member'), revisionId: newPackageId('member-revision'), role: 'supporting-document', required: false };
      delete copy.endorsementLink;
      copies.set(key, copy);
      members.push(copy);
    }
    item.memberId = copy.id;
    item.memberRevisionId = copy.revisionId;
  }
  return { members, requirements };
}

/** Assignment and confirmation are captured in a child revision; incomplete drafts remain saveable. */
export async function updatePackageRequirements(input: ActionPackage, next: PackageRequirements | undefined, policy: PolicyResolution, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  signal?.throwIfAborted();
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  const record = actionPackageSchema.parse(structuredClone(input));
  if (record.archived || record.reviewRounds?.some(round => round.ownerPackageId === undefined)) throw new Error('Only the current, unarchived owning package can change requirements.');
  const proposed = next === undefined ? undefined : packageRequirementsSchema.parse(next);
  const { members, requirements } = await captureRequirementVersions(record, proposed, signal);
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
      const member = members.find(member => member.id === item.memberId);
      if (!member) throw new Error('Choose a captured member of this package for the evidence slot.');
      await validateMember(member, readPackageAsset, signal);
    }
  }
  if (requirements) reviewPackageRequirements(requirements, policy);
  const fresh = await getExportDeploymentPolicy();
  if (fresh.status !== 'ready' || JSON.stringify(fresh.policy) !== JSON.stringify(policy.policy)) throw new Error('Deployment settings changed. Review the requirements again.');
  const revision: PackageRevision = { ...structuredClone(current), id: newPackageId('revision'), parentId: current.id, createdAt: Date.now(), members, requirements, ...(legacy ? { templateState: legacy.state } : {}), outputs: [] };
  return commitActionPackage(record, { ...record, sequence: record.sequence + 1, currentRevisionId: revision.id, revisions: [...record.revisions, revision] }, signal, () => {
    const currentPolicy = getExportDeploymentPolicySync();
    return isCurrent() && currentPolicy.status === 'ready' && JSON.stringify(currentPolicy.policy) === JSON.stringify(policy.policy);
  });
}

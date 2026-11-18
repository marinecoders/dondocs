import type { ActionPackage, PackageRevision } from './actionPackages';
import { actionPackageSchema, commitActionPackage, getPackageRevision, newPackageId } from './actionPackages';
import type { PackageFact } from './packageInformation';
import { packageInformationSchema } from './packageInformation';
import { packageConsistencySchema, packageConsistencyRuleSchema, packageConsistencyExceptionSchema,
  packageConsistencyRuleIdentity, type PackageConsistency, type PackageConsistencyRule, type PackageConsistencyException } from './packageConsistencyModel';
import { portableResourceDigest } from './portableResources';
import { sameReviewStoredValue } from './documentsDb';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import { reviewPackageConsistency } from './actionPackageDisclosure';
export * from './packageConsistencyModel';

export interface PackageConsistencyDestination { factId: string; memberId?: string; bindingId?: string }
export interface PackageConsistencyFinding {
  ruleId: string;
  label: string;
  state: 'satisfied' | 'conflict' | 'unresolved' | 'excepted';
  required: boolean;
  message: string;
  destinations: PackageConsistencyDestination[];
  exceptionReason?: string;
  staleException?: boolean;
}
export interface PackageConsistencyInspection { ready: boolean; findings: PackageConsistencyFinding[] }

function operands(revision: PackageRevision, rule: PackageConsistencyRule) {
  const information = revision.information ? packageInformationSchema.parse(revision.information) : undefined;
  const left = information?.facts.find(fact => fact.id === rule.leftFactId), right = information?.facts.find(fact => fact.id === rule.rightFactId);
  const participant = rule.participantId ? information?.participants.find(person => person.id === rule.participantId) : undefined;
  let problem: string | undefined;
  if (!left || !right) problem = 'A declared package value is missing. Restore the value or revise this relationship.';
  else if (rule.participantId && !participant) problem = 'The declared person is unavailable. Review this relationship’s scope.';
  else if ([left, right].some(fact => fact.participantId !== undefined && fact.participantId !== rule.participantId))
    problem = 'These values belong to different people or need a person-specific relationship.';
  else if (left.kind !== right.kind) problem = 'The declared values have incompatible types.';
  else if (rule.relation === 'date-on-or-before' && left.kind !== 'date') problem = 'Date ordering requires two confirmed date values.';
  else if ([left, right].some(fact => typeof fact.value === 'string' && !fact.value.trim())) problem = 'A declared package value is unanswered.';
  return { left, right, participant, problem };
}
function decimal(value: string): string {
  const normalized = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return normalized === '-0' ? '0' : normalized;
}
function agrees(rule: PackageConsistencyRule, left: PackageFact, right: PackageFact): boolean {
  if (rule.relation === 'date-on-or-before') return String(left.value) <= String(right.value);
  return left.kind === 'decimal' && right.kind === 'decimal' ? decimal(left.value) === decimal(right.value) : left.value === right.value;
}
async function fingerprint(revision: PackageRevision, rule: PackageConsistencyRule): Promise<string> {
  const { left, right, participant } = operands(revision, rule);
  // Full confirmed context keeps an old reason from silently following changed facts, labels or roles.
  const bytes = new TextEncoder().encode(JSON.stringify({ rule, left: left ?? null, right: right ?? null, participant: participant ?? null })).buffer;
  return portableResourceDigest(bytes);
}
function destinations(revision: PackageRevision, rule: PackageConsistencyRule): PackageConsistencyDestination[] {
  return [rule.leftFactId, rule.rightFactId].flatMap(factId => {
    const links = revision.bindings?.items.filter(binding => binding.factId === factId) ?? [];
    return links.length ? links.map(binding => ({ factId, memberId: binding.memberId, bindingId: binding.id })) : [{ factId }];
  });
}

/** Only declared relationships are compared; native local overrides keep their existing field semantics. */
export async function inspectPackageConsistency(input: PackageRevision, signal?: AbortSignal): Promise<PackageConsistencyInspection> {
  signal?.throwIfAborted();
  const revision = structuredClone(input), consistency = revision.consistency && packageConsistencySchema.parse(revision.consistency);
  const findings: PackageConsistencyFinding[] = [];
  for (const rule of consistency?.rules ?? []) {
    signal?.throwIfAborted();
    const base = { ruleId: rule.id, label: rule.label, required: rule.required, destinations: destinations(revision, rule) };
    const { left, right, problem } = operands(revision, rule), exception = consistency!.exceptions.find(item => item.ruleId === rule.id);
    if (problem || !left || !right) {
      findings.push({ ...base, state: 'unresolved', message: problem ?? 'Declared values are unavailable.', ...(exception ? { staleException: true } : {}) }); continue;
    }
    if (agrees(rule, left, right)) { findings.push({ ...base, state: 'satisfied', message: 'The confirmed package values meet this declared relationship.' }); continue; }
    const applicable = exception && exception.fingerprint === await fingerprint(revision, rule);
    signal?.throwIfAborted();
    findings.push(applicable ? { ...base, state: 'excepted', exceptionReason: exception.reason,
      message: 'A recorded local exception applies to these exact values.' }
      : { ...base, state: 'conflict', ...(exception ? { staleException: true } : {}), message: rule.relation === 'equal'
        ? 'These confirmed package values differ.' : 'The first date is later than the second date.' });
  }
  return { ready: findings.every(finding => !finding.required || ['satisfied', 'excepted'].includes(finding.state)), findings };
}

/** Creates a descriptive exception, never an approval or an exception to missing required evidence. */
export async function createPackageConsistencyException(input: PackageRevision, ruleId: string, reason: string): Promise<PackageConsistencyException> {
  const revision = structuredClone(input), rule = revision.consistency?.rules.find(rule => rule.id === ruleId);
  if (!rule) throw new Error('Choose an existing declared relationship.');
  const parsed = packageConsistencyRuleSchema.parse(rule), { left, right, problem } = operands(revision, parsed);
  if (problem || !left || !right) throw new Error('Resolve missing, unanswered or incompatible values before recording an exception.');
  if (agrees(parsed, left, right)) throw new Error('This relationship already holds; no exception is needed.');
  return packageConsistencyExceptionSchema.parse({ ruleId, reason, fingerprint: await fingerprint(revision, parsed) });
}

export async function assertPackageConsistencyReady(revision: PackageRevision, signal?: AbortSignal): Promise<void> {
  const inspection = await inspectPackageConsistency(revision, signal);
  if (!inspection.ready) throw new Error(inspection.findings.filter(item => item.required && ['conflict', 'unresolved'].includes(item.state))
    .map(item => `${item.label}: ${item.message}`).join(' '));
}

/** Own edits before awaits and publish only a new child of the unchanged, current owning package. */
export async function updatePackageConsistency(input: ActionPackage, next: PackageConsistency | undefined, policy: PolicyResolution,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  signal?.throwIfAborted();
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  const record = actionPackageSchema.parse(structuredClone(input)), consistency = next === undefined ? undefined : packageConsistencySchema.parse(structuredClone(next));
  if (record.archived || record.reviewRounds?.some(round => round.ownerPackageId === undefined)) throw new Error('Only the current, unarchived owning package can change relationships.');
  const current = getPackageRevision(record);
  if (sameReviewStoredValue(current.consistency, consistency)) throw new Error('Package relationships already match this revision.');
  for (const rule of consistency?.rules ?? []) {
    const prior = current.consistency?.rules.find(item => item.id === rule.id);
    if (prior && packageConsistencyRuleIdentity(prior) !== packageConsistencyRuleIdentity(rule))
      throw new Error('Create a new relationship identity when changing its values, relation or person.');
    // Existing damaged references remain editable/saveable; a newly declared rule must be meaningful.
    if (!prior) {
      const { problem } = operands(current, rule); if (problem) throw new Error(`${rule.label}: ${problem}`);
    }
  }
  for (const exception of consistency?.exceptions ?? []) {
    const retained = current.consistency?.exceptions.find(item => item.ruleId === exception.ruleId);
    if (sameReviewStoredValue(retained, exception)) continue;
    const revised = { ...current, consistency };
    const expected = await createPackageConsistencyException(revised, exception.ruleId, exception.reason);
    if (!sameReviewStoredValue(expected, exception)) throw new Error('The exception no longer matches the declared relationship and current values. Review it again.');
  }
  if (consistency) reviewPackageConsistency(consistency, policy);
  const policyKey = JSON.stringify(policy.policy), fresh = await getExportDeploymentPolicy();
  signal?.throwIfAborted();
  if (fresh.status !== 'ready' || JSON.stringify(fresh.policy) !== policyKey) throw new Error('Deployment settings changed. Review these relationships again.');
  const revision: PackageRevision = { ...structuredClone(current), id: newPackageId('revision'), parentId: current.id, createdAt: Date.now(), consistency, outputs: [] };
  return commitActionPackage(record, { ...record, sequence: record.sequence + 1, currentRevisionId: revision.id, revisions: [...record.revisions, revision] }, signal, () => {
    const actual = getExportDeploymentPolicySync(); return isCurrent() && actual.status === 'ready' && JSON.stringify(actual.policy) === policyKey;
  });
}

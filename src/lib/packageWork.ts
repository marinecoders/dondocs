import { actionPackageSchema, commitActionPackage, getPackageRevision, newPackageId, type ActionPackage, type PackageRevision } from './actionPackages';
import { packageWorkSchema, resolvePackageTaskTarget, type PackageWork } from './packageWorkModel';
import { sameReviewStoredValue } from './documentsDb';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { reviewPackageWork } from './actionPackageDisclosure';
export * from './packageWorkModel';

/** Coordination is revision-owned metadata; it never changes evidence, review decisions or readiness. */
export async function updatePackageWork(input: ActionPackage, proposed: PackageWork | undefined, policy: PolicyResolution,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  signal?.throwIfAborted();
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  const policyIdentity = JSON.stringify(policy.policy), record = actionPackageSchema.parse(structuredClone(input));
  const work = proposed === undefined ? undefined : packageWorkSchema.parse(structuredClone(proposed));
  if (record.archived || record.reviewRounds?.some(round => round.ownerPackageId === undefined))
    throw new Error('Only the current, unarchived owning package can change work tracking.');
  const current = getPackageRevision(record);
  if (sameReviewStoredValue(current.work, work)) throw new Error('Package work already matches this revision.');
  for (const task of work?.tasks ?? []) {
    const prior = current.work?.tasks.find(prior => prior.id === task.id);
    if (task.target && !sameReviewStoredValue(prior?.target, task.target)
      && resolvePackageTaskTarget(current, task.target).state === 'missing')
      throw new Error('Choose an existing document or requirement for the task.');
  }
  if (work) reviewPackageWork(work, policy);
  const fresh = await getExportDeploymentPolicy();
  if (fresh.status !== 'ready' || JSON.stringify(fresh.policy) !== policyIdentity)
    throw new Error('Deployment settings changed. Review the work changes again.');
  let guardError: Error | undefined;
  const currentGuard = () => {
    const active = getExportDeploymentPolicySync();
    if (active.status !== 'ready' || JSON.stringify(active.policy) !== policyIdentity) {
      guardError = new Error('Deployment settings changed. Review the work changes again.'); return false;
    }
    if (!isCurrent()) { guardError = new Error('This work operation is no longer current.'); return false; }
    return true;
  };
  const revision: PackageRevision = { ...structuredClone(current), id: newPackageId('revision'), parentId: current.id,
    createdAt: Date.now(), outputs: [], work };
  try {
    return await commitActionPackage(record, { ...record, sequence: record.sequence + 1, currentRevisionId: revision.id,
      revisions: [...record.revisions, revision] }, signal, currentGuard);
  } catch (cause) { throw guardError ?? cause; }
}

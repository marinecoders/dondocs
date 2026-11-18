import { actionPackageSchema, commitActionPackage, getPackageRevision, newPackageId, type ActionPackage } from './actionPackages';
import { packageAssemblySettingsSchema, type PackageAssemblySettings } from './packageAssemblyModel';
import { sameReviewStoredValue } from './documentsDb';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';

/** Saved assembly preferences create a child revision; previous PDFs retain their captured layout. */
export async function updatePackageAssemblySettings(input: ActionPackage, next: PackageAssemblySettings, policy: PolicyResolution,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  signal?.throwIfAborted();
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  const record = actionPackageSchema.parse(structuredClone(input)), assembly = packageAssemblySettingsSchema.parse(structuredClone(next));
  if (record.archived || record.reviewRounds?.some(round => round.ownerPackageId === undefined)) throw new Error('Change assembly settings from the current, unarchived owning package.');
  const current = getPackageRevision(record);
  if (sameReviewStoredValue(current.assembly, assembly)) throw new Error('Assembly settings already match the saved revision.');
  const identity = JSON.stringify(policy.policy), fresh = await getExportDeploymentPolicy();
  signal?.throwIfAborted();
  if (fresh.status !== 'ready' || JSON.stringify(fresh.policy) !== identity) throw new Error('Deployment settings changed. Review the assembly settings again.');
  const revision = { ...structuredClone(current), assembly, id: newPackageId('revision'), parentId: current.id, createdAt: Date.now(), outputs: [] };
  return commitActionPackage(record, { ...record, sequence: record.sequence + 1, currentRevisionId: revision.id, revisions: [...record.revisions, revision] }, signal,
    () => { const value = getExportDeploymentPolicySync(); return isCurrent() && value.status === 'ready' && JSON.stringify(value.policy) === identity; });
}

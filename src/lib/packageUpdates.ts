import {
  actionPackageSchema, commitActionPackage, getPackageRevision, listActionPackages, newPackageId,
  type ActionPackage, type PackageRevision,
} from './actionPackages';
import { packageInformationSchema, type PackageInformation } from './packageInformation';
import {
  packageFieldBindingsSchema, type PackageFieldBindings,
} from './packageFieldBindings';
import type { PackageBindingValue } from './packageBindingTargets';
import { captureLinkedPackageChanges } from './packageLinkedUpdates';
import { reviewRestoredPackageSources } from './packageRestoredSources';
import { sameReviewStoredValue, type StoredAttachment } from './documentsDb';
import { withAttachmentStaging } from './attachments';
import { reviewPackageScans, reviewPackageBindings, reviewPackageInformation, reviewPackageConsistency, reviewPackageWork, reviewPackageSigningMetadata, reviewPackageText } from './actionPackageDisclosure';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { comparePackageChangeImpact, type PackageChangeImpact } from './packageChangeImpact';

export type PackageUpdateChoice = 'apply-package' | 'keep-local' | 'detach' | 'reconnect';
export type PackageUpdateChoices = Readonly<Record<string, PackageUpdateChoice>>;
export interface PackageUpdatePreview {
  bindingId: string;
  memberId: string;
  label: string;
  state: 'update' | 'unchanged' | 'override' | 'conflict' | 'unavailable' | 'detach';
  before?: PackageBindingValue;
  after?: string | boolean;
  choices?: readonly PackageUpdateChoice[];
  message: string;
}
export interface PreparedPackageUpdate {
  readonly packageName: string;
  readonly revisionId: string;
  readonly ready: boolean;
  readonly changed: boolean;
  readonly changes: readonly PackageUpdatePreview[];
  readonly issues: readonly string[];
  readonly reviews: readonly ExportReview[];
  readonly impact?: PackageChangeImpact;
}
export interface PackageUpdateUndo { readonly packageId: string; readonly appliedRevisionId: string }
interface Capture {
  before: ActionPackage;
  after: ActionPackage;
  attachments: StoredAttachment[];
  policy: string;
}
const preparations = new WeakMap<PreparedPackageUpdate, Capture>();
const reversals = new WeakMap<PackageUpdateUndo, { before: ActionPackage; after: ActionPackage }>();

function policyIdentity(policy: PolicyResolution): string {
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  return JSON.stringify(policy.policy);
}
function editable(record: ActionPackage): void {
  if (record.archived) throw new Error('Reopen this archived package before changing its information.');
  if (record.reviewRounds?.some(round => round.ownerPackageId === undefined))
    throw new Error('A reviewer copy cannot change captured package information.');
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function informationReviews(revision: PackageRevision, policy: PolicyResolution): ExportReview[] {
  return [
    ...(revision.information ? [reviewPackageInformation(revision.information, policy)] : []),
    ...(revision.bindings ? [reviewPackageBindings(revision.bindings, policy)] : []),
    ...(revision.consistency ? [reviewPackageConsistency(revision.consistency, policy)] : []),
    ...(revision.work ? [reviewPackageWork(revision.work, policy)] : []),
    ...(revision.signing ? [reviewPackageSigningMetadata(revision.signing, policy)] : []),
    ...(revision.scans ? [reviewPackageScans(revision.scans, policy)] : []),
  ];
}
async function deploymentGuard(policy: PolicyResolution, signal: AbortSignal | undefined, isCurrent: () => boolean) {
  const identity = policyIdentity(policy);
  if (policyIdentity(await getExportDeploymentPolicy()) !== identity)
    throw new Error('Deployment settings changed. Review these package updates again.');
  let failure: unknown;
  const current = () => {
    try {
      signal?.throwIfAborted();
      if (!isCurrent()) throw new Error('This package update is no longer current.');
      if (policyIdentity(getExportDeploymentPolicySync()) !== identity)
        throw new Error('Deployment settings changed. Review these package updates again.');
      return true;
    } catch (cause) { failure = cause; return false; }
  };
  const assert = () => { if (!current()) throw failure; };
  assert();
  return { current, assert, error: () => failure };
}

/** Preparation owns its inputs and staged bytes. It never opens an editor or writes storage. */
export async function preparePackageUpdate(
  input: ActionPackage,
  nextInformation: PackageInformation | undefined,
  nextBindings: PackageFieldBindings | undefined,
  choices: PackageUpdateChoices,
  policy: PolicyResolution,
  signal?: AbortSignal,
): Promise<PreparedPackageUpdate> {
  signal?.throwIfAborted();
  const identity = policyIdentity(policy), before = actionPackageSchema.parse(structuredClone(input));
  editable(before);
  const current = getPackageRevision(before);
  const information = nextInformation === undefined ? undefined : packageInformationSchema.parse(structuredClone(nextInformation));
  const bindings = nextBindings === undefined ? undefined : packageFieldBindingsSchema.parse(structuredClone(nextBindings));
  const proposed: PackageRevision = { ...structuredClone(current), id: newPackageId('revision'), parentId: current.id,
    createdAt: Date.now(), information, bindings, outputs: [] };
  const planned = await captureLinkedPackageChanges(current, proposed, choices, policy, signal);
  const { revision, changes, issues, attachments, changed } = planned;
  const reviews = [reviewPackageText(before.name, 'Package name', policy), ...planned.reviews];
  const after = actionPackageSchema.parse({ ...before, sequence: before.sequence + 1,
    currentRevisionId: revision.id, revisions: [...before.revisions, revision] });
  const impact = issues.length ? undefined : await comparePackageChangeImpact(current, revision, { reviewRounds: before.reviewRounds, retainedRevisions: before.revisions.filter(item => item.outputs.length), packageId: before.id, signal });
  const prepared = frozen({ packageName: before.name, revisionId: current.id, ready: issues.length === 0,
    changed, changes: structuredClone(changes), issues: [...issues], reviews: structuredClone(reviews), ...(impact ? { impact } : {}) });
  preparations.set(prepared, { before, after, attachments, policy: identity });
  return prepared;
}

export async function applyPreparedPackageUpdate(
  prepared: PreparedPackageUpdate, policy: PolicyResolution, reviewed: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true,
): Promise<{ record: ActionPackage; undo: PackageUpdateUndo }> {
  const retained = preparations.get(prepared);
  if (!retained || retained.policy !== policyIdentity(policy)) throw new Error('Prepare and review these package updates again.');
  if (!prepared.ready || !prepared.changed || !reviewed) throw new Error('Resolve and review the proposed package changes before applying them.');
  signal?.throwIfAborted();
  if (!isCurrent()) throw new Error('The package update is no longer current.');
  const guard = await deploymentGuard(policy, signal, isCurrent);
  const latest = (await listActionPackages()).find(record => record.id === retained.before.id);
  guard.assert();
  if (!sameReviewStoredValue(latest, retained.before)) throw new Error('The saved package changed. Review its latest revision before applying these updates.');
  let record: ActionPackage;
  try { record = await withAttachmentStaging(() => commitActionPackage(retained.before, retained.after, signal, guard.current, retained.attachments)); }
  catch (cause) { throw guard.error() ?? cause; }
  const undo = Object.freeze({ packageId: record.id, appliedRevisionId: record.currentRevisionId });
  reversals.set(undo, { before: retained.before, after: structuredClone(record) }); preparations.delete(prepared);
  return { record, undo };
}

/** Undo is another captured revision and is refused after any intervening package change. */
export async function undoPackageUpdate(
  receipt: PackageUpdateUndo, policy: PolicyResolution, signal?: AbortSignal, isCurrent: () => boolean = () => true,
): Promise<ActionPackage> {
  policyIdentity(policy);
  const retained = reversals.get(receipt);
  if (!retained) throw new Error('This package update can no longer be undone here. Its saved history remains available.');
  signal?.throwIfAborted();
  if (!isCurrent()) throw new Error('This package update is no longer current.');
  const guard = await deploymentGuard(policy, signal, isCurrent);
  const latest = (await listActionPackages()).find(record => record.id === retained.after.id);
  guard.assert();
  if (!sameReviewStoredValue(latest, retained.after)) throw new Error('The package changed after these updates. Review its saved history before restoring earlier content.');
  const original = getPackageRevision(retained.before);
  reviewPackageText(retained.before.name, 'Package name', policy);
  informationReviews(original, policy);
  if (original.scans) {
    const { reviewPackageScanSources } = await import('./packageScans');
    await reviewPackageScanSources(original.scans, policy, { signal });
  }
  await reviewRestoredPackageSources(original, policy, signal);
  const revision: PackageRevision = { ...structuredClone(original), id: newPackageId('revision'),
    parentId: retained.after.currentRevisionId, createdAt: Date.now(), outputs: [] };
  let record: ActionPackage;
  try { record = await withAttachmentStaging(() => commitActionPackage(retained.after,
    { ...retained.after, sequence: retained.after.sequence + 1, currentRevisionId: revision.id,
      revisions: [...retained.after.revisions, revision] }, signal, guard.current)); }
  catch (cause) { throw guard.error() ?? cause; }
  reversals.delete(receipt); return record;
}

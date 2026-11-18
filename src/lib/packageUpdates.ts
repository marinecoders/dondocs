import {
  actionPackageSchema, commitActionPackage, getPackageRevision, listActionPackages, newPackageId,
  type ActionPackage, type PackageRevision,
} from './actionPackages';
import { packageInformationSchema, type PackageInformation } from './packageInformation';
import {
  packageFieldBindingsSchema, resolvePackageFieldBinding,
  type PackageFieldBinding, type PackageFieldBindings,
} from './packageFieldBindings';
import { patchPackageBindingDraftFields, type PackageBindingPatch, type PackageBindingValue } from './packageBindingTargets';
import { readPackageMemberDraft } from './actionPackageAssets';
import { sameReviewStoredValue, type StoredAttachment } from './documentsDb';
import { withAttachmentStaging } from './attachments';
import { portableResourceDigest } from './portableResources';
import { packageCitationCandidates, packageCitationOccurrences } from './packageCitations';
import { reviewPackageBindings, reviewPackageInformation, reviewPackageNative, reviewPackageText } from './actionPackageDisclosure';
import { reviewRestoredPackageSources } from './packageRestoredSources';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import type { DocumentFieldSource } from './documentFields';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';

export type PackageUpdateChoice = 'apply-package' | 'keep-local' | 'detach' | 'reconnect';
export type PackageUpdateChoices = Readonly<Record<string, PackageUpdateChoice>>;
export interface PackageUpdatePreview {
  bindingId: string;
  memberId: string;
  label: string;
  state: 'update' | 'unchanged' | 'override' | 'conflict' | 'unavailable' | 'detach';
  before?: PackageBindingValue;
  after?: string | boolean;
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
function sameTarget(left: PackageFieldBinding, right: PackageFieldBinding): boolean {
  return left.factId === right.factId && left.memberId === right.memberId
    && sameReviewStoredValue(left.target, right.target) && left.format === right.format;
}
function informationReviews(revision: PackageRevision, policy: PolicyResolution): ExportReview[] {
  return [
    ...(revision.information ? [reviewPackageInformation(revision.information, policy)] : []),
    ...(revision.bindings ? [reviewPackageBindings(revision.bindings, policy)] : []),
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

/** Retain exact citation occurrences when only a qualified scalar field changed. */
async function preserveUnchangedCitations(revision: PackageRevision): Promise<void> {
  if (!revision.citations) return;
  const candidates = await packageCitationCandidates(revision);
  const occurrences = await packageCitationOccurrences(revision);
  const content = ({ memberRevisionId: _revision, ...value }: { memberRevisionId: string }) => value;
  revision.citations.targets = revision.citations.targets.map(target => {
    const { id, ...binding } = target;
    const candidate = candidates.find(candidate => sameReviewStoredValue(content(candidate.target), content(binding)));
    return candidate ? { id, ...candidate.target } : target;
  });
  revision.citations.links = revision.citations.links.map(link => {
    const occurrence = occurrences.find(occurrence => sameReviewStoredValue(content(occurrence.source), content(link.source)));
    return occurrence ? { ...link, source: occurrence.source } : link;
  });
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
  const retainedChoices = structuredClone(choices);
  const allIds = new Set([...(current.bindings?.items ?? []), ...(bindings?.items ?? [])].map(binding => binding.id));
  for (const [id, choice] of Object.entries(retainedChoices))
    if (!allIds.has(id) || !['apply-package', 'keep-local', 'detach', 'reconnect'].includes(choice))
      throw new Error('A field update choice does not belong to this package plan.');
  const revision: PackageRevision = { ...structuredClone(current), id: newPackageId('revision'), parentId: current.id,
    createdAt: Date.now(), information, bindings, outputs: [] };
  const changes: PackageUpdatePreview[] = [], issues: string[] = [], patches = new Map<string, PackageBindingPatch[]>();
  const kept: PackageFieldBinding[] = [];
  for (const binding of bindings?.items ?? []) {
    signal?.throwIfAborted();
    const prior = current.bindings?.items.find(item => item.id === binding.id);
    if (prior && !sameTarget(prior, binding))
      throw new Error('A link identity cannot change its field or shared value. Detach it and create a new link.');
    const choice = retainedChoices[binding.id];
    if (choice === 'detach') {
      changes.push({ bindingId: binding.id, memberId: binding.memberId, label: binding.id, state: 'detach', message: 'The document value is preserved without a shared link.' });
      continue;
    }
    const previousFact = current.information?.facts.find(fact => fact.id === binding.factId);
    const nextFact = information?.facts.find(fact => fact.id === binding.factId);
    const previousValue = previousFact && { kind: previousFact.kind, value: previousFact.value };
    const nextValue = nextFact && { kind: nextFact.kind, value: nextFact.value };
    const affected = !prior || !sameReviewStoredValue(previousValue, nextValue) || !sameReviewStoredValue(prior, binding) || choice !== undefined;
    const result = await resolvePackageFieldBinding(revision, binding);
    const preview = { bindingId: binding.id, memberId: binding.memberId, label: result.label,
      ...(result.field ? { before: result.field.value } : {}), ...(result.desiredValue !== undefined ? { after: result.desiredValue } : {}) };
    if (!affected) {
      kept.push(binding);
      changes.push({ ...preview, state: result.state === 'override' ? 'override' : 'unchanged', message: result.message });
      continue;
    }
    if (!result.field || result.desiredValue === undefined) {
      kept.push(binding); issues.push(`${result.label}: ${result.message}`);
      changes.push({ ...preview, state: 'unavailable', message: result.message }); continue;
    }
    if (choice === 'keep-local' || (prior?.mode ?? binding.mode) === 'override' && choice !== 'reconnect' && choice !== 'apply-package') {
      kept.push({ ...binding, mode: 'override', expectedValue: result.field.value });
      changes.push({ ...preview, state: 'override', message: 'The deliberate local value is preserved.' }); continue;
    }
    // A new link is an explicit proposal. Existing metadata cannot fabricate a newer last-applied value.
    if (prior && !sameReviewStoredValue(prior.expectedValue, binding.expectedValue))
      throw new Error('The saved last-applied value changed. Prepare the field link again.');
    if (prior && prior.mode === 'linked' && result.field.value !== prior.expectedValue
      && result.field.value !== result.desiredValue && choice !== 'apply-package' && choice !== 'reconnect') {
      kept.push(binding); issues.push(`${result.label}: Choose whether to keep the local edit or apply the package value.`);
      changes.push({ ...preview, state: 'conflict', message: 'This field was edited independently after its last shared update.' }); continue;
    }
    kept.push({ ...binding, mode: 'linked', expectedValue: result.desiredValue });
    if (result.field.value !== result.desiredValue) {
      const updates = patches.get(binding.memberId) ?? [];
      updates.push({ target: binding.target, expected: result.field.value, value: result.desiredValue });
      patches.set(binding.memberId, updates);
      changes.push({ ...preview, state: 'update', message: 'Apply the shared package value.' });
    } else changes.push({ ...preview, state: 'unchanged', message: 'This field already matches the package value.' });
  }
  for (const prior of current.bindings?.items ?? []) if (!(bindings?.items.some(binding => binding.id === prior.id)))
    changes.push({ bindingId: prior.id, memberId: prior.memberId, label: prior.id, state: 'detach', message: 'The document value is preserved without a shared link.' });
  if (bindings) revision.bindings = { version: 1, items: kept };
  const attachments: StoredAttachment[] = [], reviews = [reviewPackageText(before.name, 'Package name', policy),
    ...informationReviews(current, policy), ...informationReviews(revision, policy)];
  if (!issues.length) {
    for (const [memberId, updates] of patches) {
      signal?.throwIfAborted();
      const index = revision.members.findIndex(member => member.id === memberId), member = revision.members[index];
      if (!member || member.kind !== 'native') throw new Error('The linked native member is unavailable.');
      const { draft } = await readPackageMemberDraft(member);
      reviews.push(reviewPackageNative(member.session, member.label, policy, draft as unknown as DocumentFieldSource));
      const patched = await patchPackageBindingDraftFields(draft, updates);
      reviews.push(reviewPackageNative(patched.session, member.label, policy, patched.draft as unknown as DocumentFieldSource));
      const data = new TextEncoder().encode(JSON.stringify(patched.draft)).buffer;
      if (data.byteLength > 25 * 1024 * 1024) throw new Error('An updated native member exceeds the 25 MB package file limit.');
      const asset = { ...member.draft, id: newPackageId('asset'), size: data.byteLength, sha256: await portableResourceDigest(data) };
      attachments.push({ ...asset, data });
      revision.members[index] = { ...member, revisionId: newPackageId('member-revision'), session: patched.session, draft: asset };
    }
    await preserveUnchangedCitations(revision);
  }
  const changed = !sameReviewStoredValue(current.information, revision.information)
    || !sameReviewStoredValue(current.bindings, revision.bindings) || patches.size > 0;
  const after = actionPackageSchema.parse({ ...before, sequence: before.sequence + 1,
    currentRevisionId: revision.id, revisions: [...before.revisions, revision] });
  const prepared = frozen({ packageName: before.name, revisionId: current.id, ready: issues.length === 0,
    changed, changes: structuredClone(changes), issues: [...issues], reviews: structuredClone(reviews) });
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

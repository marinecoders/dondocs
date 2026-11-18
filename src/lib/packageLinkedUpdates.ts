import { newPackageId, type PackageRevision, type NativePackageMember } from './actionPackages';
import { resolvePackageFieldBinding, type PackageFieldBinding } from './packageFieldBindings';
import { patchPackageBindingDraftFields, type PackageBindingPatch } from './packageBindingTargets';
import { readPackageMemberDraft } from './actionPackageAssets';
import { sameReviewStoredValue, type StoredAttachment } from './documentsDb';
import { portableResourceDigest } from './portableResources';
import { packageCitationCandidates, packageCitationOccurrences } from './packageCitations';
import { reviewPackageBindings, reviewPackageInformation, reviewPackageConsistency, reviewPackageWork, reviewPackageNative } from './actionPackageDisclosure';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import type { DocumentFieldSource } from './documentFields';
import type { PackageUpdateChoices, PackageUpdatePreview } from './packageUpdates';

function sameTarget(left: PackageFieldBinding, right: PackageFieldBinding): boolean {
 return left.factId === right.factId && left.memberId === right.memberId
  && sameReviewStoredValue(left.target,right.target) && left.format === right.format;
}
function informationReviews(revision: PackageRevision, policy: PolicyResolution): ExportReview[] {
 return [...(revision.information ? [reviewPackageInformation(revision.information,policy)] : []),
  ...(revision.bindings ? [reviewPackageBindings(revision.bindings,policy)] : []),
  ...(revision.consistency ? [reviewPackageConsistency(revision.consistency,policy)] : []),
  ...(revision.work ? [reviewPackageWork(revision.work,policy)] : [])];
}
/** Retain exact citation occurrences when only a qualified scalar field changed. */
export async function preserveUnchangedCitations(revision: PackageRevision): Promise<void> {
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

/** Shared pure staged field planner for direct information edits and conditional membership changes. */
export async function captureLinkedPackageChanges(
 current: PackageRevision, proposed: PackageRevision, choices: PackageUpdateChoices, policy: PolicyResolution,
 signal?: AbortSignal,
 readDraft: (member: NativePackageMember) => Promise<{ draft: unknown }> = readPackageMemberDraft,
) {
 const revision = structuredClone(proposed), information = revision.information, bindings = revision.bindings;
 const retainedChoices = structuredClone(choices);
 const allIds = new Set([...(current.bindings?.items ?? []), ...(bindings?.items ?? [])].map(binding => binding.id));
 for (const [id, choice] of Object.entries(retainedChoices))
  if (!allIds.has(id) || !['apply-package','keep-local','detach','reconnect'].includes(choice))
   throw new Error('A field update choice does not belong to this package plan.');
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
  const attachments: StoredAttachment[] = [], reviews = [...informationReviews(current, policy), ...informationReviews(revision, policy)];
  if (!issues.length) {
    for (const [memberId, updates] of patches) {
      signal?.throwIfAborted();
      const index = revision.members.findIndex(member => member.id === memberId), member = revision.members[index];
      if (!member || member.kind !== 'native') throw new Error('The linked native member is unavailable.');
      const { draft } = await readDraft(member);
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
  return { revision, changes, issues, reviews, attachments, changed };
}

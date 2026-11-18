import { getPackageRevision, packageRevisionSchema, packageReviewRoundSchema,
  type ActionPackage, type PackageRevision, type PackageReviewRound } from './actionPackages';
import { inspectImpactOutputs, inspectImpactReviews } from './packageChangeImpactEvidence';
import { enrichPackageImpactDependencies } from './packageChangeImpactDependencies';
import { compareImpactMembers, freezePackageImpact, impactChanged, impactInputFits, limitedPackageImpact, sameImpactValue,
  type ImpactRevision, type PackageChangeImpact, type PackageImpactDestination, type PackageImpactItem, type PackageImpactSection } from './packageChangeImpactModel';
export type { PackageChangeImpact, PackageImpactDestination, PackageImpactItem, PackageImpactSection, PackageImpactState } from './packageChangeImpactModel';

export interface PackageImpactOptions { reviewRounds?: readonly PackageReviewRound[]; retainedRevisions?: readonly PackageRevision[]; packageId?: string; signal?: AbortSignal }
type Identified = { id: string };
function compareRows<T extends Identified>(before: readonly T[], after: readonly T[], describe: (value: T) => { label: string; destinations: PackageImpactDestination[] }, message: string): PackageImpactItem[] {
  const previous = new Map(before.map(item => [item.id, item])), next = new Map(after.map(item => [item.id, item]));
  return [...new Set([...previous.keys(), ...next.keys()])].map(id => {
    const a = previous.get(id), b = next.get(id), context = describe(b ?? a!);
    return { id, ...context, state: !a ? 'added' : !b ? 'removed' : sameImpactValue(a, b) ? 'unchanged' : 'changed',
      message: !a ? `Added. ${message}` : !b ? `Removed from this revision. ${message}` : sameImpactValue(a, b) ? 'Captured values match.' : message };
  });
}
function compareMetadata(id: string, label: string, before: unknown, after: unknown, message: string): PackageImpactItem[] {
  if (before === undefined && after === undefined) return [];
  return [{ id, label, state: sameImpactValue(before, after) ? 'unchanged' : 'metadata-only',
    message: sameImpactValue(before, after) ? 'Captured context matches.' : message, destinations: [] }];
}
function compareCitations(before: PackageRevision, after: PackageRevision): PackageImpactItem[] {
  const targets = compareRows(before.citations?.targets ?? [], after.citations?.targets ?? [], target => ({ label: target.kind === 'reference' ? 'Reference target' : 'Enclosure target',
    destinations: [{ memberId: target.memberId, citationId: target.id }] }), 'Citation target content or its captured association changed.');
  for (const item of targets) {
    const a = before.citations?.targets.find(target => target.id === item.id), b = after.citations?.targets.find(target => target.id === item.id);
    if (a && b && a.kind === b.kind && a.memberId === b.memberId && a.itemSha256 === b.itemSha256
      && 'index' in a && 'index' in b && a.index !== b.index) {
      item.state = 'renumbered'; item.message = `List position changed from ${a.index + 1} to ${b.index + 1}; captured item content and target identity match.`;
    }
  }
  const links = compareRows(before.citations?.links ?? [], after.citations?.links ?? [], link => ({ label: 'Linked citation occurrence',
    destinations: [{ memberId: link.source.memberId, citationId: link.id }] }), 'The citation occurrence, target or captured paragraph association changed.');
  for (const item of links) {
    const a = before.citations?.links.find(link => link.id === item.id), b = after.citations?.links.find(link => link.id === item.id);
    if (a && b && a.targetId === b.targetId && a.source.memberId === b.source.memberId && a.source.paragraphId === b.source.paragraphId
      && a.source.field === b.source.field && a.source.kind === b.source.kind && a.source.selectionSha256 === b.source.selectionSha256
      && (a.source.start !== b.source.start || a.source.end !== b.source.end)) {
      item.state = 'moved'; item.message = 'The citation moved within its captured paragraph; selected text and target identity match.';
    }
  }
  return [...targets, ...links];
}

/** Compare owned revision captures. No source file is rewritten and no review or PDF is promoted to a newer revision. */
export async function comparePackageChangeImpact(beforeInput: PackageRevision, afterInput: PackageRevision, options: PackageImpactOptions = {}): Promise<PackageChangeImpact> {
  options.signal?.throwIfAborted();
  const beforeId = packageRevisionSchema.shape.id.parse(beforeInput.id), afterId = packageRevisionSchema.shape.id.parse(afterInput.id);
  const roundsInput = options.reviewRounds ?? [], retainedInput = options.retainedRevisions ?? [];
  if (retainedInput.length > 200) throw new Error('Compare at most 200 retained package revisions.');
  if (roundsInput.length > 100) throw new Error('Compare at most 100 recorded package reviews.');
  if (!impactInputFits([beforeInput, afterInput, roundsInput, retainedInput])) return limitedPackageImpact(beforeId, afterId);
  // Own data synchronously, including sessions accepted through custom validators, before the first checksum await.
  const captured = structuredClone({ before: beforeInput, after: afterInput, rounds: roundsInput, retained: retainedInput });
  const before: ImpactRevision = packageRevisionSchema.parse(captured.before), after: ImpactRevision = packageRevisionSchema.parse(captured.after);
  const retained = captured.retained.map(revision => packageRevisionSchema.parse(revision));
  for (const revision of [before, after, ...retained]) {
    if (new Set(revision.members.map(member => member.id)).size !== revision.members.length) throw new Error('Duplicate package member identity in comparison.');
    if (new Set(revision.outputs.map(output => output.id)).size !== revision.outputs.length) throw new Error('Duplicate retained PDF identity in comparison.');
  }
  const rounds = captured.rounds.map(round => packageReviewRoundSchema.parse(round));
  if (options.packageId && rounds.some(round => round.packageId !== options.packageId)) throw new Error('A review belongs to a different package.');
  if (new Set(rounds.map(round => round.id)).size !== rounds.length) throw new Error('Duplicate package review identity.');
  const content = ({ id: _id, parentId: _parent, createdAt: _time, outputs: _outputs, members, ...value }: PackageRevision) => ({ ...value,
    members: members.map(member => member.kind === 'native' && member.source ? { ...member, source: { ...member.source, local: false } } : member) });
  const identities = new Map<string, PackageRevision>();
  for (const revision of [before, after, ...retained]) {
    const previous = identities.get(revision.id);
    if (previous && !sameImpactValue(content(previous), content(revision))) throw new Error('A saved revision identity cannot describe two different package states.');
    identities.set(revision.id, revision);
  }
  const sections: PackageImpactSection[] = [];
  const add = (kind: PackageImpactSection['kind'], label: string, items: PackageImpactItem[]) => sections.push({ kind, label, items });
  add('member', 'Documents', compareImpactMembers(before, after));
  const factDestinations = (id: string): PackageImpactDestination[] => {
    const revision = after.information?.facts.some(fact => fact.id === id) ? after : before;
    const linked = revision.bindings?.items.filter(binding => binding.factId === id) ?? [];
    return [{ revisionId: revision.id, factId: id }, ...linked.map(binding => ({ revisionId: revision.id, factId: id, memberId: binding.memberId, bindingId: binding.id }))];
  };
  add('fact', 'Shared values', compareRows(before.information?.facts ?? [], after.information?.facts ?? [], fact => ({ label: fact.label, destinations: factDestinations(fact.id) }), 'The shared value, participant context or captured provenance changed.'));
  add('participant', 'People', compareRows(before.information?.participants ?? [], after.information?.participants ?? [], person => ({ label: `${person.label} · ${person.role}`, destinations: [] }), 'The participant label or role context changed.'));
  add('binding', 'Field links', compareRows(before.bindings?.items ?? [], after.bindings?.items ?? [], binding => ({
    label: `${after.members.find(member => member.id === binding.memberId)?.label ?? before.members.find(member => member.id === binding.memberId)?.label ?? 'Unavailable document'} · ${after.information?.facts.find(fact => fact.id === binding.factId)?.label ?? before.information?.facts.find(fact => fact.id === binding.factId)?.label ?? 'Unavailable shared value'}`,
    destinations: [{ memberId: binding.memberId, factId: binding.factId, bindingId: binding.id }] }), 'The linked target, shared-value association or deliberate local override changed.'));
  add('requirement', 'Evidence requirements', compareRows(before.requirements?.items ?? [], after.requirements?.items ?? [], item => ({ label: item.label,
    destinations: [{ requirementId: item.id, ...(item.kind === 'document' && item.memberId ? { memberId: item.memberId } : {}) }] }), 'Declared operations, condition, evidence assignment or user confirmation changed.'));
  add('citation', 'Citations', compareCitations(before, after));
  add('intake', 'Captured intake', compareMetadata('intake', 'Answers and template revision', before.templateState, after.templateState, 'Saved answers, membership declarations or the pinned action template changed.'));
  add('consistency', 'Consistency rules', compareMetadata('consistency', 'Declared consistency rules and exceptions', before.consistency, after.consistency, 'Consistency declarations or the applicability of an explicit exception changed.'));
  add('workflow', 'Local work tracking', compareMetadata('workflow', 'Tasks, owners and dates', before.work, after.work, 'Local task metadata changed. This does not change document content or grant approval.'));
  await enrichPackageImpactDependencies(before, after, sections, options.signal);
  for (const section of sections) for (const item of section.items) for (const destination of item.destinations)
    destination.revisionId ??= item.state === 'removed' ? before.id : after.id;
  const [outputs, reviews] = await Promise.all([inspectImpactOutputs(before, after, retained, options.signal), inspectImpactReviews(rounds, after, options.signal)]);
  add('output', 'Retained PDFs', outputs); add('review', 'Recorded reviews', reviews);
  for (const item of [...outputs, ...reviews]) for (const destination of item.destinations) destination.revisionId = item.capturedRevisionId;
  options.signal?.throwIfAborted();
  const byKind = (kind: PackageImpactSection['kind']) => sections.find(section => section.kind === kind)!.items;
  return freezePackageImpact({ version: 1, beforeRevisionId: before.id, afterRevisionId: after.id,
    changed: sections.some(section => !['output', 'review'].includes(section.kind) && section.items.some(impactChanged)), limited: false, sections,
    summary: { changedMembers: byKind('member').filter(item => ['added', 'removed', 'changed', 'metadata-only'].includes(item.state)).length,
      movedMembers: byKind('member').filter(item => item.beforePosition !== undefined && item.afterPosition !== undefined && item.beforePosition !== item.afterPosition).length, changedFacts: byKind('fact').filter(impactChanged).length,
      affectedOutputs: outputs.filter(item => ['changed', 'metadata-only'].includes(item.state)).length,
      affectedReviews: reviews.filter(item => ['changed', 'metadata-only'].includes(item.state)).length,
      unknownEvidence: sections.reduce((count, section) => count + section.items.filter(item => ['unknown', 'unavailable'].includes(item.state)).length, 0) },
    notices: ['This compares captured package records. Saved file bytes are checked when opened or delivered; matching metadata is not a new rendering or approval.'] });
}

export async function inspectPackageChangeImpact(record: ActionPackage, beforeRevisionId: string, afterRevisionId = record.currentRevisionId, signal?: AbortSignal): Promise<PackageChangeImpact> {
  for (const id of [beforeRevisionId, afterRevisionId])
    if (record.revisions.filter(revision => revision.id === id).length !== 1) throw new Error('The exact comparison revision is unavailable or ambiguous.');
  return comparePackageChangeImpact(getPackageRevision(record, beforeRevisionId), getPackageRevision(record, afterRevisionId),
    { reviewRounds: record.reviewRounds, retainedRevisions: record.revisions.slice(0, record.revisions.findIndex(revision => revision.id === afterRevisionId) + 1).filter(revision => revision.outputs.length), packageId: record.id, signal });
}

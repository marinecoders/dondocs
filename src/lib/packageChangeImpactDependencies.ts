import type { PackageRevision } from './actionPackages';
import { inspectPackageConsistency } from './packageConsistency';
import { resolvePackageFieldBinding } from './packageFieldBindings';
import { resolvePackageCitations } from './packageCitations';
import { sameImpactValue, type PackageImpactSection } from './packageChangeImpactModel';

/** Exact citation owners can become stale without changing the saved citation declaration. */
async function enrichCitationDependencies(before: PackageRevision, after: PackageRevision, section: PackageImpactSection, signal?: AbortSignal): Promise<void> {
  if (!section.items.length) return;
  signal?.throwIfAborted();
  let left: Awaited<ReturnType<typeof resolvePackageCitations>>, right: Awaited<ReturnType<typeof resolvePackageCitations>>;
  try {
    [left, right] = await Promise.all([resolvePackageCitations(before), resolvePackageCitations(after)]);
  } catch {
    signal?.throwIfAborted();
    // Oversized or unsupported captured citation inputs must not turn into an all-clear or block portable editing.
    for (const item of section.items) {
      if (item.state !== 'added' && item.state !== 'removed') item.state = 'unknown';
      item.message = 'Citation applicability could not be resolved within the supported captured-input limits. Inspect the exact saved citation and document.';
    }
    return;
  }
  signal?.throwIfAborted();
  const oldTargets = new Map(left.targets.map(value => [value.target.id, value]));
  const nextTargets = new Map(right.targets.map(value => [value.target.id, value]));
  const oldLinks = new Map(left.links.map(value => [value.link.id, value]));
  const nextLinks = new Map(right.links.map(value => [value.link.id, value]));
  for (const item of section.items) {
    const a = oldTargets.get(item.id), b = nextTargets.get(item.id);
    if (a && b) {
      if (a.state !== b.state) {
        item.state = 'changed'; item.message = `The citation target changed from ${a.state} to ${b.state}. Inspect its exact captured owner before using it.`;
      } else if (a.state === 'current' && a.citationLabel !== b.citationLabel && item.state === 'unchanged') {
        item.state = 'renumbered'; item.message = `The current citation label changed from (${a.citationLabel}) to (${b.citationLabel}); the saved target identity is preserved.`;
      } else if (item.state === 'unchanged') item.message = `The captured citation target and its computed ${b.state} applicability match.`;
      continue;
    }
    const previous = oldLinks.get(item.id), next = nextLinks.get(item.id);
    if (!previous || !next) continue;
    const context = (link: typeof previous) => ({ state: link.state, sourceState: link.sourceState,
      labelMatches: link.labelMatches, targetState: link.target.state, citationLabel: link.target.citationLabel });
    if (!sameImpactValue(context(previous), context(next))) {
      item.state = 'changed'; item.message = `The linked citation's computed applicability changed from ${previous.state} to ${next.state}. Recheck its source, target and displayed label.`;
    } else if (item.state === 'unchanged') item.message = `The captured citation occurrence and its computed ${next.state} applicability match.`;
  }
}

/** A dependency can change while its declaration remains byte-for-byte identical. */
export async function enrichPackageImpactDependencies(before: PackageRevision, after: PackageRevision, sections: PackageImpactSection[], signal?: AbortSignal): Promise<void> {
  const members = sections.find(section => section.kind === 'member')!.items;
  const changed = new Set(members.filter(member => ['added', 'removed', 'changed', 'unknown'].includes(member.state)).map(member => member.id));
  for (const item of sections.find(section => section.kind === 'binding')!.items) {
    signal?.throwIfAborted();
    const a = before.bindings?.items.find(binding => binding.id === item.id), b = after.bindings?.items.find(binding => binding.id === item.id);
    if (!a || !b || item.state !== 'unchanged') continue;
    const oldFact = before.information?.facts.find(fact => fact.id === a.factId), nextFact = after.information?.facts.find(fact => fact.id === b.factId);
    if (!changed.has(a.memberId) && sameImpactValue(oldFact, nextFact)) continue;
    const left = await resolvePackageFieldBinding(before, a), right = await resolvePackageFieldBinding(after, b);
    signal?.throwIfAborted();
    if (members.find(member => member.id === b.memberId)?.state === 'unknown' || !right.field || right.desiredValue === undefined) {
      item.state = 'unknown'; item.message = 'The linked field or shared value is unavailable or incompatible in the compared revision.';
    } else if (!sameImpactValue({ state: left.state, value: left.field?.value, desired: left.desiredValue }, { state: right.state, value: right.field.value, desired: right.desiredValue })) {
      item.state = 'changed'; item.message = right.state === 'override' ? 'This deliberate local override remains preserved; its field or shared-value context changed.'
        : 'This field value, expected shared value or link status changed. Inspect the exact linked field.';
    }
  }
  for (const item of sections.find(section => section.kind === 'requirement')!.items) {
    const requirement = after.requirements?.items.find(value => value.id === item.id);
    if (item.state !== 'unchanged' || requirement?.kind !== 'document' || requirement.condition === 'inactive' || !requirement.memberId || !changed.has(requirement.memberId)) continue;
    const member = members.find(member => member.id === requirement.memberId)!;
    item.state = member.state === 'unknown' ? 'unknown' : 'changed';
    item.message = member.state === 'removed' ? 'The assigned evidence document is no longer included. Review this saved requirement.'
      : 'The assigned evidence document inputs changed. Recheck this requirement against the new captured content.';
  }
  await enrichCitationDependencies(before, after, sections.find(section => section.kind === 'citation')!, signal);
  const consistency = sections.find(section => section.kind === 'consistency')!;
  if (!before.consistency && !after.consistency) return;
  const [left, right] = await Promise.all([inspectPackageConsistency(before, signal), inspectPackageConsistency(after, signal)]);
  consistency.items = [...new Set([...(before.consistency?.rules.map(rule => rule.id) ?? []), ...(after.consistency?.rules.map(rule => rule.id) ?? [])])].map(id => {
    const a = before.consistency?.rules.find(rule => rule.id === id), b = after.consistency?.rules.find(rule => rule.id === id);
    const old = left.findings.find(finding => finding.ruleId === id), next = right.findings.find(finding => finding.ruleId === id);
    const previousException = before.consistency?.exceptions.find(exception => exception.ruleId === id), nextException = after.consistency?.exceptions.find(exception => exception.ruleId === id);
    const state = !a ? 'added' : !b ? 'removed' : old?.state !== next?.state || old?.staleException !== next?.staleException ? 'changed'
      : !sameImpactValue(a, b) || !sameImpactValue(previousException, nextException) ? 'metadata-only' : 'unchanged';
    return { id, label: b?.label ?? a!.label, state,
      message: old?.state !== next?.state && old && next ? `The declared relationship changed from ${old.state} to ${next.state}${next.staleException ? '; its earlier exception no longer applies' : ''}.`
        : state === 'unchanged' ? 'The declared relationship and its computed result match.' : 'The consistency declaration or recorded exception changed.',
      destinations: (next?.destinations ?? old?.destinations ?? []).map(destination => ({ ...destination, revisionId: b ? after.id : before.id })) };
  });
}

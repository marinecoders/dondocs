import type { PackageRevision } from './actionPackages';
import { inspectPackageConsistency } from './packageConsistency';
import { resolvePackageFieldBinding } from './packageFieldBindings';
import { sameImpactValue, type PackageImpactSection } from './packageChangeImpactModel';

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

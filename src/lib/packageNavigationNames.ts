import { packageDocumentName, type PackageRevision } from './actionPackages';

/** Disambiguate repeated filenames in navigation without renaming an original or changing its export. */
export function packageNavigationNames(revision: PackageRevision, history: readonly PackageRevision[] = [revision]): Map<string, string> {
  const people = new Map(revision.information?.participants.map(person => [person.id, person.label]));
  const owners = new Map(revision.templateState?.instances.map(slot => [slot.memberId, people.get(slot.participantId ?? '')]));
  const groups = new Map<string, string[]>();
  const labels = new Map<string, string>();
  for (const member of revision.members) {
    const label = packageDocumentName(revision, member);
    labels.set(member.id, label);
    const copies = groups.get(label) ?? [];
    copies.push(member.id);
    groups.set(label, copies);
  }
  // Use introduction order so a drag operation does not exchange the identities of two copies.
  if (groups.size === revision.members.length) return labels;
  const ordinals = new Map<string, Map<string, number>>();
  for (const saved of history) {
    for (const member of saved.members) {
      const label = labels.get(member.id);
      if (!label || (groups.get(label)?.length ?? 0) < 2) continue;
      const copies = ordinals.get(label) ?? new Map<string, number>();
      if (!copies.has(member.id)) copies.set(member.id, copies.size + 1);
      ordinals.set(label, copies);
    }
    if (saved.id === revision.id) break;
  }
  for (const [label, ids] of groups) {
    if (ids.length < 2) continue;
    const ownerCounts = new Map<string, number>();
    for (const id of ids) {
      const owner = owners.get(id);
      if (owner) ownerCounts.set(owner, (ownerCounts.get(owner) ?? 0) + 1);
    }
    for (const [index, id] of ids.entries()) {
      const owner = owners.get(id);
      const reference = ordinals.get(label)?.get(id) ?? index + 1;
      const context = owner && ownerCounts.get(owner) === 1 ? owner : [owner, 'Copy ' + reference].filter(Boolean).join(' · ');
      labels.set(id, label + ' · ' + context);
    }
  }
  return labels;
}

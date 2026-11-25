import type { PackageRevision } from './actionPackages';

export function indexDeliveryDocuments(revision: PackageRevision) {
  return {
    members: new Map(revision.members.map(member => [member.id, member])),
    slots: new Map(revision.templateState?.instances.map(slot => [slot.memberId, slot])),
  };
}

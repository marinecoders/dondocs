import type { PackageRevision } from './actionPackages';
import type { PackageTemplateV2 } from './packageTemplateSchema';
import { evaluatePackageTemplateCondition } from './packageTemplateProgram';

export interface PackageDeliveryChoice {
  id: string;
  label: string;
  complete: boolean;
  memberIds: string[];
  slotIds: string[];
  confirmationIds: string[];
}

/** Include every file in a selected evidence slot and retain missing slot IDs for readiness. */
export function resolveDeliveryChoices(template: PackageTemplateV2, revision: PackageRevision): PackageDeliveryChoice[] {
  const state = revision.templateState;
  if (!state) return [];
  const answers = state.appliedAnswers ?? state.answers;
  return (template.deliveryChoices ?? []).flatMap(choice => {
    if (choice.when && evaluatePackageTemplateCondition(template.program, answers, choice.when) !== true) return [];
    const slotIds: string[] = [];
    const memberIds: string[] = [];
    if (choice.memberKeys) {
      const activeSlots = state.instances.filter(slot => slot.condition !== false);
      const keysBySlot = new Map(activeSlots.map(slot => [slot.memberId, slot.memberKey]));
      const idsByKey = new Map<string, string[]>();
      for (const member of revision.members) {
        const owner = member.kind === 'original' ? member.evidenceSlotId ?? member.id : member.id;
        const key = keysBySlot.get(owner);
        if (!key) continue;
        const group = idsByKey.get(key) ?? [];
        group.push(member.id);
        idsByKey.set(key, group);
      }
      const includedKeys = new Set(choice.memberKeys);
      slotIds.push(...activeSlots.filter(slot => includedKeys.has(slot.memberKey)).map(slot => slot.memberId));
      for (const key of choice.memberKeys) memberIds.push(...idsByKey.get(key) ?? []);
    } else {
      memberIds.push(...revision.members.map(member => member.id));
    }
    return [{ id: choice.id, label: choice.label, complete: !choice.memberKeys, memberIds, slotIds,
      confirmationIds: choice.confirmationIds ?? [] }];
  });
}

export async function readDeliveryChoices(revision: PackageRevision) {
  if (!revision.templateState?.hasDeliveryChoices) return [];
  const { loadConditionalPackageSource } = await import('./packageConditionalSources');
  const source = await loadConditionalPackageSource(revision);
  return source ? resolveDeliveryChoices(source.template, revision) : [];
}

import type { PackageRevision } from './actionPackages';
import type { PackageTemplateV2 } from './packageTemplateSchema';
import { nextMembershipQuestion } from './packageTemplateProgram';
import { intakeQuestionKey } from './conditionalIntakeView';

export interface PackageQuestionFinding { key: string; label: string }

/** Multiple conditional documents can depend on the same question for the same person. */
export function packageQuestionFindings(template: PackageTemplateV2, revision: PackageRevision) {
  const state = revision.templateState;
  const byId = new Map<string, PackageQuestionFinding>();
  if (!state) return byId;
  const answers = state.answers;
  function add(id: string, declaration: Parameters<typeof nextMembershipQuestion>[2][number], person?: string) {
    const next = nextMembershipQuestion(template.program, answers, [declaration], person);
    const question = next && template.program.questions.find(item => item.id === next.questionId);
    if (!question || !next) return;
    const participant = next.scope && answers.groups[next.scope.groupId]?.find(item => item.id === next.scope?.participantId);
    byId.set(id, { key: intakeQuestionKey(next), label: participant ? participant.label + ' · ' + question.label : question.label });
  }
  for (const slot of state.instances) {
    const declaration = template.members.find(member => member.key === slot.memberKey);
    if (slot.condition === 'unknown' && declaration) add(slot.memberId, declaration, slot.participantId);
  }
  for (const rule of revision.requirements?.items ?? []) {
    if (rule.condition !== 'unknown') continue;
    const declaration = template.program.requirements.find(item => item.id === rule.definitionId);
    if (declaration) add(rule.id, declaration, rule.participantId);
    else if (rule.kind === 'document' && rule.memberId && byId.has(rule.memberId)) byId.set(rule.id, byId.get(rule.memberId)!);
  }
  return byId;
}

import { newPackageId } from './actionPackages';
import { evaluatePackageTemplateProgram,
  type PackageTemplateAnswer, type PackageTemplateAnswers, type PackageTemplateProgram, type PackageTemplateQuestionInstance,
} from './packageTemplateProgram';
import type { PackageTemplateV2 } from './packageTemplateSchema';
import { listConditionalPackageInstances } from './packageConditional';

export function freshPackageTemplateAnswers(program: PackageTemplateProgram): PackageTemplateAnswers {
  return { version: 1, values: {}, groups: Object.fromEntries(program.participantGroups.map(group => [group.id,
    Array.from({ length: group.min }, (_, index) => ({ id: newPackageId('participant'), label: `${group.label} ${index + 1}`, answers: {} })),
  ])) };
}
export function intakeQuestionKey(instance: Pick<PackageTemplateQuestionInstance, 'questionId' | 'scope'>): string {
  return JSON.stringify([instance.questionId, instance.scope?.groupId ?? null, instance.scope?.participantId ?? null]);
}
export function intakeGroupLabel(program: PackageTemplateProgram, groupId: string): string {
  const index = program.participantGroups.findIndex(group => group.id === groupId), group = program.participantGroups[index];
  if (!group) throw new Error('The intake participant group is unavailable.');
  const duplicates = program.participantGroups.filter(value => value.label === group.label);
  return duplicates.length < 2 ? group.label : duplicates.filter(value => value.role === group.role).length < 2
    ? `${group.label} (${group.role})` : `${group.label} (${group.role}) · group ${index + 1}`;
}
function questionLabel(program: PackageTemplateProgram, questionId: string): string {
  const question = program.questions.find(question => question.id === questionId);
  if (!question) throw new Error('The intake question is unavailable.');
  return program.questions.some(value => value.id !== question.id && value.groupId === question.groupId && value.label === question.label)
    ? `${question.label} · ${question.id}` : question.label;
}
export function intakeQuestionLabel(program: PackageTemplateProgram, answers: PackageTemplateAnswers, instance: PackageTemplateQuestionInstance): string {
  const question = program.questions.find(question => question.id === instance.questionId);
  if (!question) throw new Error('The intake question is unavailable.');
  const label = questionLabel(program, question.id);
  if (!instance.scope) return label;
  const group = program.participantGroups.find(group => group.id === instance.scope!.groupId);
  const people = answers.groups[instance.scope.groupId] ?? [], index = people.findIndex(person => person.id === instance.scope!.participantId);
  if (!group || index < 0) throw new Error('The intake participant is unavailable.');
  return `${intakeGroupLabel(program, group.id)} · person ${index + 1} · ${people[index].label.trim() || 'Unnamed person'} · ${label}`;
}
export function withIntakeAnswer(answers: PackageTemplateAnswers, instance: Pick<PackageTemplateQuestionInstance, 'questionId' | 'scope'>, value: PackageTemplateAnswer | undefined): PackageTemplateAnswers {
  const owned = structuredClone(answers);
  const values = instance.scope ? owned.groups[instance.scope.groupId]?.find(person => person.id === instance.scope!.participantId)?.answers : owned.values;
  if (!values) throw new Error('The intake participant is unavailable.');
  if (value === undefined) delete values[instance.questionId]; else values[instance.questionId] = value;
  return owned;
}
export function intakeQuestions(program: PackageTemplateProgram, answers: PackageTemplateAnswers) {
  // A label can be temporarily empty while typing. This display-only fallback never enters a save or materialization input.
  const display = structuredClone(answers), invalidLabels: string[] = [];
  for (const group of program.participantGroups) for (const [index, person] of (display.groups[group.id] ?? []).entries()) {
    if (!person.label.trim() || Array.from(person.label).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      invalidLabels.push(`${group.label} person ${index + 1} needs a single-line label.`); person.label = 'Unnamed person';
    }
  }
  const evaluation = evaluatePackageTemplateProgram(program, display);
  const owners = new Map<string, number>(), definitions = new Map(program.questions.map((question, index) => [question.id, index]));
  let ordinal = 1;
  for (const group of program.participantGroups) for (const person of display.groups[group.id] ?? []) owners.set(JSON.stringify([group.id, person.id]), ordinal++);
  const owner = (instance: PackageTemplateQuestionInstance) => instance.scope ? owners.get(JSON.stringify([instance.scope.groupId, instance.scope.participantId]))! : 0;
  const questions = evaluation.questions.map(instance => ({ instance, key: intakeQuestionKey(instance),
    label: intakeQuestionLabel(program, display, instance), questionLabel: questionLabel(program, instance.questionId), question: program.questions.find(question => question.id === instance.questionId)! }))
    .sort((a, b) => owner(a.instance) - owner(b.instance) || definitions.get(a.instance.questionId)! - definitions.get(b.instance.questionId)!);
  return { evaluation, invalidLabels, questions };
}
export function intakeAttachmentSlots(template: PackageTemplateV2, answers: PackageTemplateAnswers) {
  const instances = listConditionalPackageInstances(template, answers).filter(instance => instance.kind === 'attachment' && instance.condition === true);
  if (instances.length > 100) throw new Error('This intake produces more than 100 active file slots. Use a smaller supported action.');
  return instances.map(instance => {
    const member = template.members.find(member => member.key === instance.memberKey)!;
    const people = member.repeatGroupId ? answers.groups[member.repeatGroupId] ?? [] : [];
    const index = people.findIndex(person => person.id === instance.participantId), person = people[index];
    const duplicate = template.members.some(value => value.key !== member.key && value.kind === 'attachment' && value.label === member.label && value.repeatGroupId === member.repeatGroupId);
    const label = duplicate ? `${member.label} · ${member.key}` : member.label;
    return { key: instance.key, required: instance.required,
      label: person ? `${intakeGroupLabel(template.program, member.repeatGroupId!)} · person ${index + 1} · ${person.label} · ${label}` : label };
  });
}

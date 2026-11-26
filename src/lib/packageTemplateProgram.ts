import { formCompletionSchema } from './packageRequirementsModel';
import { z } from 'zod';
import { packageFactSchema } from './packageInformation';

const identity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => value !== 'prototype' && !Object.hasOwn(Object.prototype, value), 'Reserved template identity.');
const singleLine = (value: string) => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
const label = z.string().trim().min(1).max(160).refine(singleLine, 'Use a single-line label.');
const answerSchema = z.union([z.string().max(10000), z.boolean()]);
export type PackageTemplateAnswer = z.infer<typeof answerSchema>;
export type PackageTemplateTruth = boolean | 'unknown';
export interface PackageTemplateScope { groupId: string; participantId: string }
export type PackageTemplateCondition =
  | { op: 'equals'; questionId: string; value: PackageTemplateAnswer }
  | { op: 'answered'; questionId: string }
  | { op: 'all' | 'any'; conditions: PackageTemplateCondition[] }
  | { op: 'not'; condition: PackageTemplateCondition };
const conditionNode: z.ZodType<PackageTemplateCondition> = z.lazy(() => z.discriminatedUnion('op', [
  z.object({ op: z.literal('equals'), questionId: identity, value: answerSchema }).strict(),
  z.object({ op: z.literal('answered'), questionId: identity }).strict(),
  z.object({ op: z.enum(['all', 'any']), conditions: z.array(conditionNode).min(1).max(20) }).strict(),
  z.object({ op: z.literal('not'), condition: conditionNode }).strict(),
]));
/** Bound before recursive parsing, including cyclic JavaScript inputs. JSON contains no executable expressions. */
export const packageTemplateConditionSchema = z.unknown().transform((input, context): PackageTemplateCondition => {
  const stack = [{ value: input, depth: 1 }], seen = new Set<object>(); let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > 64 || depth > 8) { context.addIssue({ code: 'custom', message: 'Template conditions allow at most 64 nodes and 8 levels.' }); return z.NEVER; }
    if (value && typeof value === 'object') {
      if (seen.has(value)) { context.addIssue({ code: 'custom', message: 'A template condition cannot contain circular or shared expression nodes.' }); return z.NEVER; }
      seen.add(value);
      const node = value as Record<string, unknown>;
      if (Array.isArray(node.conditions)) {
        if (node.conditions.length > 20) { context.addIssue({ code: 'custom', message: 'A condition allows at most 20 children.' }); return z.NEVER; }
        for (const child of node.conditions) stack.push({ value: child, depth: depth + 1 });
      }
      if (node.condition !== undefined) stack.push({ value: node.condition, depth: depth + 1 });
    }
  }
  const parsed = conditionNode.safeParse(input);
  if (!parsed.success) { for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', message: issue.message, path: issue.path }); return z.NEVER; }
  return parsed.data;
});
const questionSchema = z.object({ id: identity, label, kind: z.enum(['text', 'identifier', 'date', 'decimal', 'boolean', 'choice']),
  required: z.boolean(), groupId: identity.optional(), when: packageTemplateConditionSchema.optional(),
  options: z.array(z.object({ id: identity, label }).strict()).min(1).max(50).optional(),
}).strict();
const groupSchema = z.object({ id: identity, label, role: z.enum(['subject', 'requester', 'approver', 'other']), min: z.number().int().min(0).max(20), max: z.number().int().min(1).max(20) }).strict();
const requirementSchema = z.object({ id: identity, label, kind: z.enum(['document', 'confirmation']),
  operations: z.array(z.enum(['review', 'pdf', 'portable'])).min(1).max(3), when: packageTemplateConditionSchema.optional(),
  memberKey: identity.optional(), completion: formCompletionSchema.optional(), repeatGroupId: identity.optional(),
}).strict();
export type PackageTemplateQuestion = z.infer<typeof questionSchema>;
export type PackageTemplateParticipantGroup = z.infer<typeof groupSchema>;
export type PackageTemplateRequirement = z.infer<typeof requirementSchema>;
interface ProgramShape { revision: string; questions: PackageTemplateQuestion[]; participantGroups: PackageTemplateParticipantGroup[]; requirements: PackageTemplateRequirement[] }
export type PackageTemplateProgram = ProgramShape;
function conditionReferences(condition: PackageTemplateCondition): string[] {
  if ('conditions' in condition) return condition.conditions.flatMap(conditionReferences);
  if (condition.op === 'not') return conditionReferences(condition.condition);
  return [condition.questionId];
}
export function packageTemplateConditionNodeCount(condition: PackageTemplateCondition): number {
  return 1 + ('conditions' in condition ? condition.conditions.reduce((sum, child) => sum + packageTemplateConditionNodeCount(child), 0) : condition.op === 'not' ? packageTemplateConditionNodeCount(condition.condition) : 0);
}
function validAnswer(question: PackageTemplateQuestion, value: PackageTemplateAnswer): boolean {
  if (question.kind === 'choice') return typeof value === 'string' && !!question.options?.some(option => option.id === value);
  return packageFactSchema.safeParse({ id: 'answer', label: 'Answer', kind: question.kind, value, source: { kind: 'entered' } }).success;
}
export function templateConditionProblems(program: PackageTemplateProgram, condition: PackageTemplateCondition | undefined, groupId?: string): string[] {
  if (!condition) return [];
  const problems: string[] = [];
  function visit(node: PackageTemplateCondition) {
    if ('conditions' in node) { node.conditions.forEach(visit); return; }
    if (node.op === 'not') { visit(node.condition); return; }
    const question = program.questions.find(question => question.id === node.questionId);
    if (!question) problems.push(`Unknown template question ${node.questionId}.`);
    else if (question.groupId && question.groupId !== groupId) problems.push(`Question ${node.questionId} is outside this participant group.`);
    else if (node.op === 'equals' && !validAnswer(question, node.value)) problems.push(`Condition for ${node.questionId} has an incompatible value or option.`);
  }
  visit(condition); return problems;
}
export const packageTemplateProgramSchema = z.object({ revision: z.string().trim().min(1).max(100).refine(singleLine),
  questions: z.array(questionSchema).max(100), participantGroups: z.array(groupSchema).max(10), requirements: z.array(requirementSchema).max(100),
}).strict().superRefine((program, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  for (const [items, kind] of [[program.questions, 'question'], [program.participantGroups, 'participant group'], [program.requirements, 'requirement']] as const)
    if (new Set(items.map(item => item.id)).size !== items.length) issue(`Duplicate template ${kind} identity.`);
  if (new TextEncoder().encode(JSON.stringify(program)).byteLength > 256 * 1024) issue('Template programs are limited to 256 KB.');
  if (program.participantGroups.reduce((sum, group) => sum + group.max, 0) > 100) issue('Template participant capacity exceeds 100.');
  const groups = new Set(program.participantGroups.map(group => group.id));
  for (const group of program.participantGroups) if (group.min > group.max) issue(`Participant group ${group.id} has reversed limits.`);
  let nodes = 0;
  for (const question of program.questions) {
    if (question.groupId && !groups.has(question.groupId)) issue(`Question ${question.id} has an unknown participant group.`);
    if ((question.kind === 'choice') !== !!question.options) issue(`Question ${question.id} needs options only for a choice.`);
    if (question.options && new Set(question.options.map(option => option.id)).size !== question.options.length) issue(`Question ${question.id} has duplicate options.`);
    templateConditionProblems(program, question.when, question.groupId).forEach(issue);
    if (question.when) nodes += packageTemplateConditionNodeCount(question.when);
  }
  for (const requirement of program.requirements) {
    if (requirement.repeatGroupId && !groups.has(requirement.repeatGroupId)) issue(`Requirement ${requirement.id} has an unknown participant group.`);
    if (requirement.completion && (requirement.kind !== 'document' || !requirement.memberKey)) issue('Completion checks need a document slot.');
    if (requirement.kind === 'confirmation' && requirement.memberKey) issue('A confirmation cannot claim a document member.');
    if (new Set(requirement.operations).size !== requirement.operations.length) issue(`Requirement ${requirement.id} repeats an operation.`);
    templateConditionProblems(program, requirement.when, requirement.repeatGroupId).forEach(issue);
    if (requirement.when) nodes += packageTemplateConditionNodeCount(requirement.when);
  }
  if (nodes > 2048) issue('Template programs allow at most 2048 condition nodes.');
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) { issue('Template question visibility contains a cycle.'); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const question = program.questions.find(question => question.id === id);
    for (const dependency of question?.when ? conditionReferences(question.when) : []) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  program.questions.forEach(question => visit(question.id));
});
const valuesSchema = z.record(identity, answerSchema);
export const packageTemplateAnswersSchema = z.object({ version: z.literal(1), values: valuesSchema,
  groups: z.record(identity, z.array(z.object({ id: identity, label, answers: valuesSchema }).strict()).max(20)),
}).strict().superRefine((answers, context) => {
  const people = Object.values(answers.groups).flat(), ids = people.map(person => person.id);
  if (Object.keys(answers.groups).length > 10) context.addIssue({ code: 'custom', message: 'Template answers allow at most 10 participant groups.' });
  if (people.length > 100 || new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Template participant identities must be unique and limited to 100.' });
  if (Object.keys(answers.values).length + people.reduce((sum, person) => sum + Object.keys(person.answers).length, 0) > 200) context.addIssue({ code: 'custom', message: 'Template answers are limited to 200 values.' });
  if (new TextEncoder().encode(JSON.stringify(answers)).byteLength > 256 * 1024) context.addIssue({ code: 'custom', message: 'Template answers exceed 256 KB.' });
});
export type PackageTemplateAnswers = z.infer<typeof packageTemplateAnswersSchema>;
export interface PackageTemplateAnswerIssue { code: string; message: string; severity: 'error' | 'warning'; questionId?: string; scope?: PackageTemplateScope }
export interface PackageTemplateQuestionInstance { questionId: string; scope?: PackageTemplateScope; visibility: PackageTemplateTruth; answered: boolean; valid: boolean; value?: PackageTemplateAnswer }
export interface PackageTemplateEvaluation { answers: PackageTemplateAnswers; questions: PackageTemplateQuestionInstance[]; issues: PackageTemplateAnswerIssue[]; ready: boolean }
function evaluator(program: PackageTemplateProgram, answers: PackageTemplateAnswers) {
  const visible = new Map<string, PackageTemplateTruth>();
  function answer(question: PackageTemplateQuestion, scope?: PackageTemplateScope): PackageTemplateAnswer | undefined {
    return question.groupId ? scope?.groupId === question.groupId ? answers.groups[scope.groupId]?.find(person => person.id === scope.participantId)?.answers[question.id] : undefined : answers.values[question.id];
  }
  function visibility(question: PackageTemplateQuestion, scope?: PackageTemplateScope): PackageTemplateTruth {
    const key = JSON.stringify([question.id, scope?.groupId, scope?.participantId]);
    if (visible.has(key)) return visible.get(key)!;
    // The schema rejects cycles; this sentinel also prevents recursion through untrusted raw calls.
    visible.set(key, 'unknown'); const value = question.when ? condition(question.when, question.groupId ? scope : undefined) : true;
    visible.set(key, value); return value;
  }
  function condition(rule: PackageTemplateCondition, scope?: PackageTemplateScope): PackageTemplateTruth {
    if (rule.op === 'not') { const result = condition(rule.condition, scope); return result === 'unknown' ? result : !result; }
    if ('conditions' in rule) {
      const values = rule.conditions.map(child => condition(child, scope));
      return rule.op === 'all' ? values.includes(false) ? false : values.includes('unknown') ? 'unknown' : true
        : values.includes(true) ? true : values.includes('unknown') ? 'unknown' : false;
    }
    const question = program.questions.find(question => question.id === rule.questionId);
    if (!question || question.groupId && question.groupId !== scope?.groupId || visibility(question, scope) !== true) return 'unknown';
    const value = answer(question, scope);
    if (value === undefined) return rule.op === 'answered' ? false : 'unknown';
    if (typeof value === 'string' && !value.trim()) return question.kind === 'boolean' ? 'unknown' : rule.op === 'answered' ? false : 'unknown';
    if (!validAnswer(question, value)) return 'unknown';
    return rule.op === 'answered' ? true : value === rule.value;
  }
  return { answer, visibility, condition };
}
/** Find a question the user can answer to decide an unresolved member condition. */
export function nextMembershipQuestion(program: PackageTemplateProgram, answers: PackageTemplateAnswers,
  members: readonly { when?: PackageTemplateCondition; repeatGroupId?: string }[]): Pick<PackageTemplateQuestionInstance, 'questionId' | 'scope'> | undefined {
  const runtime = evaluator(program, answers);
  function unresolved(rule: PackageTemplateCondition, scope?: PackageTemplateScope): ReturnType<typeof nextMembershipQuestion> {
    if (runtime.condition(rule, scope) !== 'unknown') return;
    if (rule.op === 'not') return unresolved(rule.condition, scope);
    if ('conditions' in rule) {
      for (const child of rule.conditions) {
        const next = unresolved(child, scope);
        if (next) return next;
      }
      return;
    }
    const question = program.questions.find(item => item.id === rule.questionId);
    if (!question) return;
    const owner = question.groupId ? scope : undefined;
    if (runtime.visibility(question, owner) === true) return { questionId: question.id, scope: owner };
    if (question.when) return unresolved(question.when, owner);
  }
  for (const member of members) {
    if (!member.when) continue;
    const group = member.repeatGroupId;
    const scopes = group ? (answers.groups[group] ?? []).map(person => ({ groupId: group, participantId: person.id })) : [undefined];
    for (const scope of scopes) {
      const next = unresolved(member.when, scope);
      if (next) return next;
    }
  }
}
/** Supplied state stays owned. Hidden retained values are inspectable but cannot decide branches. */
export function evaluatePackageTemplateProgram(programInput: PackageTemplateProgram, input: unknown): PackageTemplateEvaluation {
  const program = packageTemplateProgramSchema.parse(programInput), answers = packageTemplateAnswersSchema.parse(input), issues: PackageTemplateAnswerIssue[] = [], questions: PackageTemplateQuestionInstance[] = [];
  const runtime = evaluator(program, answers), groups = new Map(program.participantGroups.map(group => [group.id, group]));
  for (const [id] of Object.entries(answers.values)) if (!program.questions.some(question => question.id === id && !question.groupId)) throw new Error(`Unknown global template answer ${id}.`);
  for (const [groupId, people] of Object.entries(answers.groups)) {
    if (!groups.has(groupId)) throw new Error(`Unknown template participant group ${groupId}.`);
    for (const person of people) for (const id of Object.keys(person.answers)) if (!program.questions.some(question => question.id === id && question.groupId === groupId)) throw new Error(`Answer ${id} does not belong to participant group ${groupId}.`);
  }
  for (const group of program.participantGroups) {
    const count = answers.groups[group.id]?.length ?? 0;
    if (count < group.min || count > group.max) issues.push({ code: 'participant-count', severity: 'error', message: `${group.label} needs between ${group.min} and ${group.max} people.` });
  }
  for (const question of program.questions) {
    const scopes = question.groupId ? (answers.groups[question.groupId] ?? []).map(person => ({ groupId: question.groupId!, participantId: person.id })) : [undefined];
    for (const scope of scopes) {
      if (questions.length >= 200) throw new Error('The template produces more than 200 question instances.');
      const visibility = runtime.visibility(question, scope), value = runtime.answer(question, scope), answered = value !== undefined && (typeof value !== 'string' || !!value.trim()), valid = value === undefined || !answered && question.kind !== 'boolean' || validAnswer(question, value);
      questions.push({ questionId: question.id, ...(scope ? { scope } : {}), visibility, answered, valid, ...(value === undefined ? {} : { value }) });
      const context = { questionId: question.id, ...(scope ? { scope } : {}) };
      if (visibility === true && !valid) issues.push({ ...context, code: 'invalid-answer', severity: 'error', message: `${question.label} has an invalid ${question.kind} value.` });
      if (visibility === true && question.required && !answered) issues.push({ ...context, code: 'required-answer', severity: 'error', message: `Answer ${question.label}.` });
      if (visibility !== true && value !== undefined) issues.push({ ...context, code: 'inactive-answer', severity: 'warning', message: `${question.label} retains an inactive answer for inspection; it does not control this template.` });
      if (visibility === 'unknown') issues.push({ ...context, code: 'visibility-unknown', severity: 'warning', message: `Answer the controlling questions to determine whether ${question.label} applies.` });
    }
  }
  return { answers, questions, issues, ready: !issues.some(issue => issue.severity === 'error') && questions.every(question => question.visibility !== 'unknown') };
}
export const validatePackageTemplateAnswers = evaluatePackageTemplateProgram;
export function evaluatePackageTemplateCondition(programInput: PackageTemplateProgram, input: PackageTemplateAnswers, conditionInput: PackageTemplateCondition, scope?: PackageTemplateScope): PackageTemplateTruth {
  const evaluation = evaluatePackageTemplateProgram(programInput, input), program = packageTemplateProgramSchema.parse(programInput), condition = packageTemplateConditionSchema.parse(conditionInput);
  const problems = templateConditionProblems(program, condition, scope?.groupId);
  if (problems.length) throw new Error(problems.join(' '));
  if (scope && !evaluation.answers.groups[scope.groupId]?.some(person => person.id === scope.participantId)) return 'unknown';
  return evaluator(program, evaluation.answers).condition(condition, scope);
}
/** Member rules have the same scoped question contract as questions and operation requirements. */
export function validatePackageTemplateProgramMembers(program: PackageTemplateProgram, members: readonly { key: string; repeatGroupId?: string; when?: PackageTemplateCondition }[]): string[] {
  const problems: string[] = [], keys = new Set(members.map(member => member.key));
  if (keys.size !== members.length) problems.push('Duplicate template member key.');
  for (const member of members) {
    if (member.repeatGroupId && !program.participantGroups.some(group => group.id === member.repeatGroupId)) problems.push(`Member ${member.key} has an unknown participant group.`);
    problems.push(...templateConditionProblems(program, member.when, member.repeatGroupId));
  }
  for (const requirement of program.requirements) if (requirement.memberKey) {
    const member = members.find(member => member.key === requirement.memberKey);
    if (!member) problems.push(`Requirement ${requirement.id} names an unknown member.`);
    else if (member.repeatGroupId !== requirement.repeatGroupId) problems.push(`Requirement ${requirement.id} and its member must use the same participant group.`);
  }
  return problems;
}

import { formCompletionSchema } from './packageRequirementsModel';
import { z } from 'zod';
import { packageRoles } from './packageRoles';
import { packageBindingTargetKey, packageBindingTargetSchema } from './packageBindingTargets';
import { templateConditionProblems, packageTemplateConditionNodeCount, packageTemplateConditionSchema, packageTemplateProgramSchema, validatePackageTemplateProgramMembers } from './packageTemplateProgram';

const legacyIdentity = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const identity = legacyIdentity.refine(value => value !== 'prototype' && !Object.hasOwn(Object.prototype, value), 'Reserved template identity.');
const common = { label: z.string().trim().min(1).max(120), role: z.enum(packageRoles), required: z.boolean() };
export const packageTemplatePageSchema = z.object({ name: z.string().min(1).max(255), type: z.literal('application/pdf'), data: z.string().min(1) }).strict();
export const requiredTemplateFileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('basic-letter'), label: z.string().min(1).max(120) }).strict(),
  z.object({ kind: z.literal('enclosure'), index: z.number().int().min(0).max(999), label: z.string().min(1).max(120) }).strict(),
]);
const native = z.object({ ...common, kind: z.literal('native'), draft: z.record(z.string(), z.unknown()), pages: z.record(z.string().min(1).max(180), packageTemplatePageSchema), requiredFiles: z.array(requiredTemplateFileSchema).max(100).optional() }).strict();
const attachment = z.object({ ...common, kind: z.literal('attachment') }).strict();
/** This exact shape remains the version 1 portable/storage contract. */
export const packageTemplateV1Schema = z.object({
  kind: z.literal('dondocs-package-template'), version: z.literal(1),
  id: legacyIdentity, name: z.string().trim().min(1).max(120), createdAt: z.number().int().nonnegative(),
  members: z.array(z.discriminatedUnion('kind', [native, attachment])).min(1).max(100),
}).strict();
const link = z.object({ questionId: identity, target: packageBindingTargetSchema, format: z.enum(['field', 'uppercase']) }).strict();
const extensions = { blankPdf: packageTemplatePageSchema.optional(), completion: formCompletionSchema.optional(), key: identity, when: packageTemplateConditionSchema.optional(), repeatGroupId: identity.optional(), links: z.array(link).max(100).optional() };
const keyList = z.array(identity).min(1).max(100).refine(keys => new Set(keys).size === keys.length, 'Duplicate delivery key.');
const deliveryChoiceSchema = z.object({
  id: identity, label: z.string().trim().min(1).max(100).refine(label => Array.from(label).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127), 'Use a single-line delivery label.'),
  memberKeys: keyList.optional(), confirmationIds: keyList.optional(), when: packageTemplateConditionSchema.optional(),
}).strict();
export const packageTemplateV2Schema = packageTemplateV1Schema.omit({ version: true, members: true, id: true }).extend({
  id: identity, primaryMemberKey: identity.optional(), deliveryChoices: z.array(deliveryChoiceSchema).min(1).max(12).optional(), version: z.literal(2), program: packageTemplateProgramSchema,
  members: z.array(z.discriminatedUnion('kind', [native.extend({ ...extensions, pagesFrom: identity.optional(), endorses: identity.optional() }), attachment.extend({ ...extensions, multipleFiles: z.literal(true).optional() })])).min(1).max(100),
}).strict().superRefine((template, context) => {
  const problem = (message: string) => context.addIssue({ code: 'custom', message });
  validatePackageTemplateProgramMembers(template.program, template.members).forEach(problem);
  const main = template.members[0];
  if (!main || (template.primaryMemberKey ? main.key !== template.primaryMemberKey : main.role !== 'basic-letter') || !main.required || main.when || main.repeatGroupId || template.members.slice(1).some(member => member.role === 'basic-letter'))
    problem('Version 2 templates must start with exactly one required, unconditional, nonrepeating main document.');
  let nodes = [...template.program.questions, ...template.program.requirements].reduce((sum, item) => sum + (item.when ? packageTemplateConditionNodeCount(item.when) : 0), 0), links = 0;
  const choices = template.deliveryChoices ?? [];
  if (new Set(choices.map(choice => choice.id)).size !== choices.length) problem('Duplicate delivery choice.');
  if (choices.filter(choice => !choice.memberKeys).length > 1) problem('Only one choice can include the whole package.');
  for (const choice of choices) {
    templateConditionProblems(template.program, choice.when).forEach(problem);
    if (choice.when) nodes += packageTemplateConditionNodeCount(choice.when);
    if (choice.memberKeys?.some(key => !template.members.some(member => member.key === key))) problem('Unknown delivery member.');
    if (choice.confirmationIds?.some(id => !template.program.requirements.some(rule => rule.id === id && rule.kind === 'confirmation' && rule.operations.includes('pdf')))) problem('Unknown delivery confirmation.');
  }
  for (const member of template.members) {
    if (member.kind === 'attachment' && member.multipleFiles &&
        (member.role === 'basic-letter' || member.role === 'endorsement' || member.completion || member.blankPdf || member.key === template.primaryMemberKey))
      problem('Multiple files require a supporting evidence slot.');
    if (member.kind === 'native' && member.endorses) {
      const letter = template.members.slice(0, template.members.indexOf(member)).find(item => item.key === member.endorses);
      if (member.role !== 'endorsement' || letter?.kind !== 'native' ||
          !['basic-letter', 'supporting-document'].includes(letter.role) || letter.draft.documentCategory === 'forms' ||
          letter.repeatGroupId && letter.repeatGroupId !== member.repeatGroupId)
        problem('An endorsement must reference an earlier correspondence member in its participant scope.');
    }
    if (member.when) nodes += packageTemplateConditionNodeCount(member.when);
    links += member.links?.length ?? 0;
    if (member.kind === 'attachment' && member.links?.length) problem('Original attachment slots cannot declare native field links.');
    const targets = new Set<string>();
    for (const item of member.links ?? []) {
      const question = template.program.questions.find(question => question.id === item.questionId);
      if (!question) problem(`Member ${member.key} links an unknown question.`);
      else if (question.groupId && question.groupId !== member.repeatGroupId) problem(`Member ${member.key} links a question outside its participant group.`);
      const target = packageBindingTargetKey(item.target);
      if (targets.has(target)) problem(`Member ${member.key} links the same field more than once.`);
      targets.add(target);
    }
  }
  if (nodes > 2048) problem('Template programs and members allow at most 2048 condition nodes.');
  if (links > 500) problem('Templates allow at most 500 native field link declarations.');
});
export const packageTemplateSchema = z.discriminatedUnion('version', [packageTemplateV1Schema, packageTemplateV2Schema]);
export type PackageTemplate = z.infer<typeof packageTemplateSchema>;
export type PackageTemplateV1 = z.infer<typeof packageTemplateV1Schema>;
export type PackageTemplateV2 = z.infer<typeof packageTemplateV2Schema>;
export type PackageTemplateMember = PackageTemplate['members'][number];
export type RequiredNativeFile = z.infer<typeof requiredTemplateFileSchema>;
type NativeTemplateMember = Extract<PackageTemplateMember, { kind: 'native' }>;

/** A repeated member owns its draft and borrows the first member's immutable PDF backgrounds. */
export function templateMemberPages(template: PackageTemplate, member: NativeTemplateMember): NativeTemplateMember['pages'] {
  if (!('pagesFrom' in member) || !member.pagesFrom) return member.pages;
  const source = template.members.find(item => 'key' in item && item.key === member.pagesFrom);
  if (!source || source.kind !== 'native' || source === member || ('pagesFrom' in source && source.pagesFrom)
    || Object.keys(member.pages).length || !Object.keys(source.pages).length) {
    throw new Error('A shared template background must reference a native member with its own retained pages.');
  }
  return source.pages;
}

/** Includes all declarations and branch literals, even when no current action would select them. */
export function packageTemplateProgramText(template: PackageTemplate): string {
  if (template.version !== 2) return '';
  const owned = packageTemplateV2Schema.parse(template);
  const strings: string[] = [];
  function collect(value: unknown): void {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => { strings.push(key); collect(child); });
  }
  collect(owned.program);
  collect(owned.deliveryChoices);
  for (const { key, when, repeatGroupId, links } of owned.members) collect({ key, when, repeatGroupId, links });
  return strings.join('\n');
}

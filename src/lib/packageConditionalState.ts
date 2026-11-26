import { z } from 'zod';
import { packageTemplateAnswersSchema } from './packageTemplateProgram';
import { packageBindingTargetSchema, packageBindingTargetKey } from './packageBindingTargets';
import { packageRequirementsSchema } from './packageRequirementsModel';

const identity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => value !== 'prototype' && !Object.hasOwn(Object.prototype, value), 'Reserved template state identity.');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().trim().min(1).max(160);
const pdfResource = z.object({ id: identity, name: z.string().min(1).max(255), type: z.literal('application/pdf'),
  size: z.number().int().positive().max(25 * 1024 * 1024), sha256: digest }).strict();
export const MAX_ACTION_TEMPLATE_BYTES = 20 * 1024 * 1024;
const sourceSchema = z.object({ id: identity, name: z.string().min(1).max(255), type: z.literal('application/json'),
  size: z.number().int().positive().max(MAX_ACTION_TEMPLATE_BYTES), sha256: digest,
  // Older captures contain the full template inline.
  resources: z.object({ templateSha256: digest, pdfs: z.array(pdfResource).min(1).max(256) }).strict().optional(),
}).strict();
export type CapturedTemplateSource = z.infer<typeof sourceSchema>;
export function templateSourceAssets({ resources, ...descriptor }: CapturedTemplateSource) {
  return [descriptor, ...resources?.pdfs ?? []];
}
export const packageTemplateUpgradeSchema = z.object({ id: identity, source: sourceSchema, templateId: identity,
  templateRevision: z.string().trim().min(1).max(100), answers: packageTemplateAnswersSchema,
  appliedAnswers: packageTemplateAnswersSchema.optional(), questionMappings: z.record(identity, identity.nullable()),
  memberMappings: z.record(identity, identity.nullable()), requirements: packageRequirementsSchema.optional(), createdAt: z.number().int().nonnegative() }).strict();
export function packageTemplateInstanceKey(memberKey: string, participantId?: string): string {
  return JSON.stringify([memberKey, participantId ?? null]);
}
export function packageTemplateFactKey(questionId: string, participantId?: string): string {
  return JSON.stringify([questionId, participantId ?? null]);
}

/** Definitions live in one owned immutable asset, rather than being copied into every revision. */
export const packageConditionalStateSchema = z.object({
  version: z.literal(1),
  source: sourceSchema,
  upgrades: z.array(packageTemplateUpgradeSchema).max(10).optional(),
  templateId: identity,
  primaryMemberKey: identity.optional(),
  hasDeliveryChoices: z.literal(true).optional(),
  templateRevision: z.string().trim().min(1).max(100),
  pending: z.boolean(),
  answers: packageTemplateAnswersSchema,
  appliedAnswers: packageTemplateAnswersSchema.optional(),
  facts: z.array(z.object({ questionId: identity, participantId: identity.optional(), factId: identity,
    appliedValue: z.union([z.string().max(10000), z.boolean()]).optional() }).strict()).max(200),
  instances: z.array(z.object({ key: z.string().min(1).max(220), memberKey: identity, participantId: identity.optional(),
    memberId: identity, label, required: z.boolean(), condition: z.union([z.boolean(), z.literal('unknown')]),
    generatedDigest: digest.optional(), suppressed: z.boolean().optional(), targets: z.array(z.object({ questionId: identity, target: packageBindingTargetSchema,
      format: z.enum(['field', 'uppercase']), linkId: identity, initialized: z.boolean() }).strict()).max(100).optional() }).strict()).max(100),
  requirementIds: z.array(z.object({ key: z.string().min(1).max(260), id: identity }).strict()).max(200),
}).strict().superRefine((state, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (new Set(state.upgrades?.map(item => item.id)).size !== (state.upgrades?.length ?? 0)) issue('Duplicate captured template upgrade identity.');
  if (new Set(state.facts.map(fact => packageTemplateFactKey(fact.questionId, fact.participantId))).size !== state.facts.length
    || new Set(state.facts.map(fact => fact.factId)).size !== state.facts.length) issue('Duplicate conditional fact mapping.');
  if (new Set(state.instances.map(instance => instance.key)).size !== state.instances.length
    || new Set(state.instances.map(instance => instance.memberId)).size !== state.instances.length) issue('Duplicate conditional member mapping.');
  for (const instance of state.instances)
    if (instance.key !== packageTemplateInstanceKey(instance.memberKey, instance.participantId)) issue('A conditional member key does not match its identity.');
  for (const instance of state.instances) {
    const targets = instance.targets ?? [];
    if (new Set(targets.map(item => item.linkId)).size !== targets.length || new Set(targets.map(item => packageBindingTargetKey(item.target))).size !== targets.length)
      issue('Duplicate conditional field target identity.');
  }
  const linkIds = state.instances.flatMap(instance => (instance.targets ?? []).map(target => target.linkId));
  if (new Set(linkIds).size !== linkIds.length) issue('Duplicate conditional field link identity across documents.');
  if (new Set(state.requirementIds.map(requirement => requirement.key)).size !== state.requirementIds.length
    || new Set(state.requirementIds.map(requirement => requirement.id)).size !== state.requirementIds.length) issue('Duplicate conditional requirement mapping.');
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 768 * 1024) issue('Conditional intake state exceeds 768 KB.');
});
export type PackageConditionalState = z.infer<typeof packageConditionalStateSchema>;
export const MAX_CONDITIONAL_HISTORY_BYTES = 16 * 1024 * 1024;

/** Review labels, inactive answers and identity mappings as well as currently visible answers. */
export function conditionalStateText(state: PackageConditionalState): string {
  const strings: string[] = [];
  function visit(value: unknown): void {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { strings.push(key); visit(child); }
  }
  visit(state); return strings.join('\n');
}

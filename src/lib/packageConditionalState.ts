import { z } from 'zod';
import { packageTemplateAnswersSchema } from './packageTemplateProgram';

const identity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => value !== 'prototype' && !Object.hasOwn(Object.prototype, value), 'Reserved template state identity.');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().trim().min(1).max(160);
export function packageTemplateInstanceKey(memberKey: string, participantId?: string): string {
  return JSON.stringify([memberKey, participantId ?? null]);
}
export function packageTemplateFactKey(questionId: string, participantId?: string): string {
  return JSON.stringify([questionId, participantId ?? null]);
}

/** Definitions live in one owned immutable asset, rather than being copied into every revision. */
export const packageConditionalStateSchema = z.object({
  version: z.literal(1),
  source: z.object({ id: identity, name: z.string().min(1).max(255), type: z.literal('application/json'),
    size: z.number().int().positive().max(12 * 1024 * 1024), sha256: digest }).strict(),
  templateId: identity,
  templateRevision: z.string().trim().min(1).max(100),
  pending: z.boolean(),
  answers: packageTemplateAnswersSchema,
  appliedAnswers: packageTemplateAnswersSchema.optional(),
  facts: z.array(z.object({ questionId: identity, participantId: identity.optional(), factId: identity }).strict()).max(200),
  instances: z.array(z.object({ key: z.string().min(1).max(220), memberKey: identity, participantId: identity.optional(),
    memberId: identity, label, required: z.boolean(), condition: z.union([z.boolean(), z.literal('unknown')]),
    generatedDigest: digest.optional() }).strict()).max(100),
  requirementIds: z.array(z.object({ key: z.string().min(1).max(220), id: identity }).strict()).max(200),
}).strict().superRefine((state, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (new Set(state.facts.map(fact => packageTemplateFactKey(fact.questionId, fact.participantId))).size !== state.facts.length
    || new Set(state.facts.map(fact => fact.factId)).size !== state.facts.length) issue('Duplicate conditional fact mapping.');
  if (new Set(state.instances.map(instance => instance.key)).size !== state.instances.length
    || new Set(state.instances.map(instance => instance.memberId)).size !== state.instances.length) issue('Duplicate conditional member mapping.');
  for (const instance of state.instances)
    if (instance.key !== packageTemplateInstanceKey(instance.memberKey, instance.participantId)) issue('A conditional member key does not match its identity.');
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

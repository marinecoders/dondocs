import { z } from 'zod';

const identity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => value !== 'prototype' && !Object.hasOwn(Object.prototype, value), 'Reserved consistency identity.');
const singleLine = (value: string) => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
export const packageConsistencyRuleSchema = z.object({
  id: identity,
  label: z.string().trim().min(1).max(160).refine(singleLine, 'Use a single-line relationship label.'),
  relation: z.enum(['equal', 'date-on-or-before']),
  leftFactId: identity,
  rightFactId: identity,
  participantId: identity.optional(),
  required: z.boolean(),
}).strict().refine(rule => rule.leftFactId !== rule.rightFactId, 'Choose two different package values.');
export const packageConsistencyExceptionSchema = z.object({
  ruleId: identity,
  reason: z.string().trim().min(1).max(2000).refine(value => Array.from(value).every(character => {
    const code = character.charCodeAt(0); return code !== 127 && (code >= 32 || [9, 10, 13].includes(code));
  }), 'Unsupported control character in the exception reason.'),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const packageConsistencySchema = z.object({
  version: z.literal(1),
  rules: z.array(packageConsistencyRuleSchema).max(100),
  exceptions: z.array(packageConsistencyExceptionSchema).max(100),
}).strict().superRefine((value, context) => {
  const ids = new Set(value.rules.map(rule => rule.id));
  if (ids.size !== value.rules.length) context.addIssue({ code: 'custom', message: 'Duplicate consistency rule identity.' });
  if (new Set(value.exceptions.map(exception => exception.ruleId)).size !== value.exceptions.length)
    context.addIssue({ code: 'custom', message: 'Duplicate consistency exception.' });
  if (value.exceptions.some(exception => !ids.has(exception.ruleId)))
    context.addIssue({ code: 'custom', message: 'A consistency exception has no declared relationship.' });
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 256 * 1024)
    context.addIssue({ code: 'custom', message: 'Package consistency declarations exceed the 256 KB limit.' });
});
export type PackageConsistency = z.infer<typeof packageConsistencySchema>;
export type PackageConsistencyRule = z.infer<typeof packageConsistencyRuleSchema>;
export type PackageConsistencyException = z.infer<typeof packageConsistencyExceptionSchema>;
export const MAX_PACKAGE_CONSISTENCY_HISTORY_BYTES = 8 * 1024 * 1024;

/** Semantics stay attached to the same values/person under a relationship identity. */
export function packageConsistencyRuleIdentity(rule: PackageConsistencyRule): string {
  return JSON.stringify([rule.relation, rule.leftFactId, rule.rightFactId, rule.participantId ?? null]);
}
export function packageConsistencyText(value: PackageConsistency): string {
  const strings: string[] = [];
  const collect = (item: unknown): void => {
    if (typeof item === 'string') strings.push(item);
    else if (Array.isArray(item)) item.forEach(collect);
    else if (item && typeof item === 'object') Object.values(item).forEach(collect);
  };
  collect(packageConsistencySchema.parse(value)); return strings.join('\n');
}

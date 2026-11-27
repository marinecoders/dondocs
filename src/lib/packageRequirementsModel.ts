import { z } from 'zod';

const identity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => !Object.hasOwn(Object.prototype, value) && value !== 'prototype', 'Reserved requirement identity.');
const label = z.string().trim().min(1).max(160).refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), 'Use a single-line requirement label.');
export const packageRequirementOperationSchema = z.enum(['review', 'pdf', 'portable']);
export type PackageRequirementOperation = z.infer<typeof packageRequirementOperationSchema>;
const common = {
  id: identity,
  definitionId: identity.optional(),
  participantId: identity.optional(),
  label,
  operations: z.array(packageRequirementOperationSchema).min(1).max(3).refine(values => new Set(values).size === values.length, 'Duplicate requirement operation.'),
  condition: z.enum(['active', 'inactive', 'unknown']),
};
export const formCompletionSchema = z.object({
  expectedForm: z.object({ id: identity, edition: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/) }).strict().optional(),
  requiredPdfFields: z.array(z.string().trim().min(1).max(250)).min(1).max(100).optional(),
  answerGroups: z.array(z.object({
    label,
    alternatives: z.array(z.array(z.string().trim().min(1).max(250)).min(1).max(12)).min(1).max(32),
    beforeSignatures: z.array(z.string().trim().min(1).max(250)).min(1).max(32).optional(),
  }).strict()).min(1).max(20).optional(),
  pdfSelections: z.array(z.object({
    field: z.string().min(1).max(250), label,
    expected: z.union([z.null(), z.boolean(), z.array(z.string().min(1).max(500)).min(1).max(16)]),
    initialize: z.literal(true).optional(),
  }).strict()).min(1).max(32).optional(),
  deliveryBlockReason: label.optional(),
  reviewedScan: z.literal(true).optional(),
  writtenContent: z.literal(true).optional(),
  blankSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  handwrittenSignature: z.literal(true).optional(),
  signatureFields: z.array(z.string().trim().min(1).max(250)).min(1).max(32).optional(),
  signatureLabels: z.record(z.string().min(1).max(250), label).optional(),
}).strict().refine(rule => Object.keys(rule.signatureLabels ?? {}).every(field => rule.signatureFields?.includes(field)),
  'A signature label must refer to a required signature field.');
export type FormCompletion = z.infer<typeof formCompletionSchema>;
export const packageRequirementSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('document'), memberId: identity.optional(), memberRevisionId: identity.optional(), completion: formCompletionSchema.optional() }).strict(),
  z.object({ ...common, kind: z.literal('confirmation'), confirmed: z.boolean().optional() }).strict(),
]);
export type PackageRequirement = z.infer<typeof packageRequirementSchema>;
export const packageRequirementsSchema = z.object({ version: z.literal(1), items: z.array(packageRequirementSchema).max(500) }).strict()
  .superRefine((value, context) => {
    if (value.items.some(item => item.kind === 'document' && item.memberRevisionId && !item.memberId))
      context.addIssue({ code: 'custom', message: 'A saved document version needs its member identity.' });
    const declarations = value.items.filter(item => item.definitionId !== undefined).map(item => JSON.stringify([item.definitionId, item.participantId]));
    if (new Set(declarations).size !== declarations.length) context.addIssue({ code: 'custom', message: 'Duplicate requirement definition and person.' });
    if (new Set(value.items.map(item => item.id)).size !== value.items.length)
      context.addIssue({ code: 'custom', message: 'Duplicate package requirement identity.' });
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 256 * 1024)
      context.addIssue({ code: 'custom', message: 'Package requirements exceed the 256 KB limit.' });
  });
export type PackageRequirements = z.infer<typeof packageRequirementsSchema>;
export const MAX_PACKAGE_REQUIREMENTS_HISTORY_BYTES = 8 * 1024 * 1024;

export function hasPinnedCompletionMember(item: PackageRequirement, fromTemplate: boolean) {
  return fromTemplate && item.kind === 'document' && item.completion !== undefined && (item.definitionId === undefined || item.completion.expectedForm !== undefined);
}

export function requirementDeclaration(item: PackageRequirement, fromTemplate: boolean) {
  if (item.kind === 'confirmation') {
    const { confirmed: _confirmed, ...declaration } = item;
    return declaration;
  }
  if (hasPinnedCompletionMember(item, fromTemplate)) return item;
  const { memberId: _member, memberRevisionId: _revision, ...declaration } = item;
  return declaration;
}

/** Requirements are declared slots; only inspection of captured resources derives document completion. */
export function materializePackageRequirements(proposed: PackageRequirements, previous?: PackageRequirements): PackageRequirements {
  const next = packageRequirementsSchema.parse(proposed), retained = previous ? packageRequirementsSchema.parse(previous) : undefined;
  return packageRequirementsSchema.parse({ version: 1, items: next.items.map(item => {
    const prior = retained?.items.find(value => value.id === item.id && value.definitionId === item.definitionId
      && value.participantId === item.participantId && value.kind === item.kind);
    if (!prior || hasPinnedCompletionMember(item, true)) return item;
    if (item.kind === 'document' && prior.kind === 'document')
      return { ...item, ...(prior.memberId && { memberId: prior.memberId }), ...(prior.memberRevisionId && { memberRevisionId: prior.memberRevisionId }) };
    if (item.kind === 'confirmation' && prior.kind === 'confirmation')
      return { ...item, ...(prior.confirmed === undefined ? {} : { confirmed: prior.confirmed }) };
    return item;
  }) });
}
export function packageRequirementsText(requirements: PackageRequirements): string {
  const strings: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(packageRequirementsSchema.parse(requirements));
  return strings.join('\n');
}

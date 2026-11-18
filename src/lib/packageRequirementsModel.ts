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
export const packageRequirementSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('document'), memberId: identity.optional() }).strict(),
  z.object({ ...common, kind: z.literal('confirmation'), confirmed: z.boolean().optional() }).strict(),
]);
export type PackageRequirement = z.infer<typeof packageRequirementSchema>;
export const packageRequirementsSchema = z.object({ version: z.literal(1), items: z.array(packageRequirementSchema).max(500) }).strict()
  .superRefine((value, context) => {
    const declarations = value.items.filter(item => item.definitionId !== undefined).map(item => JSON.stringify([item.definitionId, item.participantId]));
    if (new Set(declarations).size !== declarations.length) context.addIssue({ code: 'custom', message: 'Duplicate requirement definition and person.' });
    if (new Set(value.items.map(item => item.id)).size !== value.items.length)
      context.addIssue({ code: 'custom', message: 'Duplicate package requirement identity.' });
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 256 * 1024)
      context.addIssue({ code: 'custom', message: 'Package requirements exceed the 256 KB limit.' });
  });
export type PackageRequirements = z.infer<typeof packageRequirementsSchema>;
export const MAX_PACKAGE_REQUIREMENTS_HISTORY_BYTES = 8 * 1024 * 1024;

/** Requirements are declared slots; only inspection of captured resources derives document completion. */
export function materializePackageRequirements(proposed: PackageRequirements, previous?: PackageRequirements): PackageRequirements {
  const next = packageRequirementsSchema.parse(proposed), retained = previous ? packageRequirementsSchema.parse(previous) : undefined;
  return packageRequirementsSchema.parse({ version: 1, items: next.items.map(item => {
    const prior = retained?.items.find(value => value.id === item.id && value.definitionId === item.definitionId
      && value.participantId === item.participantId && value.kind === item.kind);
    if (!prior) return item;
    if (item.kind === 'document' && prior.kind === 'document')
      return { ...item, ...(prior.memberId === undefined ? {} : { memberId: prior.memberId }) };
    if (item.kind === 'confirmation' && prior.kind === 'confirmation')
      return { ...item, ...(prior.confirmed === undefined ? {} : { confirmed: prior.confirmed }) };
    return item;
  }) });
}
export function packageRequirementsText(requirements: PackageRequirements): string {
  const value = packageRequirementsSchema.parse(requirements);
  return JSON.stringify(value);
}

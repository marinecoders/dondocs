import { z } from 'zod';

const identity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const retainedText = z.string().max(32000).refine(value => Array.from(value).every(character => character.charCodeAt(0) !== 127
  && (character.charCodeAt(0) >= 32 || ['\n', '\r', '\t'].includes(character))), 'Unsupported control character in signing metadata.');
const asset = z.object({ id: identity, name: z.string().min(1).max(255), type: z.string().min(1).max(100),
  size: z.number().int().positive().max(25 * 1024 * 1024), sha256: digest }).strict();
export const packageSigningTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('output'), id: identity }).strict(),
  z.object({ kind: z.literal('member'), id: identity, revisionId: identity }).strict(),
]);
export type PackageSigningTarget = z.infer<typeof packageSigningTargetSchema>;
export const packageSigningReturnSchema = z.object({
  id: identity, signingReturnId: z.string().uuid(), memberId: identity, appliedRevisionId: identity,
  createdAt: z.number().int().nonnegative(), returnedAsset: asset, recordAsset: asset,
  assessment: z.enum(['unchanged', 'checks-agree', 'different', 'inconclusive']), acceptedMismatch: z.boolean(),
  metadataText: retainedText,
}).strict().refine(value => value.assessment === 'checks-agree' || value.acceptedMismatch,
  'A differing or inconclusive return needs an explicit package association decision.');
export type PackageSigningReturn = z.infer<typeof packageSigningReturnSchema>;
export const packageSigningHandoffSchema = z.object({
  id: identity, packageId: identity, sourceRevisionId: identity, target: packageSigningTargetSchema,
  sourceSha256: digest, contextSha256: digest, signingRecordId: z.string().uuid(), handoffId: z.string().uuid(),
  createdAt: z.number().int().nonnegative(), recordAsset: asset,
  pdfs: z.object({ source: asset, handoff: asset }).strict(),
  returns: z.array(packageSigningReturnSchema).max(10).optional(),
  metadataText: retainedText, signers: z.array(z.string().max(512)).max(1030),
}).strict().refine(value => value.sourceSha256 === value.pdfs.source.sha256, 'The signing source checksum does not match its retained file.')
  .refine(value => new Set(value.returns?.map(item => item.id)).size === (value.returns?.length ?? 0)
    && new Set(value.returns?.map(item => item.signingReturnId)).size === (value.returns?.length ?? 0)
    && new Set(value.returns?.map(item => item.returnedAsset.sha256)).size === (value.returns?.length ?? 0), 'Duplicate exact package signing return.');
export type PackageSigningHandoff = z.infer<typeof packageSigningHandoffSchema>;
export const packageSigningSchema = z.object({ version: z.literal(1), handoffs: z.array(packageSigningHandoffSchema).max(10) }).strict()
  .superRefine((value, context) => {
    if (new Set(value.handoffs.map(item => item.id)).size !== value.handoffs.length)
      context.addIssue({ code: 'custom', message: 'Duplicate package signing identity.' });
    if (new Set(value.handoffs.map(item => `${item.signingRecordId}:${item.handoffId}`)).size !== value.handoffs.length)
      context.addIssue({ code: 'custom', message: 'A signing handoff is already captured in this package.' });
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 512 * 1024)
      context.addIssue({ code: 'custom', message: 'Package signing metadata exceeds the 512 KB limit.' });
  });
export type PackageSigning = z.infer<typeof packageSigningSchema>;
export const MAX_PACKAGE_SIGNING_HISTORY_BYTES = 8 * 1024 * 1024;
export function packageSigningAssets(value: PackageSigning) {
  return value.handoffs.flatMap(item => [item.recordAsset, item.pdfs.source, item.pdfs.handoff, ...item.returns?.flatMap(returned => [returned.recordAsset, returned.returnedAsset]) ?? []]);
}
export function packageSigningText(value: PackageSigning): string {
  const strings: string[] = [];
  function collect(input: unknown): void {
    if (typeof input === 'string') strings.push(input);
    else if (Array.isArray(input)) input.forEach(collect);
    else if (input && typeof input === 'object') Object.values(input).forEach(collect);
  }
  collect(packageSigningSchema.parse(value)); return strings.join('\n');
}

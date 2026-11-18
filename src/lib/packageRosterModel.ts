import { z } from 'zod';
import { packageTemplateV2Schema } from './packageTemplateSchema';
import { packageTemplateAnswersSchema } from './packageTemplateProgram';
import { portableResourceDigest } from './portableResources';
import type { ActionPackage } from './actionPackages';

export const MAX_PACKAGE_ROSTERS = 4;
export const MAX_PACKAGE_ROSTER_ROWS = 25;
export const MAX_PACKAGE_ROSTER_BYTES = 64 * 1024 * 1024;
export const MAX_PACKAGE_ROSTER_LIBRARY_BYTES = 128 * 1024 * 1024;
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/).refine(value => value !== 'prototype' && !Object.hasOwn(Object.prototype, value));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.object({ name: z.string().min(1).max(255), data: z.instanceof(ArrayBuffer).refine(value => value.byteLength > 0 && value.byteLength <= 25 * 1024 * 1024),
  signedOriginal: z.boolean(), sha256: digest }).strict();
export const packageRosterRowSchema = z.object({ id, number: z.number().int().min(1).max(5000), name: z.string().max(120), packageId: id,
  answers: packageTemplateAnswersSchema, attachments: z.record(z.string().min(1).max(220), file),
  warnings: z.array(z.string().max(1000)).max(100), status: z.enum(['pending', 'failed', 'created']), error: z.string().max(500).optional(),
  receipt: z.object({ revisionId: id, contentSha256: digest, policySha256: digest, createdAt: z.number().int().nonnegative() }).strict().optional(),
}).strict().refine(row => (row.status === 'created') === !!row.receipt && (row.status === 'failed') === !!row.error, 'Invalid roster row state.');
export const packageRosterSchema = z.object({ version: z.literal(1), id: z.string().uuid(), name: z.string().trim().min(1).max(120),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(), sequence: z.number().int().nonnegative(),
  sourceSha256: digest, template: packageTemplateV2Schema, rows: z.array(packageRosterRowSchema).min(1).max(MAX_PACKAGE_ROSTER_ROWS),
}).strict().superRefine((job, context) => {
  if (new Set(job.rows.map(row => row.id)).size !== job.rows.length || new Set(job.rows.map(row => row.packageId)).size !== job.rows.length
    || new Set(job.rows.map(row => row.number)).size !== job.rows.length) context.addIssue({ code: 'custom', message: 'Roster row, worksheet and owning package identities must be distinct.' });
  const people = job.rows.flatMap(row => Object.values(row.answers.groups).flat().map(person => person.id));
  if (new Set(people).size !== people.length) context.addIssue({ code: 'custom', message: 'Every roster action needs fresh participant identities.' });
  if (packageRosterStoredBytes(job) > MAX_PACKAGE_ROSTER_BYTES) context.addIssue({ code: 'custom', message: 'The saved roster exceeds its combined 64 MB limit.' });
});
export type PackageRoster = z.infer<typeof packageRosterSchema>;
export type PackageRosterRow = z.infer<typeof packageRosterRowSchema>;
export interface PackageRosterPublish { before: PackageRoster; after: PackageRoster; rowId: string }

export function packageRosterStoredBytes(job: { template: unknown; rows: Array<{ attachments: Record<string, { data: ArrayBuffer }> }> }): number {
  return new TextEncoder().encode(JSON.stringify(job)).byteLength + job.rows.reduce((sum, row) => sum + Object.values(row.attachments).reduce((total, item) => total + item.data.byteLength, 0), 0);
}
function sourceValue(job: PackageRoster) {
  return { id: job.id, name: job.name, createdAt: job.createdAt, template: job.template, rows: job.rows.map(row => ({ id: row.id, number: row.number, name: row.name, packageId: row.packageId,
    answers: row.answers, warnings: row.warnings, attachments: Object.entries(row.attachments).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, value.name, value.data.byteLength, value.sha256, value.signedOriginal]) })) };
}
export async function packageRosterSourceFingerprint(job: PackageRoster): Promise<string> {
  return portableResourceDigest(new TextEncoder().encode(JSON.stringify(sourceValue(job))).buffer);
}
export async function validatePackageRoster(input: unknown): Promise<PackageRoster> {
  const job = packageRosterSchema.parse(structuredClone(input));
  await validatePackageRosterBytes(job); return job;
}
/** The transaction writer already owns its schema-checked copy; avoid copying its file buffers again. */
export async function validatePackageRosterBytes(job: PackageRoster): Promise<void> {
  if (await packageRosterSourceFingerprint(job) !== job.sourceSha256) throw new Error('Saved roster inputs do not match their captured checksum.');
  for (const row of job.rows) for (const attachment of Object.values(row.attachments)) if (await portableResourceDigest(attachment.data) !== attachment.sha256)
    throw new Error('A saved per-row PDF is missing or corrupt.');
}
/** Stable initial inputs exclude later retained outputs. A created action can continue to evolve independently. */
export async function packageRosterCreatedFingerprint(record: ActionPackage, revisionId: string, name: string): Promise<string> {
  const revision = record.revisions.find(item => item.id === revisionId);
  if (!revision) throw new Error('The initially created package revision is unavailable.');
  return portableResourceDigest(new TextEncoder().encode(JSON.stringify({ packageId: record.id, name, revision: { ...revision, outputs: [] } })).buffer);
}
export function validPackageRosterTransition(before: PackageRoster | null, after: PackageRoster | null, publishingRowId?: string): boolean {
  if (!before) return !!after && after.sequence === 0 && after.rows.every(row => row.status === 'pending' && !row.receipt && !row.error);
  if (!after) return !publishingRowId;
  if (before.id !== after.id || after.sequence !== before.sequence + 1 || after.updatedAt < before.updatedAt || before.sourceSha256 !== after.sourceSha256
    || JSON.stringify(sourceValue(before)) !== JSON.stringify(sourceValue(after))) return false;
  let changed = 0;
  for (const [index, row] of before.rows.entries()) {
    const next = after.rows[index];
    if (row.status === next.status && row.error === next.error && JSON.stringify(row.receipt) === JSON.stringify(next.receipt)) continue;
    changed++;
    if (row.status === 'created' || row.id === publishingRowId && next.status !== 'created'
      || row.id !== publishingRowId && next.status === 'created') return false;
    if (publishingRowId && row.id !== publishingRowId) return false;
  }
  return publishingRowId ? changed === 1 : changed > 0;
}
export async function validPackageRosterPublication(publication: PackageRosterPublish, record: ActionPackage): Promise<boolean> {
  if (!validPackageRosterTransition(publication.before, publication.after, publication.rowId)) return false;
  const row = publication.after.rows.find(item => item.id === publication.rowId), revision = record.revisions[0];
  if (!row?.receipt || row.packageId !== record.id || row.name.trim() !== record.name || record.archived || record.sequence !== 0 || record.revisions.length !== 1
    || record.currentRevisionId !== row.receipt.revisionId || revision.id !== row.receipt.revisionId || revision.parentId || revision.outputs.length
    || record.reviewRounds?.length || record.reviewApplications?.length || record.fieldReviewApplications?.length || record.workingCopies?.length || revision.signing || revision.work || revision.scans
    || revision.members.some(member => member.kind === 'native' && member.source)
    || !revision.templateState || revision.templateState.templateId !== publication.after.template.id
    || revision.templateState.templateRevision !== publication.after.template.program.revision || revision.templateState.pending
    || JSON.stringify(revision.templateState.answers) !== JSON.stringify(row.answers)) return false;
  if (revision.templateState.source.sha256 !== await portableResourceDigest(new TextEncoder().encode(JSON.stringify(publication.after.template)).buffer)) return false;
  return row.receipt.contentSha256 === await packageRosterCreatedFingerprint(record, row.receipt.revisionId, row.name);
}

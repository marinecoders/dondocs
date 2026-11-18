import { z } from 'zod';

export const MAX_PACKAGE_JOBS = 20;
export const MAX_PACKAGE_JOB_BYTES = 75 * 1024 * 1024;
export const MAX_PACKAGE_JOB_LIBRARY_BYTES = 250 * 1024 * 1024;
export const PACKAGE_JOB_LEASE_MS = 45_000;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().uuid();
const checkpointSchema = z.object({
  key: digest, outputId: id, memberId: z.string().min(1).max(100),
  size: z.number().int().positive().max(25 * 1024 * 1024), sha256: digest,
  pages: z.number().int().positive().max(500),
}).strict();
export const packageJobSchema = z.object({
  version: z.literal(1), id, packageId: z.string().min(1).max(100), revisionId: z.string().min(1).max(100),
  sourceSha256: digest, policySha256: digest, buildSha256: digest,
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(), sequence: z.number().int().nonnegative(),
  status: z.enum(['paused', 'running', 'failed', 'complete']),
  total: z.number().int().positive().max(100), completed: z.number().int().nonnegative().max(100),
  checkpoints: z.array(checkpointSchema).max(200),
  lease: z.object({ token: id, expiresAt: z.number().int().nonnegative() }).strict().optional(),
  output: z.object({ id: z.string().min(1).max(100), sha256: digest }).strict().optional(),
}).strict().superRefine((job, context) => {
  if (job.completed > job.total || job.checkpoints.reduce((sum, entry) => sum + entry.size, 0) > MAX_PACKAGE_JOB_BYTES
    || new Set(job.checkpoints.map(entry => entry.key)).size !== job.checkpoints.length
    || new Set(job.checkpoints.map(entry => entry.outputId)).size !== job.checkpoints.length
    || (job.status === 'running') !== !!job.lease || (job.status === 'complete') !== !!job.output
    || job.status === 'complete' && job.completed !== job.total) context.addIssue({ code: 'custom', message: 'Invalid saved package job state.' });
});
export type PackageJob = z.infer<typeof packageJobSchema>;
export type PackageJobCheckpoint = z.infer<typeof checkpointSchema>;
export interface PackageJobPublish { before: PackageJob; after: PackageJob; token: string }
/** Deferred publication freezes the renewed lease after asynchronous file validation. */
export type PackageJobPublication = PackageJobPublish | (() => Promise<PackageJobPublish>);

export function samePackageJobSource(before: PackageJob, after: PackageJob): boolean {
  return JSON.stringify([before.id, before.packageId, before.revisionId, before.sourceSha256, before.policySha256, before.buildSha256, before.createdAt, before.total])
    === JSON.stringify([after.id, after.packageId, after.revisionId, after.sourceSha256, after.policySha256, after.buildSha256, after.createdAt, after.total]);
}
/** Called inside the write transaction, so an expired tab cannot renew or publish. */
export function validPackageJobTransition(before: PackageJob | null, after: PackageJob | null, token?: string, now = Date.now()): boolean {
  if (!before) return !!after && after.sequence === 0 && after.status === 'paused' && after.completed === 0 && !after.checkpoints.length;
  const live = before.status === 'running' && before.lease!.expiresAt > now;
  if (!after) return !live;
  if (!samePackageJobSource(before, after) || before.status === 'complete' || after.sequence !== before.sequence + 1 || after.updatedAt < before.updatedAt) return false;
  if (live && (!token || before.lease!.token !== token)) return false;
  if (before.checkpoints.some((checkpoint, index) => JSON.stringify(checkpoint) !== JSON.stringify(after.checkpoints[index]))) return false;
  if (after.status === 'running') {
    if (after.lease!.expiresAt <= now || after.lease!.expiresAt > now + PACKAGE_JOB_LEASE_MS + 1000) return false;
    if (live && after.lease!.token !== token) return false;
    // Only an active owner may add output checkpoints; acquisition starts with the retained list.
    if (!live && (after.checkpoints.length !== before.checkpoints.length || after.lease!.token === before.lease?.token)) return false;
  } else if (!live || !token || before.lease!.token !== token) return false;
  return after.status !== 'complete' || after.completed === after.total;
}

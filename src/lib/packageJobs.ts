import { PDFDocument } from 'pdf-lib';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { assemblePackage, preparePackageAssembly, type PackageGeneratedPdfKey, type PreparedPackageAssembly } from './actionPackageAssembly';
import { readPackageAsset } from './actionPackageAssets';
import { actionPackageSchema, commitActionPackage, getPackageRevision, packageAssets, type ActionPackage } from './actionPackages';
import { getBatchOutput, idbComparePackageJob, idbReadPackageJobs, putBatchOutput, type StoredAttachment } from './documentsDb';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { MAX_PACKAGE_JOB_BYTES, PACKAGE_JOB_LEASE_MS, packageJobSchema, type PackageJob } from './packageJobModel';
import { MAX_PORTABLE_RESOURCE_COUNT, portableResourceDigest } from './portableResources';
import { reviewPayloadDigest } from './reviewRounds';
import { APP_VERSION, GIT_SHA } from './version';

export interface PreparedPackageJob {
  readonly jobId: string;
  readonly revisionId: string;
  readonly resuming: boolean;
  readonly readiness: PreparedPackageAssembly['readiness'];
  readonly reviews: PreparedPackageAssembly['reviews'];
}
interface JobInput { record: ActionPackage; assembly: PreparedPackageAssembly; job: PackageJob; policy: string; consumed: boolean }
const preparations = new WeakMap<PreparedPackageJob, JobInput>();
export interface PackageJobProgress { completed: number; total: number; memberId?: string; reused: number }
function policyKey(policy: PolicyResolution): string { return policy.status === 'ready' ? JSON.stringify(policy.policy) : ''; }
function copy<T>(value: T): T { return structuredClone(value); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
function check(signal?: AbortSignal, isCurrent: () => boolean = () => true) {
  signal?.throwIfAborted(); if (!isCurrent()) throw new Error('This package operation is no longer current. Prepare it again.');
}
export async function listPackageJobs(packageId?: string): Promise<PackageJob[]> {
  return (await idbReadPackageJobs()).filter(job => !packageId || job.packageId === packageId).sort((a, b) => b.createdAt - a.createdAt);
}

/** Captures exact saved inputs in memory; saved jobs deliberately contain no acknowledgement. */
export async function preparePackageJob(record: ActionPackage, revisionId: string, policy: PolicyResolution,
  options: { resumeJobId?: string; signal?: AbortSignal; isCurrent?: () => boolean } = {}): Promise<PreparedPackageJob> {
  check(options.signal, options.isCurrent);
  const owned = actionPackageSchema.parse(copy(record)), revision = getPackageRevision(owned, revisionId);
  if (owned.archived || owned.reviewRounds?.some(round => round.ownerPackageId === undefined)) throw new Error('An archived package or reviewer copy cannot publish package jobs.');
  if (!revision.members.length || policy.status !== 'ready') throw new Error('Choose a nonempty saved revision and wait for the export policy.');
  const identity = policyKey(policy), sourceSha256 = await reviewPayloadDigest({ name: owned.name, revision: { ...revision, outputs: [] } });
  const policySha256 = await reviewPayloadDigest(identity);
  const buildSha256 = await reviewPayloadDigest([APP_VERSION, GIT_SHA, __LATEX_TEMPLATES_REVISION__, __RUNTIME_BASE__, 'package-job-v1']);
  const existing = options.resumeJobId ? (await listPackageJobs()).find(job => job.id === options.resumeJobId) : undefined;
  if (options.resumeJobId && !existing) throw new Error('The saved package job is unavailable.');
  if (existing && (existing.packageId !== owned.id || existing.revisionId !== revisionId || existing.sourceSha256 !== sourceSha256
    || existing.policySha256 !== policySha256 || existing.buildSha256 !== buildSha256)) throw new Error('The saved job inputs, application build or export policy changed. Start a new reviewed job.');
  if (existing?.status === 'complete') throw new Error('This job already published its saved PDF. Use that retained output.');
  if (existing?.lease && existing.lease.expiresAt > Date.now()) throw new Error('This job is active in another tab. Pause it there or wait for its lease to expire.');
  // Check declared sizes before reading; preparation also enforces actual captured-byte limits.
  const declared = new Map(packageAssets({ ...owned, revisions: [revision], reviewRounds: undefined }).map(asset => [asset.id, asset]));
  if (declared.size > MAX_PORTABLE_RESOURCE_COUNT || [...declared.values()].reduce((sum, asset) => sum + asset.size, 0) > MAX_PACKAGE_JOB_BYTES)
    throw new Error('This package job exceeds its 75 MB captured-input limit. Use a smaller delivery.');
  let retainedBytes = 0;
  const readIds = new Set<string>();
  const assembly = await preparePackageAssembly(owned, revisionId, policy, { signal: options.signal, readAsset: async asset => {
    check(options.signal, options.isCurrent);
    if (!readIds.has(asset.id)) {
      if (readIds.size >= MAX_PORTABLE_RESOURCE_COUNT || asset.size > MAX_PACKAGE_JOB_BYTES - retainedBytes) throw new Error('This package job exceeds its captured-input memory limit.');
      readIds.add(asset.id); retainedBytes += asset.size;
    }
    const bytes = await readPackageAsset(asset); check(options.signal, options.isCurrent);
    if (asset.type === 'application/pdf' && (await PDFDocument.load(bytes)).getPageCount() > 500) throw new Error('A captured PDF exceeds the 500-page job limit. Use a smaller delivery.');
    return bytes;
  } });
  check(options.signal, options.isCurrent);
  const now = Date.now(), job = existing ?? packageJobSchema.parse({ version: 1, id: crypto.randomUUID(), packageId: owned.id, revisionId,
    sourceSha256, policySha256, buildSha256, createdAt: now, updatedAt: now, sequence: 0, status: 'paused',
    completed: 0, total: revision.members.length, checkpoints: [] });
  const prepared = freeze({ jobId: job.id, revisionId, resuming: !!existing, readiness: copy(assembly.readiness), reviews: copy(assembly.reviews) });
  preparations.set(prepared, { record: owned, assembly, job: copy(job), policy: identity, consumed: false });
  return prepared;
}

/** Starts once from a fresh private preparation. Cancellation retains only committed checkpoints. */
export async function runPreparedPackageJob(prepared: PreparedPackageJob, policy: PolicyResolution, reviewed: boolean,
  ports: Parameters<typeof assemblePackage>[1], options: { signal?: AbortSignal; isCurrent?: () => boolean; onProgress?: (progress: PackageJobProgress) => void } = {}): Promise<ActionPackage> {
  const input = preparations.get(prepared);
  if (!input || input.consumed || !reviewed || input.policy !== policyKey(policy) || !input.policy)
    throw new Error('Review this exact package job again before running it.');
  if (prepared.readiness.findings.some(finding => finding.severity === 'error')) throw new Error('Resolve package readiness findings before running this job.');
  check(options.signal, options.isCurrent);
  if (policyKey(await getExportDeploymentPolicy()) !== input.policy) throw new Error('The export policy changed. Review this job again.');
  check(options.signal, options.isCurrent);
  input.consumed = true;
  const controller = new AbortController(), signal = controller.signal;
  const abort = () => controller.abort(options.signal?.reason ?? new DOMException('Package job paused.', 'AbortError'));
  options.signal?.addEventListener('abort', abort, { once: true });
  const current = () => !signal.aborted && (options.isCurrent?.() ?? true) && policyKey(getExportDeploymentPolicySync()) === input.policy;
  const assertCurrent = () => { signal.throwIfAborted(); if (!current()) throw new Error('The package context or export policy changed. Review this job again.'); };
  const notify = (progress: PackageJobProgress) => { try { options.onProgress?.(progress); } catch { /* Progress observers do not own saved work. */ } };
  let job = copy(input.job), ownedLease = false, committed = false, reused = 0, leaseFailure: unknown;
  const token = crypto.randomUUID();
  let queue: Promise<void> = Promise.resolve();
  const serialize = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation); queue = result.then(() => undefined, () => undefined); return result;
  };
  const next = (patch: Partial<PackageJob>): PackageJob => packageJobSchema.parse({ ...job, ...patch, sequence: job.sequence + 1, updatedAt: Date.now() });
  async function update(patch: Partial<PackageJob>, requireCurrent = true) {
    if (requireCurrent) assertCurrent();
    if (leaseFailure) throw leaseFailure;
    const after = next(patch);
    if (!await idbComparePackageJob(job, after, { token, isCurrent: requireCurrent ? current : undefined }))
      throw new Error('The package job lease changed or browser storage is full. Saved checkpoints are preserved.');
    job = after;
  }
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    assertCurrent();
    if (!prepared.resuming && !await idbComparePackageJob(null, job, { isCurrent: current })) throw new Error('The package job could not be saved. Remove an old job or free browser storage.');
    const acquired = next({ status: 'running', completed: 0, lease: { token, expiresAt: Date.now() + PACKAGE_JOB_LEASE_MS } });
    if (!await idbComparePackageJob(job, acquired, { isCurrent: current })) throw new Error('Another tab changed this job. Prepare it again.');
    job = acquired; ownedLease = true;
    notify({ completed: 0, total: job.total, reused });
    heartbeat = setInterval(() => {
      void serialize(() => update({ lease: { token, expiresAt: Date.now() + PACKAGE_JOB_LEASE_MS } })).catch(cause => { leaseFailure = cause; controller.abort(cause); });
    }, 10_000);
    const renderKey = (key: PackageGeneratedPdfKey) => reviewPayloadDigest([job.sourceSha256, job.policySha256, job.buildSha256, key]);
    const result = await assemblePackage(input.assembly, ports, signal, {
      maximumPages: 500,
      loadGeneratedPdf: async key => {
        assertCurrent(); if (leaseFailure) throw leaseFailure;
        const digest = await renderKey(key), checkpoint = job.checkpoints.find(entry => entry.key === digest);
        if (!checkpoint) return null;
        const stored = await getBatchOutput(checkpoint.outputId);
        if (!stored || stored.byteLength !== checkpoint.size || await portableResourceDigest(new Uint8Array(stored).buffer) !== checkpoint.sha256)
          throw new Error('A saved PDF checkpoint is missing or corrupt. Discard this job and start a new reviewed assembly.');
        const bytes = new Uint8Array(stored).buffer;
        if ((await PDFDocument.load(bytes)).getPageCount() !== checkpoint.pages) throw new Error('A saved PDF checkpoint has invalid pages. Start a new reviewed job.');
        assertCurrent(); reused++; return bytes;
      },
      saveGeneratedPdf: async (key, bytes) => {
        assertCurrent();
        if (!bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024) throw new Error('A generated member PDF exceeds the 25 MB checkpoint limit.');
        const entry = { key: await renderKey(key), memberId: key.memberId, outputId: crypto.randomUUID(), size: bytes.byteLength,
          sha256: await portableResourceDigest(bytes), pages: (await PDFDocument.load(bytes)).getPageCount() };
        await serialize(async () => {
          assertCurrent(); if (leaseFailure) throw leaseFailure;
          const after = next({ checkpoints: [...job.checkpoints, entry] });
          if (!await putBatchOutput(entry.outputId, new Uint8Array(bytes), { before: job, after, token, isCurrent: current }))
            throw new Error('The PDF checkpoint could not be saved. Check browser storage before resuming.');
          job = after;
        });
      },
      memberCompleted: async progress => {
        await serialize(() => update({ completed: progress.completed }));
        notify({ ...progress, reused });
      },
      commit: async (before, after, operationSignal, staged: readonly StoredAttachment[]) => {
        await queue; assertCurrent(); if (leaseFailure) throw leaseFailure;
        if (policyKey(await getExportDeploymentPolicy()) !== input.policy) throw new Error('The export policy changed before publication. Review this job again.');
        assertCurrent();
        const output = getPackageRevision(after, job.revisionId).outputs.at(-1)!;
        const saved = await commitActionPackage(before, after, operationSignal, current, staged, async () => {
          // Keep renewing during resource validation; stop and drain renewals
          // only when the final transaction is ready to capture its exact lease.
          if (heartbeat) clearInterval(heartbeat); heartbeat = undefined;
          await queue; assertCurrent(); if (leaseFailure) throw leaseFailure;
          return { before: copy(job), after: next({ status: 'complete', lease: undefined, completed: job.total,
            output: { id: output.id, sha256: output.asset.sha256 } }), token };
        });
        committed = true; return saved;
      },
    });
    return result;
  } catch (cause) {
    if (ownedLease && !committed) {
      if (heartbeat) clearInterval(heartbeat); heartbeat = undefined;
      await queue;
      // A pause releases only this live lease. A stolen/expired owner cannot alter its successor.
      try { await serialize(() => update({ status: signal.aborted ? 'paused' : 'failed', lease: undefined }, false)); } catch { /* The next fresh resume can claim an expired lease. */ }
    }
    throw cause;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** Atomically removes metadata and its checkpoints; an active tab retains ownership. */
export async function discardPackageJob(expected: PackageJob, isCurrent: () => boolean = () => true): Promise<void> {
  if (!await idbComparePackageJob(expected, null, { isCurrent })) throw new Error('This job changed or is still running in another tab. Refresh its status before removing it.');
}

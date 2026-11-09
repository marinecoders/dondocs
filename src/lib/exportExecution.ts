import { assertReadyExport, type PreparedExportJob, type ReadyExportJob } from './preparedExport';

export interface ExportArtifactIssue { readonly message: string; readonly asset?: string }
const artifactBrand = Symbol('export-artifact');
export interface ExportArtifact {
  readonly [artifactBrand]: true;
  readonly job: PreparedExportJob;
  readonly blob: Blob;
  readonly completeness: 'complete' | 'partial';
  readonly issues: readonly ExportArtifactIssue[];
}
const issuedArtifacts = new WeakSet<ExportArtifact>();
export function createExportArtifact(job: ReadyExportJob, blob: Blob, issues: readonly ExportArtifactIssue[] = []): ExportArtifact {
  assertReadyExport(job);
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error('The renderer produced an empty export.');
  const ownedIssues = Object.freeze(issues.map(issue => Object.freeze({ ...issue })));
  const artifact: ExportArtifact = Object.freeze({ [artifactBrand]: true as const, job: job.job, blob, issues: ownedIssues, completeness: ownedIssues.length ? 'partial' : 'complete' });
  issuedArtifacts.add(artifact);
  return artifact;
}
function assertArtifact(artifact: ExportArtifact, job: ReadyExportJob): void {
  if (!issuedArtifacts.has(artifact) || artifact.job !== job.job) throw new Error('Rendered output does not belong to this prepared job.');
}

export type ExportOutcome =
  | { readonly status: 'succeeded'; readonly artifact: ExportArtifact; readonly cleanupIssues: readonly string[] }
  | { readonly status: 'failed'; readonly message: string; readonly cleanupIssues: readonly string[] }
  | { readonly status: 'cancelled'; readonly cleanupIssues: readonly string[] };
export type ExportExecutionState =
  | { readonly status: 'queued'; readonly cancellationRequested: boolean }
  | { readonly status: 'running'; readonly phase: 'rendering' | 'delivering'; readonly cancellationRequested: boolean }
  | ExportOutcome;
export interface ExportExecution {
  readonly job: PreparedExportJob;
  readonly result: Promise<ExportOutcome>;
  getState(): ExportExecutionState;
  /** Delivery is the ownership handoff; an already delivered file cannot be recalled. */
  cancel(): boolean;
}
export interface ExportExecutionPorts {
  render(job: ReadyExportJob, signal: AbortSignal): Promise<ExportArtifact>;
  deliver(artifact: ExportArtifact, signal: AbortSignal): Promise<boolean | void>;
  release?(artifact: ExportArtifact | undefined): Promise<void> | void;
  onState?(state: ExportExecutionState): void | Promise<void>;
}
function message(error: unknown): string {
  try { return String(error instanceof Error ? error.message : error); }
  catch { return 'The export failed.'; }
}

/** Keep the engine's existing serialization. Cancellation waits for its worker
 * before releasing resources or resolving waiters, and suppresses delivery.
 */
export function executePreparedExport(job: ReadyExportJob, ports: ExportExecutionPorts): ExportExecution {
  assertReadyExport(job);
  const { render, deliver, release, onState } = ports;
  const abort = new AbortController();
  let state: ExportExecutionState = Object.freeze({ status: 'queued', cancellationRequested: false });
  const publish = (next: ExportExecutionState) => {
    state = Object.freeze(next);
    try { void Promise.resolve(onState?.(state)).catch(() => {}); } catch { /* Observers do not own execution. */ }
  };
  publish(state);
  const result = Promise.resolve().then(async (): Promise<ExportOutcome> => {
    let artifact: ExportArtifact | undefined;
    let outcome: ExportOutcome;
    const cleanupIssues: string[] = [];
    try {
      if (abort.signal.aborted) outcome = { status: 'cancelled', cleanupIssues };
      else {
        publish({ status: 'running', phase: 'rendering', cancellationRequested: false });
        abort.signal.throwIfAborted();
        const rendered = await render(job, abort.signal);
        assertArtifact(rendered, job);
        artifact = rendered;
        if (abort.signal.aborted) outcome = { status: 'cancelled', cleanupIssues };
        else if (artifact.completeness === 'partial') outcome = { status: 'failed', message: artifact.issues.map(issue => issue.message).join('\n'), cleanupIssues };
        else {
          publish({ status: 'running', phase: 'delivering', cancellationRequested: false });
          const delivered = await deliver(artifact, abort.signal);
          outcome = delivered === false ? { status: 'failed', message: 'The export could not be delivered.', cleanupIssues }
            : { status: 'succeeded', artifact, cleanupIssues };
        }
      }
    } catch (error) {
      outcome = abort.signal.aborted ? { status: 'cancelled', cleanupIssues } : { status: 'failed', message: message(error), cleanupIssues };
    } finally {
      try { await release?.(artifact); } catch (error) { cleanupIssues.push(message(error)); }
    }
    if (abort.signal.aborted && outcome.status !== 'succeeded') outcome = { status: 'cancelled', cleanupIssues };
    Object.freeze(cleanupIssues);
    publish(outcome);
    return Object.freeze(outcome);
  });
  return Object.freeze({
    job: job.job, result,
    getState: () => state,
    cancel: () => {
      if (abort.signal.aborted || state.status !== 'queued' && state.status !== 'running' || state.status === 'running' && state.phase === 'delivering') return false;
      abort.abort();
      publish({ ...state, cancellationRequested: true });
      return true;
    },
  });
}

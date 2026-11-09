import { capturedCapabilities } from './documentCapabilities';
import { exportErrorMessage } from './exportDiagnostics';
import { notifyObserver } from './observers';
import type { FormExportTemplates } from './formExportTemplates';
import type { CapturedDocument } from './capturedDocument';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { acknowledgePreparedExport, copyExportReview, prepareExport, type ExportTarget, type PreparedExportJob, type ReadyExportJob } from './preparedExport';
import { executePreparedExport, type ExportArtifact, type ExportExecution, type ExportExecutionState } from './exportExecution';

export interface ExportIntent {
  readonly id: string;
  readonly captured: CapturedDocument;
  readonly target: ExportTarget;
  readonly filename: string;
  readonly texMode?: 'configuration' | 'flat';
  readonly placeholders?: Record<string, string>;
}
export type ExportReviewStage = 'structure' | 'marking' | 'privacy';
export type ExportControllerState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'preparing'; readonly target: ExportTarget }
  | { readonly phase: 'review'; readonly job: PreparedExportJob; readonly stage: ExportReviewStage }
  | { readonly phase: 'executing'; readonly job: PreparedExportJob; readonly execution: ExportExecutionState }
  | { readonly phase: 'error'; readonly target: ExportTarget; readonly message: string; readonly compileLog?: string; readonly retryable: boolean }
  | { readonly phase: 'success'; readonly job: PreparedExportJob };
export interface ExportGate { acquire(): (() => void) | null }
export function createExportGate(): ExportGate {
  let owner: object | undefined;
  return Object.freeze({ acquire: () => {
    if (owner) return null;
    const lease = {};owner = lease;
    return () => { if (owner === lease) owner = undefined; };
  } });
}
export interface ExportDeliveryLease {
  deliver(artifact: ExportArtifact): Promise<boolean | void>;
  release(): void;
}
export interface ExportControllerPorts {
  readonly gate: ExportGate;
  resolvePolicy(retry: boolean): Promise<PolicyResolution>;
  captureResources?(captured: CapturedDocument): Promise<FormExportTemplates | undefined>;
  openDelivery(target: ExportTarget): ExportDeliveryLease;
  render(job: ReadyExportJob, signal: AbortSignal): Promise<ExportArtifact>;
  onState?(state: ExportControllerState): void;
  onCleanupIssue?(error: unknown): void;
}
interface Operation {
  readonly intent: ExportIntent;
  releaseGate?: () => void;
  delivery?: ExportDeliveryLease;
  approved?: ReadyExportJob;
  reviewed?: PreparedExportJob;
  stages: ExportReviewStage[];
  execution?: ExportExecution;
}

/** One owner for capture → review → execution. UI commands carry both the
 * displayed job and review stage, so an old callback cannot approve new work.
 */
export function createExportController(ports: ExportControllerPorts) {
  const { gate, resolvePolicy, captureResources, openDelivery, render, onState, onCleanupIssue } = ports;
  let current: Operation | undefined;
  let state: ExportControllerState = Object.freeze({ phase: 'idle' });
  const listeners = new Set<() => void>();
  const publish = (next: ExportControllerState) => {
    state = Object.freeze(next);
    notifyObserver(onState, state);
    for (const listener of listeners) notifyObserver(listener, undefined);
  };
  const releaseDelivery = (operation: Operation) => {
    const lease = operation.delivery;operation.delivery = undefined;
    try { lease?.release(); } catch (error) { notifyObserver(onCleanupIssue, error); }
  };
  const releaseGate = (operation: Operation) => {
    const release = operation.releaseGate;operation.releaseGate = undefined;release?.();
  };
  const fail = (operation: Operation, error: unknown, retryable: boolean) => {
    releaseDelivery(operation);releaseGate(operation);
    if (current === operation) publish({ phase: 'error', target: operation.intent.target, message: exportErrorMessage(error), retryable });
  };
  const run = (operation: Operation) => {
    if (!operation.approved) throw new Error('Missing export approval.');
    const approved = operation.approved;
    try { operation.delivery ??= openDelivery(approved.job.target); }
    catch (error) { fail(operation, error, true);return; }
    const delivery = operation.delivery;
    operation.execution = executePreparedExport(approved, {
      render,
      deliver: artifact => delivery.deliver(artifact),
      release: () => releaseDelivery(operation),
      onState: execution => {
        if (current === operation && (execution.status === 'queued' || execution.status === 'running')) publish({ phase: 'executing', job: approved.job, execution });
      },
    });
    if (current !== operation) operation.execution.cancel();
    void operation.execution.result.then(outcome => {
      releaseGate(operation);operation.execution = undefined;
      if (current !== operation) return;
      if (outcome.status === 'cancelled') { current = undefined;publish({ phase: 'idle' }); }
      else if (outcome.status === 'failed') publish({ phase: 'error', target: approved.job.target, message: outcome.message, compileLog: outcome.compileLog, retryable: true });
      else { current = undefined;publish({ phase: 'success', job: approved.job }); }
    }, error => { operation.execution = undefined;fail(operation, error, true); });
  };
  const prepare = async (operation: Operation, retry: boolean) => {
    try {
      // Reserve gesture-sensitive delivery before the first asynchronous read.
      operation.delivery = openDelivery(operation.intent.target);
      publish({ phase: 'preparing', target: operation.intent.target });
      const policy = await resolvePolicy(retry);
      if (current !== operation) { releaseDelivery(operation);return; }
      if (policy.status === 'ready') {
        const capability = capturedCapabilities(operation.intent.captured, { operation: 'export', target: operation.intent.target });
        if (capability.status !== 'supported' && capability.status !== 'partial') {
          fail(operation, capability.message, false);return;
        }
      }
      const formTemplates = policy.status === 'ready' ? await captureResources?.(operation.intent.captured) : undefined;
      if (current !== operation) { releaseDelivery(operation);return; }
      const result = prepareExport({ ...operation.intent, policy, formTemplates });
      if ('issues' in result) { fail(operation, result.issues.join('\n'), policy.status !== 'ready');return; }
      if (result.status === 'ready') { operation.approved = result.job;run(operation);return; }
      releaseDelivery(operation);
      operation.reviewed = result.job;
      const review = copyExportReview(result.job);
      operation.stages = [
        ...(review.structure.length ? ['structure' as const] : []),
        ...(review.markingReview ? ['marking' as const] : []),
        ...(review.privacy.found ? ['privacy' as const] : []),
      ];
      publish({ phase: 'review', job: result.job, stage: operation.stages[0] });
    } catch (error) { fail(operation, error, true); }
  };
  const start = (intent: ExportIntent, retry = false): boolean => {
    if (current?.execution) return false;
    if (current) { releaseDelivery(current);releaseGate(current); }
    const release = gate.acquire();
    if (!release) return false;
    const operation: Operation = { intent: Object.freeze({ ...intent, placeholders: intent.placeholders ? Object.freeze({ ...intent.placeholders }) : undefined }), releaseGate: release, stages: [] };
    current = operation;
    void prepare(operation, retry);
    return true;
  };
  return Object.freeze({
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener);return () => { listeners.delete(listener); }; },
    request: (intent: ExportIntent) => start(intent),
    confirm: (job: PreparedExportJob, stage: ExportReviewStage): boolean => {
      if (!current || state.phase !== 'review' || current.reviewed !== job || state.stage !== stage) return false;
      current.stages.shift();
      if (current.stages.length) publish({ phase: 'review', job, stage: current.stages[0] });
      else { current.approved = acknowledgePreparedExport(job);run(current); }
      return true;
    },
    cancelReview: (job: PreparedExportJob, stage: ExportReviewStage): boolean => {
      if (!current || state.phase !== 'review' || current.reviewed !== job || state.stage !== stage) return false;
      releaseDelivery(current);releaseGate(current);current = undefined;publish({ phase: 'idle' });return true;
    },
    cancel: (): boolean => {
      if (!current) return false;
      if (current.execution) return current.execution.cancel();
      releaseDelivery(current);releaseGate(current);current = undefined;publish({ phase: 'idle' });return true;
    },
    retry: (): boolean => {
      if (!current || state.phase !== 'error' || !state.retryable) return false;
      if (!current.approved) return start(current.intent, true);
      const release = gate.acquire();if (!release) return false;
      current.releaseGate = release;run(current);return true;
    },
  });
}

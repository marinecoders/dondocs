import { notifyObserver } from '@/lib/observers';
import { createExportController, createExportGate, type ExportControllerState, type ExportControllerPorts, type ExportReviewStage } from '@/lib/exportController';
import { copyExportReview, type PreparedExportJob, type ExportReview } from '@/lib/preparedExport';
import type { ExportArtifact } from '@/lib/exportExecution';
import { captureBatchRowIntent, type BatchRowContext } from './batchRows';

export interface BatchExportReview {
  readonly rowId: string;
  readonly job: PreparedExportJob;
  readonly stage: ExportReviewStage;
  readonly details: ExportReview;
}
type Controller = ReturnType<typeof createExportController>;
interface RowOwner {
  controller: Controller;
  output: { artifact?: ExportArtifact; deliver?: (artifact: ExportArtifact) => Promise<boolean | void> };
}
const owners = new Map<string, RowOwner>();
let active: RowOwner | undefined;

/** Approvals and failed attempts live only in memory. Persisted recovery always
 * reconstructs a job and reviews its current policy and exact row again. */
export function runPreparedBatchRow(values: Readonly<Record<string, string>>, context: BatchRowContext, ports: Pick<ExportControllerPorts, 'resolvePolicy' | 'captureResources' | 'render'> & {
  deliver?(artifact: ExportArtifact): Promise<boolean | void>;
  retainForRetry?: boolean;
  onCancelableChange?(canCancel: boolean): void;
  onActiveChange?(isActive: boolean): void;
  onReview(review: BatchExportReview | null): void;
}): Promise<Uint8Array> {
  const { onReview, onCancelableChange, onActiveChange, deliver, retainForRetry } = ports;
  const notifyReview = (review: BatchExportReview | null) => notifyObserver(onReview, review);
  const notifyCancelable = (value: boolean) => notifyObserver(onCancelableChange, value);
  if (active) return Promise.reject(new Error('Finish or cancel the active row before starting another.'));
  const rowId = context.rowId;
  const key = JSON.stringify([context.batchId, rowId]);
  let owner = owners.get(key);
  const retry = !!owner;
  if (!owner) {
    const intent = captureBatchRowIntent(values, context);
    const output: RowOwner['output'] = { deliver };
    const controller = createExportController({
      gate: createExportGate(), resolvePolicy: ports.resolvePolicy, captureResources: ports.captureResources, render: ports.render,
      openDelivery: () => ({ deliver: async delivered => {
        if (await output.deliver?.(delivered) === false) return false;
        output.artifact = delivered;return true;
      }, release() {} }),
    });
    const created: RowOwner = { controller, output };
    owner = created;owners.set(key, owner);
    return attempt(owner, () => controller.request(intent));
  }
  const previous = owner;
  return attempt(previous, () => previous.controller.retry());

  function attempt(row: RowOwner, start: () => boolean): Promise<Uint8Array> {
    active = row;row.output.artifact = undefined;row.output.deliver = deliver;notifyCancelable(true);notifyObserver(onActiveChange, true);
    return new Promise<ExportArtifact>((resolve, reject) => {
      let settled = false;
      const finish = (state: ExportControllerState) => {
        if (settled) return;
        notifyCancelable(state.phase === 'preparing' || state.phase === 'review' || state.phase === 'executing' && (state.execution.status === 'queued' || state.execution.status === 'running' && state.execution.phase === 'rendering') && !state.execution.cancellationRequested);
        if (state.phase === 'review') {
          notifyReview(Object.freeze({ rowId, job: state.job, stage: state.stage, details: copyExportReview(state.job) }));
          return;
        }
        notifyReview(null);
        if (state.phase !== 'error' && state.phase !== 'success' && state.phase !== 'idle') return;
        settled = true;unsubscribe();active = undefined;notifyObserver(onActiveChange, false);
        if (state.phase === 'success' && row.output.artifact) { owners.delete(key);resolve(row.output.artifact); }
        else {
          if (state.phase === 'idle' || retainForRetry === false) owners.delete(key);
          reject(new Error(state.phase === 'error' ? state.message : 'Row cancelled. Review it again before retrying.'));
        }
      };
      const unsubscribe = row.controller.subscribe(() => finish(row.controller.getState()));
      if (!start()) {
        settled = true;unsubscribe();active = undefined;notifyObserver(onActiveChange, false);notifyReview(null);notifyCancelable(false);
        const state = row.controller.getState();
        reject(new Error(state.phase === 'error' ? state.message : retry ? 'This row cannot be retried. Start a new batch.' : 'The row could not start.'));
      }
    }).then(async artifact => new Uint8Array(await artifact.blob.arrayBuffer()));
  }
}
export function confirmBatchExport(job: PreparedExportJob, stage: ExportReviewStage): boolean { return active?.controller.confirm(job, stage) ?? false; }
export function cancelBatchExport(): boolean { return active?.controller.cancel() ?? false; }
export function clearBatchExports(): boolean {
  if (active) return false;
  owners.clear();return true;
}

export function isBatchExportActive(): boolean { return active !== undefined; }

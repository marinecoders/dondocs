import type { SerializedSession } from '@/stores/documentStore';
import { captureDocumentRevision, type CapturedDocument } from '@/lib/capturedDocument';
import { capturedCapabilities } from '@/lib/documentCapabilities';
import { prepareExport, type ReadyExportJob } from '@/lib/preparedExport';
import type { PolicyResolution } from '@/lib/exportDeploymentPolicy';
import type { FormExportTemplates } from '@/lib/formExportTemplates';
import { renderPreparedBuiltinForm } from './builtinForms';
import { renderPreparedCorrespondence, type CorrespondenceRendererPorts } from './correspondence';

export interface BatchRowContext {
  readonly batchId: string;
  readonly rowId: string;
  readonly filename: string;
  readonly capturedAt: number;
  readonly source: SerializedSession;
  readonly retryPolicy?: boolean;
  readonly preview?: boolean;
  readonly deliver?: (bytes: Uint8Array) => Promise<void>;
}
/** Capture the row before any asynchronous dependency is consulted. */
export function captureBatchRowIntent(values: Readonly<Record<string, string>>, context: BatchRowContext) {
  const { batchId, rowId, filename, capturedAt } = context;
  const source = structuredClone(context.source);
  const captured = captureDocumentRevision({ documentId: batchId, epoch: 0, editSequence: 0, capturedAt }, {
    ...source, endItems: source.endItems ?? [], publicationTables: source.publicationTables ?? {},
  });
  const capability = capturedCapabilities(captured, { operation: 'batch', target: 'pdf' });
  if (capability.status !== 'supported') throw new Error(capability.message);
  return Object.freeze({ id: `${batchId}:${rowId}`, captured, target: 'pdf' as const, filename, placeholders: Object.freeze({ ...values }) });
}
export async function prepareBatchRow(values: Readonly<Record<string, string>>, context: BatchRowContext, ports: {
  resolvePolicy(): Promise<PolicyResolution>;
  captureResources(captured: CapturedDocument): Promise<FormExportTemplates | undefined>;
}) {
  const intent = captureBatchRowIntent(values, context);
  const policy = await ports.resolvePolicy();
  const formTemplates = policy.status === 'ready' ? await ports.captureResources(intent.captured) : undefined;
  return prepareExport({ ...intent, policy, formTemplates });
}

/** Recovery renders the same approved row; it never repeats substitution or review. */
export async function renderPreparedBatchRow(ready: ReadyExportJob, ports: CorrespondenceRendererPorts & {
  waitForReady(timeoutMs: number): Promise<boolean>;
}, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new Error('Export cancelled.');
    try {
      return ready.job.kind === 'builtin-form' ? await renderPreparedBuiltinForm(ready, signal)
        : await renderPreparedCorrespondence(ready, ports, signal);
    } catch (error) {
      if (signal.aborted || !(error instanceof Error) || error.message !== 'ENGINE_RESET_NEEDED' || attempt >= 2) throw error;
      if (!await ports.waitForReady(5000)) throw new Error('Engine failed to recover after reset.', { cause: error });
    }
  }
}

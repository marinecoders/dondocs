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
}
/** The caller's row and source are copied before policy or template I/O. */
export async function prepareBatchRow(values: Readonly<Record<string, string>>, context: BatchRowContext, ports: {
  resolvePolicy(): Promise<PolicyResolution>;
  captureResources(captured: CapturedDocument): Promise<FormExportTemplates | undefined>;
}) {
  const { batchId, rowId, filename, capturedAt } = context;
  const source = structuredClone(context.source);
  const captured = captureDocumentRevision({ documentId: batchId, epoch: 0, editSequence: 0, capturedAt }, {
    ...source, endItems: source.endItems ?? [], publicationTables: source.publicationTables ?? {},
  });
  const placeholders = { ...values };
  const capability = capturedCapabilities(captured, { operation: 'batch', target: 'pdf' });
  if (capability.status !== 'supported') return { status: 'error' as const, issues: [capability.message] };
  const policy = await ports.resolvePolicy();
  const formTemplates = policy.status === 'ready' ? await ports.captureResources(captured) : undefined;
  return prepareExport({ id: `${batchId}:${rowId}`, captured, target: 'pdf', filename, policy, formTemplates, placeholders });
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

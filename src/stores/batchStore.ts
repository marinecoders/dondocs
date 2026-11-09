import { confirmBatchExport, cancelBatchExport, clearBatchExports, isBatchExportActive, type BatchExportReview } from '@/services/exports/batchExecution';
import { materializeSignatureFallbacks, needsSignatureFallbacks } from '@/lib/signatureCompatibility';
import type { PreparedExportJob } from '@/lib/preparedExport';
import type { ExportReviewStage } from '@/lib/exportController';
import type { BatchRowContext } from '@/services/exports/batchRows';
import { create } from 'zustand';
import { newAttachmentId } from '@/lib/attachments';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage, lastWriteFailed } from '@/lib/compressedStorage';
import type { SerializedSession } from './documentStore';
import { putBatchOutput, deleteBatchOutput } from '@/lib/documentsDb';

export interface BatchRow {
  id: string;
  values: Record<string, string>;
  status?: 'pending' | 'generating' | 'success' | 'error';
  error?: string;
  outputId?: string;
  filename?: string;
}
interface BatchState {
  rows: BatchRow[];
  source: SerializedSession | null;
  jobId: string | null;
  review: BatchExportReview | null;
  rowCanCancel: boolean;
  rowActive: boolean;
  confirmReview(job: PreparedExportJob, stage: ExportReviewStage): boolean;
  cancelCurrent(): void;
  title: string;
  placeholders: string[];
  status: 'idle' | 'running' | 'paused' | 'interrupted' | 'complete';
  stopRequested: boolean;
  recoveryError: string;
  setRows: (rows: BatchRow[] | ((rows: BatchRow[]) => BatchRow[])) => void;
  stop: () => void;
  reset: () => void;
}
const emptyRow = (): BatchRow => ({ id: newAttachmentId(), values: {}, status: 'pending' });
export const BATCH_KEY = 'dondocs-batch-job';

export function recoverBatch(state: Partial<BatchState>): Partial<BatchState> {
  return {
    ...state, jobId: state.jobId ?? null, review: null, rowCanCancel: false, rowActive: false, stopRequested: false,
    status: state.status === 'running' ? 'interrupted' : state.status ?? 'idle',
    rows: (state.rows ?? [emptyRow()]).map((r) => r.status === 'generating'
      ? { ...r, status: 'error', error: 'Interrupted during generation. Check your downloads before retrying this row.' } : r),
  };
}

export const useBatchStore = create<BatchState>()(persist((set, get) => ({
  rows: [emptyRow()], source: null, jobId: null, review: null, rowCanCancel: false, rowActive: false,
  confirmReview: confirmBatchExport,
  cancelCurrent: () => { if (get().status === 'running') set({ stopRequested: true });cancelBatchExport(); },
  title: '', placeholders: [], status: 'idle', stopRequested: false, recoveryError: '',
  setRows: (rows) => set({ rows: typeof rows === 'function' ? rows(get().rows) : rows }),
  stop: () => set({ stopRequested: true }),
  reset: () => {
    if (get().status === 'running' || !clearBatchExports()) return;
    for (const row of get().rows) if (row.outputId) void deleteBatchOutput(row.outputId);
    set({ rows: [emptyRow()], source: null, jobId: null, review: null, rowCanCancel: false, rowActive: false, title: '', placeholders: [], status: 'idle', stopRequested: false, recoveryError: '' });
  },
}), {
  name: BATCH_KEY, storage: createJSONStorage(() => safeLocalStorage),
  partialize: ({ rows, source, jobId, title, placeholders, status, recoveryError }) => ({ rows, source, jobId, title, placeholders, status, recoveryError }),
  merge: (saved, current) => ({ ...current, ...recoverBatch((saved ?? {}) as Partial<BatchState>) }),
}));

/** A job owns a frozen source. Closing its view never cancels this loop. */
export async function runBatchJob(options: {
  source: SerializedSession; title: string; placeholders: string[]; retryFailed?: boolean;
  generate: (values: Record<string, string>, context: BatchRowContext) => Promise<Uint8Array>;
  download: (bytes: Uint8Array, filename: string) => void | Promise<void>;
}): Promise<void> {
  const store = useBatchStore;
  const { generate, download } = options;
  if (store.getState().status === 'running' || isBatchExportActive()) return;
  const rows = store.getState().rows.filter((r) => options.retryFailed ? r.status === 'error' : !r.status || r.status === 'pending').map(row => structuredClone(row));
  if (!rows.length) return;
  const batchId = store.getState().source && store.getState().jobId ? store.getState().jobId! : newAttachmentId();
  store.setState({ jobId: batchId, review: null, source: store.getState().source ?? structuredClone(options.source), title: store.getState().source ? store.getState().title : options.title,
    placeholders: store.getState().source ? store.getState().placeholders : options.placeholders, status: 'running', stopRequested: false });
  const jobPlaceholders = [...store.getState().placeholders];
  const originalSource = store.getState().source!;
  const capturedSource = structuredClone(originalSource);
  const jobSource = needsSignatureFallbacks(capturedSource) ? await materializeSignatureFallbacks(capturedSource) : capturedSource;
  if (store.getState().source === originalSource && store.getState().jobId === batchId) store.setState({ source: jobSource });
  for (const selected of rows) {
    const row = structuredClone(selected);
    const filename = row.filename ?? batchRowFilename(row, jobPlaceholders);
    if (store.getState().stopRequested) break;
    store.getState().setRows((all) => all.map((r) => r.id === row.id ? { ...r, status: 'generating', filename, error: undefined } : r));
    let delivered = false;
    let deliveryOpen = true;
    const deliver = async (bytes: Uint8Array) => {
      if (!deliveryOpen || delivered) throw new Error('This row delivery is no longer available.');
      delivered = true;store.setState({ rowCanCancel: false });
      const owned = new Uint8Array(bytes);
      const outputId = newAttachmentId();
      const retained = await putBatchOutput(outputId, owned);
      store.getState().setRows(all => all.map(r => r.id === row.id ? { ...r, status: 'success', filename, outputId: retained ? outputId : r.outputId } : r));
      if (retained && row.outputId) void deleteBatchOutput(row.outputId);
      if (!retained) store.setState({ recoveryError: 'Generated files could not be retained in this browser. Keep the downloaded copies.' });
      try { await download(owned, filename); }
      catch (error) { store.setState({ recoveryError: 'A download was blocked. Use the saved result to download it again.' });throw error; }
    };
    try {
      const pdf = await generate(row.values, { batchId, rowId: row.id, filename, retryPolicy: options.retryFailed === true, capturedAt: jobSource.timestamp, source: structuredClone(jobSource), deliver });
      if (!delivered) await deliver(pdf);
    } catch (error) {
      store.getState().setRows(all => all.map(r => r.id === row.id ? { ...r, status: 'error', error: error instanceof Error ? error.message : 'Generation failed' } : r));
    } finally { deliveryOpen = false; }
  }
  const unfinished = store.getState().rows.some((r) => !r.status || r.status === 'pending' || r.status === 'error');
  store.setState({ status: unfinished ? 'paused' : 'complete', stopRequested: false, review: null, rowCanCancel: false });
  if (lastWriteFailed(BATCH_KEY)) store.setState({ recoveryError: 'This job could not be saved. Keep this tab open; reload recovery is unavailable.' });
}

export function batchRowFilename(row: Pick<BatchRow, 'id' | 'values'>, placeholders: readonly string[]) {
  return `${(row.values[placeholders[0]] || `document_${row.id}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)}.pdf`;
}

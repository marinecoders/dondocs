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
    ...state, stopRequested: false,
    status: state.status === 'running' ? 'interrupted' : state.status ?? 'idle',
    rows: (state.rows ?? [emptyRow()]).map((r) => r.status === 'generating'
      ? { ...r, status: 'error', error: 'Interrupted during generation. Check your downloads before retrying this row.' } : r),
  };
}

export const useBatchStore = create<BatchState>()(persist((set, get) => ({
  rows: [emptyRow()], source: null, title: '', placeholders: [], status: 'idle', stopRequested: false, recoveryError: '',
  setRows: (rows) => set({ rows: typeof rows === 'function' ? rows(get().rows) : rows }),
  stop: () => set({ stopRequested: true }),
  reset: () => {
    if (get().status === 'running') return;
    for (const row of get().rows) if (row.outputId) void deleteBatchOutput(row.outputId);
    set({ rows: [emptyRow()], source: null, title: '', placeholders: [], status: 'idle', stopRequested: false, recoveryError: '' });
  },
}), {
  name: BATCH_KEY, storage: createJSONStorage(() => safeLocalStorage),
  partialize: ({ rows, source, title, placeholders, status }) => ({ rows, source, title, placeholders, status }),
  merge: (saved, current) => ({ ...current, ...recoverBatch((saved ?? {}) as Partial<BatchState>) }),
}));

/** A job owns a frozen source. Closing its view never cancels this loop. */
export async function runBatchJob(options: {
  source: SerializedSession; title: string; placeholders: string[]; retryFailed?: boolean;
  generate: (values: Record<string, string>) => Promise<Uint8Array>;
  download: (bytes: Uint8Array, filename: string) => void;
}): Promise<void> {
  const store = useBatchStore;
  if (store.getState().status === 'running') return;
  const rows = store.getState().rows.filter((r) => options.retryFailed ? r.status === 'error' : !r.status || r.status === 'pending');
  if (!rows.length) return;
  store.setState({ source: store.getState().source ?? structuredClone(options.source), title: store.getState().source ? store.getState().title : options.title,
    placeholders: store.getState().source ? store.getState().placeholders : options.placeholders, status: 'running', stopRequested: false });
  for (const row of rows) {
    if (store.getState().stopRequested) break;
    store.getState().setRows((all) => all.map((r) => r.id === row.id ? { ...r, status: 'generating', error: undefined } : r));
    let pdf: Uint8Array;
    try { pdf = await options.generate(row.values); }
    catch (e) {
      store.getState().setRows((all) => all.map((r) => r.id === row.id ? { ...r, status: 'error', error: e instanceof Error ? e.message : 'Generation failed' } : r));
      continue;
    }
    const filename = `${(row.values[store.getState().placeholders[0]] || `document_${row.id}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)}.pdf`;
    const outputId = newAttachmentId();
    const retained = await putBatchOutput(outputId, pdf);
    store.getState().setRows((all) => all.map((r) => r.id === row.id ? { ...r, status: 'success', filename, outputId: retained ? outputId : undefined } : r));
    if (!retained) store.setState({ recoveryError: 'Generated files could not be retained in this browser. Keep the downloaded copies.' });
    try { options.download(pdf, filename); }
    catch { store.setState({ recoveryError: 'A download was blocked. Use the completed results to download it again.' }); }
  }
  const unfinished = store.getState().rows.some((r) => !r.status || r.status === 'pending' || r.status === 'error');
  store.setState({ status: unfinished ? 'paused' : 'complete', stopRequested: false });
  if (lastWriteFailed(BATCH_KEY)) store.setState({ recoveryError: 'This job could not be saved. Keep this tab open; reload recovery is unavailable.' });
}

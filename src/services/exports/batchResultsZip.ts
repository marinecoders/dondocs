import JSZip from 'jszip';
import type { BatchRow } from '@/stores/batchStore';
import type { SerializedSession } from '@/stores/documentStore';
import { getBatchOutput } from '@/lib/documentsDb';
import { captureBatchRowIntent } from './batchRows';
import { detectBatchPII } from '@/services/pii/batchScan';

export interface ZipResultRow {
  index: number;
  filename?: string;
}

export interface ZipOmission extends ZipResultRow {
  reason: string;
}

export interface BatchResultsZip {
  blob: Blob | null;
  files: ZipResultRow[];
  omitted: ZipOmission[];
}

/** Use the same frozen source and raw row values as individual saved downloads. */
export function inspectSavedBatchResult(row: BatchRow, source: SerializedSession, batchId: string) {
  const intent = captureBatchRowIntent(row.values, {
    source, batchId, rowId: row.id, filename: row.filename!, capturedAt: source.timestamp,
  });
  return detectBatchPII(intent.captured, intent.placeholders);
}

function archiveFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() || '';
  // Browser downloads sanitize device names such as CON.pdf on Windows; ZIP
  // extraction does not. Also keep recovered names portable and at the root.
  const portable = Array.from(basename, character => character.charCodeAt(0) < 32 || '<>:"|?*'.includes(character) ? '_' : character)
    .join('').replace(/[. ]+$/, '') || 'document.pdf';
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(portable) ? `_${portable}` : portable;
}

/** Call only after reviewing the captured rows. Never regenerates a document. */
export async function createBatchResultsZip(rows: readonly BatchRow[], signal?: AbortSignal): Promise<BatchResultsZip> {
  signal?.throwIfAborted();
  const zip = new JSZip();
  const files: ZipResultRow[] = [];
  const omitted: ZipOmission[] = [];
  // Reserve original names so a duplicate cannot displace an existing "(2)" file.
  const reserved = new Set(rows.flatMap(row => row.outputId && row.filename ? [archiveFilename(row.filename).toLowerCase()] : []));
  const unchanged = new Set(rows.flatMap(row => row.outputId && row.filename && archiveFilename(row.filename) === row.filename ? [row.filename.toLowerCase()] : []));
  const used = new Set<string>();

  for (const [position, row] of rows.entries()) {
    signal?.throwIfAborted();
    const result = { index: position + 1, filename: row.filename };
    if (!row.outputId || !row.filename) {
      const reason = row.status === 'error' ? `Failed: ${row.error || 'Generation failed.'}`
        : row.status === 'success' ? 'The PDF or its filename was not retained in this browser.'
          : 'Not generated yet.';
      omitted.push({ ...result, reason });
      continue;
    }

    let bytes: Uint8Array | null;
    try { bytes = await getBatchOutput(row.outputId); }
    catch { bytes = null; }
    signal?.throwIfAborted();
    if (!bytes?.byteLength) {
      omitted.push({ ...result, reason: 'The saved PDF is missing or could not be read from browser storage.' });
      continue;
    }

    const original = archiveFilename(row.filename);
    let filename = original;
    const extensionStart = original.lastIndexOf('.');
    const stem = extensionStart > 0 ? original.slice(0, extensionStart) : original;
    const extension = extensionStart > 0 ? original.slice(extensionStart) : '';
    if (used.has(filename.toLowerCase()) || (original !== row.filename && unchanged.has(filename.toLowerCase()))) {
      let suffix = 2;
      do { filename = `${stem} (${suffix++})${extension}`; }
      while (reserved.has(filename.toLowerCase()) || used.has(filename.toLowerCase()));
    }
    used.add(filename.toLowerCase());
    zip.file(filename, new Uint8Array(bytes));
    files.push({ ...result, filename });
  }

  signal?.throwIfAborted();
  const blob = files.length ? await zip.generateAsync({ type: 'blob' }) : null;
  signal?.throwIfAborted();
  return { blob, files, omitted };
}

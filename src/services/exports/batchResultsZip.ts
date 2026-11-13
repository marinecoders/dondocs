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
  // Retained filenames are normally generated basenames. Keep recovered data
  // from introducing directories or traversal paths into an archive.
  return filename.split(/[\\/]/).pop() || 'document.pdf';
}

/** Call only after reviewing the captured rows. Never regenerates a document. */
export async function createBatchResultsZip(rows: readonly BatchRow[]): Promise<BatchResultsZip> {
  const zip = new JSZip();
  const files: ZipResultRow[] = [];
  const omitted: ZipOmission[] = [];
  // Reserve original names so a duplicate cannot displace an existing "(2)" file.
  const reserved = new Set(rows.flatMap(row => row.outputId && row.filename ? [archiveFilename(row.filename).toLowerCase()] : []));
  const used = new Set<string>();

  for (const [position, row] of rows.entries()) {
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
    if (!bytes?.byteLength) {
      omitted.push({ ...result, reason: 'The saved PDF is missing or could not be read from browser storage.' });
      continue;
    }

    const original = archiveFilename(row.filename);
    let filename = original;
    const extensionStart = original.lastIndexOf('.');
    const stem = extensionStart > 0 ? original.slice(0, extensionStart) : original;
    const extension = extensionStart > 0 ? original.slice(extensionStart) : '';
    if (used.has(filename.toLowerCase())) {
      let suffix = 2;
      do { filename = `${stem} (${suffix++})${extension}`; }
      while (reserved.has(filename.toLowerCase()) || used.has(filename.toLowerCase()));
    }
    used.add(filename.toLowerCase());
    zip.file(filename, new Uint8Array(bytes));
    files.push({ ...result, filename });
  }

  const blob = files.length ? new Blob([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))], { type: 'application/zip' }) : null;
  return { blob, files, omitted };
}

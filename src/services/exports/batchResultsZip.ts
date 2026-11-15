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

export const BATCH_ZIP_LIMITS = Object.freeze({
  files: 500,
  fileBytes: 25 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  archiveBytes: 66 * 1024 * 1024,
  estimatedMemoryBytes: 256 * 1024 * 1024,
});

const BUDGET_RECOVERY = 'No ZIP was downloaded. Your saved PDFs remain available for individual download.';

function exceedsBudget(message: string): never {
  throw new Error(`${message} ${BUDGET_RECOVERY}`);
}

/** STORE avoids a compression workspace; four copies conservatively budget assembly. */
export function assertBatchZipBudget(fileCount: number, totalBytes: number, headerBytes: number): void {
  if (fileCount > BATCH_ZIP_LIMITS.files) {
    exceedsBudget(`A batch ZIP supports at most ${BATCH_ZIP_LIMITS.files} PDFs.`);
  }
  if (totalBytes > BATCH_ZIP_LIMITS.totalBytes) {
    exceedsBudget('The saved PDFs exceed the 64 MB batch ZIP input limit.');
  }
  const archiveBytes = totalBytes + headerBytes;
  if (archiveBytes > BATCH_ZIP_LIMITS.archiveBytes) {
    exceedsBudget('The batch ZIP exceeds the 66 MB archive limit.');
  }
  if (4 * archiveBytes + fileCount * 256 > BATCH_ZIP_LIMITS.estimatedMemoryBytes) {
    exceedsBudget('The batch ZIP exceeds its estimated 256 MB assembly memory budget.');
  }
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
  return /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(portable) ? `_${portable}` : portable;
}

/** Call only after reviewing the captured rows. Never regenerates a document. */
export async function createBatchResultsZip(rows: readonly BatchRow[], signal?: AbortSignal): Promise<BatchResultsZip> {
  signal?.throwIfAborted();
  const candidates = rows.filter(row => row.outputId && row.filename);
  // Reject oversized jobs before reading any PDF bytes into memory.
  assertBatchZipBudget(candidates.length, 0, 22);
  const zip = new JSZip();
  const files: ZipResultRow[] = [];
  const omitted: ZipOmission[] = [];
  let totalBytes = 0;
  let headerBytes = 22;
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
    if (bytes.byteLength > BATCH_ZIP_LIMITS.fileBytes) {
      exceedsBudget(`Saved PDF at row ${position + 1} exceeds the 25 MB per-file batch ZIP limit.`);
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
    const nameBytes = new TextEncoder().encode(filename).byteLength;
    if (nameBytes > 255) {
      exceedsBudget(`The saved filename at row ${position + 1} exceeds 255 UTF-8 bytes. Download this result individually.`);
    }
    totalBytes += bytes.byteLength;
    // Local/central headers, UTF-8 names, and Unicode path extra fields.
    headerBytes += 116 + 4 * nameBytes;
    assertBatchZipBudget(files.length + 1, totalBytes, headerBytes);
    used.add(filename.toLowerCase());
    // IndexedDB returns owned bytes. Do not allocate another full PDF copy.
    zip.file(filename, bytes);
    files.push({ ...result, filename });
  }

  signal?.throwIfAborted();
  const blob = files.length ? await zip.generateAsync({ type: 'blob', compression: 'STORE' }, () => {
    signal?.throwIfAborted();
  }) : null;
  signal?.throwIfAborted();
  if (blob && blob.size > BATCH_ZIP_LIMITS.archiveBytes) {
    exceedsBudget('The batch ZIP exceeds the 66 MB archive limit.');
  }
  return { blob, files, omitted };
}

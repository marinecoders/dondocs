import { afterEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import * as documentsDb from '@/lib/documentsDb';
import { createBatchResultsZip } from '@/services/exports/batchResultsZip';
import type { BatchRow } from '@/stores/batchStore';

afterEach(() => vi.restoreAllMocks());
const saved = (filename: string, id: string): BatchRow => ({ id, filename, outputId: id, status: 'success', values: {} });

it('preserves PDF bytes and filenames, resolving case-insensitive duplicates without displacing original names', async () => {
  const read = vi.spyOn(documentsDb, 'getBatchOutput').mockImplementation(async id => new TextEncoder().encode(`%PDF-${id}`));
  const result = await createBatchResultsZip([
    saved('Sample.pdf', 'one'), saved('Sample.pdf', 'two'), saved('Sample (2).pdf', 'three'), saved('SAMPLE.PDF', 'four'),
  ]);
  expect(result.blob?.type).toBe('application/zip');
  const zip = await JSZip.loadAsync(await result.blob!.arrayBuffer(), { checkCRC32: true });
  expect(Object.keys(zip.files)).toEqual(['Sample.pdf', 'Sample (3).pdf', 'Sample (2).pdf', 'SAMPLE (4).PDF']);
  expect(await zip.file('Sample (3).pdf')!.async('string')).toBe('%PDF-two');
  expect(await zip.file('Sample (2).pdf')!.async('string')).toBe('%PDF-three');
  expect(result.omitted).toEqual([]);
  expect(read).toHaveBeenCalledTimes(4);
});

it('includes retained PDFs after blocked individual delivery and identifies every omitted row', async () => {
  vi.spyOn(documentsDb, 'getBatchOutput').mockImplementation(async id => {
    if (id === 'unreadable') throw new Error('Storage unavailable');
    return id === 'retained' ? new Uint8Array([37, 80, 68, 70]) : null;
  });
  const result = await createBatchResultsZip([
    { ...saved('ready.pdf', 'retained'), status: 'error', error: 'Download blocked' },
    { id: 'failed', values: {}, status: 'error', error: 'Compilation failed' },
    { id: 'unsaved', values: {}, status: 'success', filename: 'unsaved.pdf' },
    saved('missing.pdf', 'missing'), saved('unreadable.pdf', 'unreadable'),
    { id: 'pending', values: {}, status: 'pending' },
    { ...saved('metadata.pdf', 'metadata'), filename: undefined },
  ]);
  const zip = await JSZip.loadAsync(await result.blob!.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(['ready.pdf']);
  expect(result.omitted.map(row => row.index)).toEqual([2, 3, 4, 5, 6, 7]);
  expect(result.omitted[0].reason).toContain('Compilation failed');
  expect(result.omitted[1].reason).toContain('not retained');
  expect(result.omitted[2].reason).toContain('missing');
  expect(result.omitted[3].reason).toContain('could not be read');
  expect(result.omitted[4].reason).toContain('Not generated');
});

it('never produces an empty archive when all saved PDFs are missing or empty', async () => {
  vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValueOnce(null).mockResolvedValueOnce(new Uint8Array());
  const result = await createBatchResultsZip([saved('gone.pdf', 'gone'), saved('empty.pdf', 'empty')]);
  expect(result.blob).toBeNull();
  expect(result.files).toEqual([]);
  expect(result.omitted).toHaveLength(2);
});

it('keeps recovered filenames at the archive root', async () => {
  vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([1]));
  const result = await createBatchResultsZip([saved('../../Sample.pdf', 'one'), saved('folder\\Sample.pdf', 'two')]);
  const zip = await JSZip.loadAsync(await result.blob!.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(['Sample.pdf', 'Sample (2).pdf']);
});

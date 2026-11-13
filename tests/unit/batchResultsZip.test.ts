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

it('makes Windows-reserved and malformed recovered names extractable without losing collisions', async () => {
  vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([1]));
  const names = ['CON.pdf', '_CON.pdf', 'nul.PDF', 'COM1.pdf', 'LPT9.pdf', 'safe:name.pdf', 'safe?name.pdf', 'trailing.pdf. ', '..', 'folder/'];
  const result = await createBatchResultsZip(names.map((name, index) => saved(name, String(index))));
  const zip = await JSZip.loadAsync(await result.blob!.arrayBuffer(), { checkCRC32: true });
  expect(Object.keys(zip.files)).toEqual([
    '_CON (2).pdf', '_CON.pdf', '_nul.PDF', '_COM1.pdf', '_LPT9.pdf',
    'safe_name.pdf', 'safe_name (2).pdf', 'trailing.pdf', 'document.pdf', 'document (2).pdf',
  ]);
  expect(Object.values(zip.files).every(file => !file.dir)).toBe(true);
  expect(result.files).toHaveLength(names.length);
});

it('does not read any saved output when cancelled before preparation starts', async () => {
  const read = vi.spyOn(documentsDb, 'getBatchOutput');
  const controller = new AbortController();
  controller.abort();
  await expect(createBatchResultsZip([saved('Sample.pdf', 'one')], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).not.toHaveBeenCalled();
});

it.each(['success', 'failure'] as const)('stops before reading the next output after cancellation during a %s', async outcome => {
  let finish!: (value: Uint8Array) => void;
  let fail!: (error: Error) => void;
  const read = vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([2]))
    .mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve;fail = reject; }));
  const controller = new AbortController();
  const archive = createBatchResultsZip([saved('Sample.pdf', 'one'), saved('Second.pdf', 'two')], controller.signal);
  // Attach the rejection handler before settling the pending storage operation.
  const aborted = expect(archive).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).toHaveBeenCalledExactlyOnceWith('one');
  controller.abort();
  if (outcome === 'success') finish(new Uint8Array([1]));
  else fail(new Error('Storage unavailable'));
  await aborted;
  expect(read).toHaveBeenCalledTimes(1);
});

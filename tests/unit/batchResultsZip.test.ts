import { afterEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import * as documentsDb from '@/lib/documentsDb';
import { assertBatchZipBudget, BATCH_ZIP_LIMITS, createBatchResultsZip } from '@/services/exports/batchResultsZip';
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

it('escapes superscript Windows device names without displacing safe names or changing bytes', async () => {
  vi.spyOn(documentsDb, 'getBatchOutput').mockImplementation(async id => new TextEncoder().encode(`%PDF-${id}`));
  const result = await createBatchResultsZip([
    saved('COM¹.pdf', 'one'), saved('_COM¹.pdf', 'two'), saved('LPT².PDF', 'three'), saved('LPT³.pdf', 'four'),
  ]);
  const zip = await JSZip.loadAsync(await result.blob!.arrayBuffer(), { checkCRC32: true });
  expect(Object.keys(zip.files)).toEqual(['_COM¹ (2).pdf', '_COM¹.pdf', '_LPT².PDF', '_LPT³.pdf']);
  expect(await zip.file('_COM¹ (2).pdf')!.async('string')).toBe('%PDF-one');
  expect(await zip.file('_COM¹.pdf')!.async('string')).toBe('%PDF-two');
  expect(await zip.file('_LPT².PDF')!.async('string')).toBe('%PDF-three');
  expect(await zip.file('_LPT³.pdf')!.async('string')).toBe('%PDF-four');
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

it('rejects too many retained candidates before reading storage or starting assembly', async () => {
  const read = vi.spyOn(documentsDb, 'getBatchOutput');
  const generate = vi.spyOn(JSZip.prototype, 'generateAsync');
  const rows = Array.from({ length: BATCH_ZIP_LIMITS.files + 1 }, (_, index) => saved(`${index}.pdf`, String(index)));
  await expect(createBatchResultsZip(rows)).rejects.toThrow('at most 500 PDFs');
  expect(read).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

it('does not count pending rows against the retained file limit', async () => {
  const rows: BatchRow[] = Array.from({ length: BATCH_ZIP_LIMITS.files + 1 }, (_, index) => ({
    id: String(index), values: {}, status: 'pending',
  }));
  vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([1]));
  const result = await createBatchResultsZip([...rows, saved('retained.pdf', 'retained')]);
  expect(result.files).toHaveLength(1);
  expect(result.omitted).toHaveLength(rows.length);
});

it('stops after an oversized PDF without assembling a partial ZIP or changing retained results', async () => {
  const bytes = new Uint8Array(BATCH_ZIP_LIMITS.fileBytes + 1);
  const read = vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(bytes);
  const generate = vi.spyOn(JSZip.prototype, 'generateAsync');
  const rows = [saved('large.pdf', 'large'), saved('next.pdf', 'next')];
  const before = structuredClone(rows);
  await expect(createBatchResultsZip(rows)).rejects.toThrow('Your saved PDFs remain available for individual download');
  expect(read).toHaveBeenCalledExactlyOnceWith('large');
  expect(generate).not.toHaveBeenCalled();
  expect(rows).toEqual(before);
});

it('enforces aggregate bytes before starting ZIP assembly', async () => {
  const bytes = new Uint8Array(23 * 1024 * 1024);
  vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(bytes);
  const generate = vi.spyOn(JSZip.prototype, 'generateAsync');
  await expect(createBatchResultsZip([saved('a.pdf', 'a'), saved('b.pdf', 'b'), saved('c.pdf', 'c')]))
    .rejects.toThrow('64 MB batch ZIP input limit');
  expect(generate).not.toHaveBeenCalled();
});

it('budgets archive overhead and estimated assembly memory as well as PDF bytes', () => {
  expect(() => assertBatchZipBudget(500, 1, 22)).not.toThrow();
  expect(() => assertBatchZipBudget(1, BATCH_ZIP_LIMITS.totalBytes, 22)).toThrow('assembly memory budget');
  expect(() => assertBatchZipBudget(1, 1, BATCH_ZIP_LIMITS.archiveBytes)).toThrow('66 MB archive limit');
});

it('rejects overlong UTF-8 filenames instead of silently losing names in extraction', async () => {
  vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([1]));
  const generate = vi.spyOn(JSZip.prototype, 'generateAsync');
  await expect(createBatchResultsZip([saved(`${'文'.repeat(84)}.pdf`, 'long')])).rejects.toThrow('255 UTF-8 bytes');
  expect(generate).not.toHaveBeenCalled();
});

it('cancels during ZIP assembly without returning a downloadable partial archive', async () => {
  vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([1]));
  const generate = JSZip.prototype.generateAsync;
  const controller = new AbortController();
  const assembly = vi.spyOn(JSZip.prototype, 'generateAsync').mockImplementation(function (this: JSZip, options, update) {
    return generate.call(this, options, metadata => {
      controller.abort();
      update?.(metadata);
    });
  });
  await expect(createBatchResultsZip([saved('sample.pdf', 'one')], controller.signal))
    .rejects.toMatchObject({ name: 'AbortError' });
  expect(assembly).toHaveBeenCalledOnce();
});

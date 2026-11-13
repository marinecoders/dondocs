import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { BatchModal } from '@/components/modals/BatchModal';
import { useBatchStore } from '@/stores/batchStore';
import { useUIStore } from '@/stores/uiStore';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import * as documentsDb from '@/lib/documentsDb';
import * as encoding from '@/lib/encoding';
import * as zipExports from '@/services/exports/batchResultsZip';

beforeEach(() => {
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ documentCategory: 'correspondence', documentMode: 'compliant', docType: 'standard_letter',
    formData: { subject: 'Training {{NAME}}' }, paragraphs: [{ text: 'Safe sample body.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] });
  useUIStore.setState({ batchModalOpen: true });
  useBatchStore.setState({ source: getSerializedSession(), jobId: 'saved-job', status: 'complete', rowActive: false,
    title: 'Training', placeholders: ['NAME'], recoveryError: '', stopRequested: false, review: null, rows: [
      { id: 'one', values: { NAME: 'Sample' }, status: 'success', outputId: 'output-one', filename: 'Sample.pdf' },
      { id: 'two', values: { NAME: 'Sample' }, status: 'success', outputId: 'output-two', filename: 'Sample.pdf' },
    ] });
});
afterEach(() => vi.restoreAllMocks());
const open = () => render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
const clickZip = () => fireEvent.click(screen.getByRole('button', { name: 'Download ZIP' }));

it('downloads available results in one ZIP and reports failed, unfinished and missing rows', async () => {
  vi.spyOn(documentsDb, 'getBatchOutput').mockImplementation(async id => id === 'missing' ? null : new TextEncoder().encode(`%PDF-${id}`));
  const download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  useBatchStore.getState().setRows(rows => [...rows,
    { id: 'failed', values: {}, status: 'error', error: 'Compilation failed' },
    { id: 'gone', values: {}, status: 'success', outputId: 'missing', filename: 'gone.pdf' },
    { id: 'pending', values: {}, status: 'pending' },
  ]);
  open();clickZip();
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  expect(download.mock.calls[0][1]).toBe('dondocs-batch-results.zip');
  const zip = await JSZip.loadAsync(await (download.mock.calls[0][0] as Blob).arrayBuffer(), { checkCRC32: true });
  expect(Object.keys(zip.files)).toEqual(['Sample.pdf', 'Sample (2).pdf']);
  expect(await zip.file('Sample (2).pdf')!.async('string')).toBe('%PDF-output-two');
  expect(screen.getByText('ZIP ready: 2 PDFs included; 3 rows omitted.')).toBeVisible();
  expect(screen.getByText('Row #3: Failed: Compilation failed')).toBeVisible();
  expect(screen.getByText(/Row #4.*gone.pdf.*missing/)).toBeVisible();
  expect(screen.getByText('Row #5: Not generated yet.')).toBeVisible();
});

it('reviews every sensitive saved row before reading bytes and binds approval to the captured results', async () => {
  const read = vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([1]));
  const download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  useBatchStore.getState().setRows(rows => rows.map((row, index) => ({ ...row, values: { ...row.values, UNUSED: index ? 'SSN 987-65-4321' : 'SSN 123-45-6789' } })));
  open();clickZip();
  const review = await screen.findByRole('dialog', { name: 'Review ZIP download' });
  expect(review).toHaveTextContent('Row #1: Sample.pdf');
  expect(review).toHaveTextContent('Row #2: Sample.pdf');
  expect(review).toHaveTextContent('Social Security Number');
  expect(review).not.toHaveTextContent('123-45-6789');
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
  expect(read).not.toHaveBeenCalled();
  clickZip();
  act(() => {
    useDocumentStore.setState({ paragraphs: [{ text: 'Changed live editor.', level: 0 }] });
    useBatchStore.getState().rows[0].outputId = 'different';
    useBatchStore.getState().rows[0].filename = 'different.pdf';
    useBatchStore.getState().source!.paragraphs[0].text = 'Changed saved source.';
  });
  fireEvent.click(screen.getByRole('button', { name: 'Download reviewed ZIP' }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  expect(read.mock.calls.map(([id]) => id)).toEqual(['output-one', 'output-two']);
  const zip = await JSZip.loadAsync(await (download.mock.calls[0][0] as Blob).arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(['Sample.pdf', 'Sample (2).pdf']);
});

it.each(['missing source', 'inspection failure'])('requires explicit confirmation for %s', async reason => {
  const read = vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([1]));
  const download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  if (reason === 'missing source') useBatchStore.setState({ source: null });
  else vi.spyOn(zipExports, 'inspectSavedBatchResult').mockImplementation(() => { throw new Error('Cannot inspect'); });
  open();clickZip();
  await screen.findByRole('dialog', { name: 'Review ZIP download' });
  expect(screen.getAllByText(/source text.*unavailable or could not be inspected/)).toHaveLength(2);
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Download ZIP without text review' }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
});

it('reports an unavailable archive without triggering an empty download', async () => {
  vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(null);
  const download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  open();clickZip();
  expect(await screen.findByRole('alert')).toHaveTextContent('No saved PDFs are available. No ZIP was downloaded.');
  expect(screen.getByText(/Row #1.*Sample.pdf.*missing/)).toBeVisible();
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Download ZIP' })).toBeEnabled();
});

it.each(['close button', 'external close', 'unmount'] as const)('stops loading more results after %s and allows a fresh attempt', async mode => {
  let finish!: (data: Uint8Array | null) => void;
  const read = vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([2]))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const prepare = vi.spyOn(zipExports, 'createBatchResultsZip');
  const download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  const view = open();clickZip();
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  const cancelled = expect(prepare.mock.results[0].value).rejects.toMatchObject({ name: 'AbortError' });
  expect(screen.getByRole('button', { name: 'Preparing ZIP…' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Preparing ZIP…' }));
  if (mode === 'close button') fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
  else if (mode === 'external close') act(() => useUIStore.setState({ batchModalOpen: false }));
  else view.unmount();
  if (mode === 'unmount') open();
  else act(() => useUIStore.setState({ batchModalOpen: true }));
  await act(async () => { finish(new Uint8Array([1]));await cancelled; });
  expect(read).toHaveBeenCalledTimes(1);
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Download ZIP' })).toBeEnabled();
  clickZip();
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
});

it('keeps sensitive findings visible when another result cannot be inspected', async () => {
  const inspect = zipExports.inspectSavedBatchResult;
  vi.spyOn(zipExports, 'inspectSavedBatchResult').mockImplementationOnce(inspect)
    .mockImplementationOnce(() => { throw new Error('Inspection unavailable'); });
  useBatchStore.getState().setRows(rows => rows.map((row, index) => index ? row : { ...row, values: { ...row.values, UNUSED: 'SSN 123-45-6789' } }));
  const read = vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([1]));
  const download = vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => {});
  open();clickZip();
  const review = screen.getByRole('dialog', { name: 'Review ZIP download' });
  expect(review).toHaveTextContent('Social Security Number');
  expect(review).toHaveTextContent('source text for this saved result is unavailable');
  expect(review).not.toHaveTextContent('123-45-6789');
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Download ZIP without text review' }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  expect(read).toHaveBeenCalledTimes(2);
});

it('disables ZIP downloads while generation runs or no saved result has metadata', () => {
  useBatchStore.setState({ status: 'running' });
  open();
  expect(screen.getByRole('button', { name: 'Download ZIP' })).toBeDisabled();
  act(() => useBatchStore.setState({ status: 'complete', rows: [{ id: 'unsaved', values: {}, status: 'success', filename: 'unsaved.pdf' }] }));
  expect(screen.getByRole('button', { name: 'Download ZIP' })).toBeDisabled();
  expect(screen.getByText(/Row #1.*unsaved.pdf.*not retained/)).toBeVisible();
});

it('reports delivery errors and leaves retained results available for retry', async () => {
  vi.spyOn(documentsDb, 'getBatchOutput').mockResolvedValue(new Uint8Array([1]));
  vi.spyOn(encoding, 'triggerDownload').mockImplementation(() => { throw new Error('Download blocked'); });
  open();clickZip();
  expect(await screen.findByRole('alert')).toHaveTextContent('Download blocked');
  expect(screen.getByRole('button', { name: 'Download ZIP' })).toBeEnabled();
  expect(useBatchStore.getState().rows.every(row => row.outputId)).toBe(true);
});

import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BatchModal } from '@/components/modals/BatchModal';
import { useUIStore } from '@/stores/uiStore';
import { useBatchStore } from '@/stores/batchStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { getExportDeploymentPolicy } from '@/config/classification';
import { rosterFile } from '../_helpers/excelRosterFixture';
import * as rosterReader from '@/lib/excelRoster';

const compile = vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
const open = () => render(<BatchModal compile={compile} isEngineReady={true} waitForReady={vi.fn().mockResolvedValue(true)} />);
const upload = (file: File) => fireEvent.change(screen.getByLabelText('Upload Excel roster (.xlsx)'), { target: { files: [file] } });

beforeEach(async () => {
  compile.mockClear();
  useDocumentsStore.getState().newDocument();
  useUIStore.setState({ batchModalOpen: true });
  useDocumentStore.setState({ documentMode: 'custom', documentCategory: 'correspondence', docType: 'standard_letter', formData: { subject: '{{NAME}} {{MOS}}', classLevel: 'unclassified' }, paragraphs: [{ text: '{{EVENT_DATE}} {{BODY}}', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] });
  useBatchStore.setState({ source: null, jobId: null, title: '', placeholders: [], rows: [{ id: 'one', values: {}, status: 'pending' }], status: 'idle', recoveryError: '', stopRequested: false, rowActive: false, review: null });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ maxLevel: 'unclassified', allowedLevels: ['unclassified'] }) }));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await getExportDeploymentPolicy(undefined, true);
});
afterEach(() => { vi.restoreAllMocks();vi.unstubAllGlobals(); });

it('previews a real workbook, selects a later header, maps rows, corrects warnings and generates through the existing batch job', async () => {
  open();
  upload(rosterFile([['Synthetic sample'], [], ['NAME', 'MOS', 'EVENT_DATE', 'BODY'], ['Recipient A', 12, '03/04/2026', ''], ['Recipient B', '0013', '2026-04-04', 'Training example']]));
  await screen.findByText('sample-roster.xlsx · First worksheet:');
  expect(screen.getByRole('table', { name: 'First worksheet preview' })).toHaveTextContent('3');
  // Preview does not replace the existing editable batch until mapping is applied.
  expect(useBatchStore.getState().rows).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Header row'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Map 2 roster rows' }));
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeDisabled();
  expect(screen.getByText(/Stored as a number/)).toBeVisible();
  expect(screen.getByText(/Ambiguous date/)).toBeVisible();
  expect(screen.getByText(/BODY: Missing value/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  expect(useBatchStore.getState().rows.map(row => row.values)).toEqual([
    { NAME: 'Recipient A', MOS: '12', EVENT_DATE: '03/04/2026', BODY: '' },
    { NAME: 'Recipient B', MOS: '0013', EVENT_DATE: '2026-04-04', BODY: 'Training example' },
  ]);
  expect(useBatchStore.getState().rows[0].worksheetRow).toBe(4);
  fireEvent.change(screen.getByRole('textbox', { name: 'Row 1: EVENT_DATE' }), { target: { value: '05/06/2026' } });
  expect(screen.getByText(/Ambiguous date/)).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Row 1: MOS' }), { target: { value: '0012' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Row 1: EVENT_DATE' }), { target: { value: '2026-04-03' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Row 1: BODY' }), { target: { value: 'Corrected training example' } });
  expect(screen.queryByText(/Roster checks/)).not.toBeInTheDocument();
  expect(compile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Generate 2 PDFs' }));
  for (let i = 1; i <= 2; i++) {
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with this row' }));
    await waitFor(() => expect(compile).toHaveBeenCalledTimes(i));
  }
  await waitFor(() => expect(useBatchStore.getState().status).toBe('complete'));
  expect(compile).toHaveBeenCalledTimes(2);
  const firstDocument = Object.values(compile.mock.calls[0][0]).join('\n');
  expect(firstDocument).toContain('0012');
  expect(firstDocument).toContain('2026-04-03');
  expect(firstDocument).toContain('Corrected training example');
});

it('supports a headerless workbook and prevents two columns overwriting the same variable', async () => {
  const user = userEvent.setup();
  open();upload(rosterFile([['Recipient A', '0012', '2026-04-03', 'Example body']]));
  await screen.findByLabelText('No header row');
  await user.click(screen.getByLabelText('No header row'));
  await user.click(screen.getByRole('button', { name: 'Map 1 roster row' }));
  expect(screen.getByRole('button', { name: 'Apply Mapping' })).toBeDisabled();
  await user.click(screen.getByRole('combobox', { name: 'Map column 1: Column 1' }));
  await user.click(screen.getByRole('option', { name: '{{NAME}}' }));
  await user.click(screen.getByRole('combobox', { name: 'Map column 2: Column 2' }));
  await user.click(screen.getByRole('option', { name: '{{NAME}}' }));
  expect(screen.getByText(/Each variable can use only one column/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply Mapping' })).toBeDisabled();
  await user.click(screen.getByRole('combobox', { name: 'Map column 2: Column 2' }));
  await user.click(screen.getByRole('option', { name: '— Skip —' }));
  await user.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  expect(useBatchStore.getState().rows[0].values).toEqual({ NAME: 'Recipient A' });
  expect(screen.getByText(/MOS: Missing value/)).toBeVisible();
});

it('recovers from an invalid file and preserves pasted spreadsheet mapping', async () => {
  open();upload(new File(['bad file'], 'invalid.xlsx'));
  expect(await screen.findByRole('alert')).toHaveTextContent('not an Excel workbook');
  upload(rosterFile([['NAME'], ['Recipient A']]));
  await screen.findByRole('button', { name: 'Map 1 roster row' });
  const paste = screen.getByPlaceholderText(/Paste tab-separated data here/);
  fireEvent.paste(paste, { clipboardData: { getData: () => 'NAME\tMOS\tEVENT_DATE\tBODY\nRecipient C\t0014\t2026-04-05\tPasted example' } });
  expect(screen.queryByRole('table', { name: 'First worksheet preview' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  expect(useBatchStore.getState().rows[0].values.NAME).toBe('Recipient C');
  expect(useBatchStore.getState().rows[0].values.MOS).toBe('0014');
});

it('can cancel an unapplied roster without replacing the current batch rows', async () => {
  open();upload(rosterFile([['NAME'], ['Recipient A']]));
  await screen.findByRole('button', { name: 'Map 1 roster row' });
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Map 1 roster row' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel roster import' }));
  expect(screen.queryByText('Column Mapping')).not.toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'First worksheet preview' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeEnabled();
  expect(useBatchStore.getState().rows).toEqual([{ id: 'one', values: {}, status: 'pending' }]);
});

it('clears an unapplied import when closing and reopening the panel', async () => {
  open();upload(rosterFile([['NAME'], ['Recipient A']]));
  await screen.findByRole('button', { name: 'Map 1 roster row' });
  expect(screen.getByRole('button', { name: 'Preview row 1' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
  act(() => useUIStore.setState({ batchModalOpen: true }));
  expect(screen.queryByRole('table', { name: 'First worksheet preview' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeEnabled();
  expect(useBatchStore.getState().rows).toEqual([{ id: 'one', values: {}, status: 'pending' }]);
});

it('invalidates old mappings when the selected header or no-header setting changes', async () => {
  open();upload(rosterFile([['NAME'], ['Recipient A'], ['Recipient B']]));
  await screen.findByRole('button', { name: 'Map 2 roster rows' });
  fireEvent.click(screen.getByRole('button', { name: 'Map 2 roster rows' }));
  expect(screen.getByRole('button', { name: 'Apply Mapping' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Header row'), { target: { value: '2' } });
  expect(screen.queryByRole('button', { name: 'Apply Mapping' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Map 1 roster row' }));
  expect(screen.getByRole('combobox', { name: 'Map column 1: Recipient A' })).toBeVisible();
  fireEvent.click(screen.getByLabelText('No header row'));
  expect(screen.queryByRole('button', { name: 'Apply Mapping' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeDisabled();
});

it.each(['close', 'paste'])('ignores a late file read after %s discards the import', async action => {
  let finish!: (roster: rosterReader.ExcelRoster) => void;
  vi.spyOn(rosterReader, 'readExcelRoster').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  open();upload(new File(['pending'], 'pending.xlsx'));
  expect(screen.getByText('Reading workbook…')).toBeVisible();
  if (action === 'close') {
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    act(() => useUIStore.setState({ batchModalOpen: true }));
  } else {
    fireEvent.paste(screen.getByPlaceholderText(/Paste tab-separated data here/), { clipboardData: { getData: () => 'NAME\nPasted recipient' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  }
  await act(async () => finish({ sheetName: 'Discarded worksheet', columnCount: 1, rows: [{ number: 1, cells: [{ value: 'NAME' }] }, { number: 2, cells: [{ value: 'Late recipient' }] }] }));
  expect(screen.queryByText(/Discarded worksheet/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeEnabled();
  expect(useBatchStore.getState().rows[0].values.NAME).toBe(action === 'paste' ? 'Pasted recipient' : undefined);
});

it('retains only mapped warning metadata with the batch rows when the panel remounts', async () => {
  const view = open();
  upload(rosterFile([['NAME', 'MOS', 'UNUSED'], ['Recipient A', 12, 'Discarded content']]));
  await screen.findByRole('button', { name: 'Map 1 roster row' });
  fireEvent.click(screen.getByRole('button', { name: 'Map 1 roster row' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  expect(JSON.stringify(useBatchStore.getState().rows)).not.toContain('Discarded content');
  view.unmount();open();
  const checks = screen.getByText(/Roster checks/).closest('[role="status"]')! as HTMLElement;
  expect(within(checks).getByText(/Stored as a number/)).toBeVisible();
  expect(within(checks).getByText(/EVENT_DATE: Missing value/)).toBeVisible();
});

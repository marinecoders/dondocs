import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BatchModal } from '@/components/modals/BatchModal';
import { useUIStore } from '@/stores/uiStore';
import { useBatchStore } from '@/stores/batchStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { fixtureInstance } from '../_helpers/formFixture';
import { rosterFile } from '../_helpers/excelRosterFixture';

beforeEach(() => {
  useDocumentsStore.getState().newDocument();
  const genericForm = fixtureInstance();genericForm.definition.rowGroups = {};
  useDocumentStore.setState({ documentMode: 'compliant', documentCategory: 'forms', formType: 'fixture', genericForm });
  useUIStore.setState({ batchModalOpen: true });
  useBatchStore.setState({ source: null, jobId: null, title: '', placeholders: [], rows: [{ id: 'one', values: {}, status: 'pending' }], status: 'idle', recoveryError: '', stopRequested: false, rowActive: false, review: null });
});

it('maps pasted roster values to configured fields and explains typed errors without editing the source', () => {
  const compile = vi.fn();
  render(<BatchModal compile={compile} isEngineReady={false} waitForReady={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'Configured form roster fields' })).toHaveTextContent('Signature fields stay blank');
  expect(screen.queryByText('Add a variable')).not.toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Form row checks' })).toHaveTextContent('Name is required');
  fireEvent.paste(screen.getByPlaceholderText(/Paste tab-separated/), { clipboardData: { getData: () => 'name\tdecision\ta\nRecipient B\tNo\tfalse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  expect(screen.getByRole('textbox', { name: 'Row 1: name' })).toHaveValue('Recipient B');
  expect(screen.queryByRole('status', { name: 'Form row checks' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Row 1: a' }), { target: { value: 'maybe' } });
  expect(screen.getByRole('status', { name: 'Form row checks' })).toHaveTextContent('Enter yes, no, true, or false');
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeDisabled();
  expect(useDocumentStore.getState().genericForm?.answers.name).toBe('000123');
  expect(compile).not.toHaveBeenCalled();
});

it('reviews normalized multiple selections from a workbook and removes the preview for invalid cells', async () => {
  const genericForm = fixtureInstance();
  genericForm.definition.rowGroups = {};
  genericForm.definition.pages[0].sha256 = 'a'.repeat(64);
  genericForm.definition.fields.decision.kind = 'multipleChoice';
  genericForm.answers.decision = ['yes'];
  useDocumentStore.setState({ genericForm });
  render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'Configured form roster fields' })).toHaveTextContent('JSON array');
  fireEvent.change(screen.getByLabelText('Upload Excel roster (.xlsx)'), {
    target: { files: [rosterFile([['name', 'decision'], ['B', '["YES","no"]']])] },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Map 1 roster row' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  const input = screen.getByRole('textbox', { name: 'Row 1: decision' });
  const selected = screen.getByLabelText('Row 1: decision selected options');
  expect(selected).toHaveTextContent('Selected: Yes (yes); No (no)');
  expect(input).toHaveAttribute('aria-describedby', selected.id);
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeEnabled();
  fireEvent.change(input, { target: { value: '["yes","YES"]' } });
  expect(screen.queryByLabelText('Row 1: decision selected options')).not.toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Form row checks' })).toHaveTextContent('Select each option only once');
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeDisabled();
  expect(useDocumentStore.getState().genericForm?.answers.decision).toEqual(['yes']);
});

it('does not borrow a live form definition when a retained job has no captured definition', async () => {
  const { getSerializedSession } = await import('@/stores/documentStore');
  const source = getSerializedSession();delete source.genericForm;
  useBatchStore.setState({ source, jobId: 'old-job', status: 'paused', placeholders: ['name'] });
  render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
  expect(screen.queryByRole('region', { name: 'Configured form roster fields' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resume remaining' })).toBeDisabled();
});


it.each(['__skip__', 'skip', 'name'])('keeps manual mapping and skipping distinct for the configured field %s', fieldId => {
  const genericForm = fixtureInstance();
  genericForm.definition.rowGroups = {};
  genericForm.definition.pages[0].sha256 = 'a'.repeat(64);
  if (fieldId !== 'name') {
    genericForm.definition.fields[fieldId] = genericForm.definition.fields.name;
    delete genericForm.definition.fields.name;
    genericForm.definition.sections = genericForm.definition.sections.map(section => ({
      ...section, fields: section.fields.map(id => id === 'name' ? fieldId : id),
    }));
    genericForm.definition.placements = genericForm.definition.placements.map(placement => ({
      ...placement, fieldId: placement.fieldId === 'name' ? fieldId : placement.fieldId,
    }));
  }
  genericForm.answers = { [fieldId]: 'SOURCE PERSON', decision: 'yes' };
  useDocumentStore.setState({ genericForm });
  render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
  fireEvent.paste(screen.getByPlaceholderText(/Paste tab-separated/), {
    clipboardData: { getData: () => 'Recipient\tdecision\nRecipient B\tyes' },
  });
  const mapping = screen.getByRole('combobox', { name: 'Map column 1: Recipient' });
  const choose = (name: string) => {
    fireEvent.pointerDown(mapping, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(screen.getByRole('option', { name }));
  };
  choose(`{{${fieldId}}}`);
  expect(mapping).toHaveTextContent(`{{${fieldId}}}`);
  choose('— Skip —');
  expect(mapping).toHaveTextContent('— Skip —');
  choose(`{{${fieldId}}}`);
  fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  expect(screen.getByRole('textbox', { name: `Row 1: ${fieldId}` })).toHaveValue('Recipient B');
  expect(screen.queryByRole('status', { name: 'Form row checks' })).not.toBeInTheDocument();
  expect(useDocumentStore.getState().genericForm?.answers[fieldId]).toBe('SOURCE PERSON');
});


it('keeps workbook provenance warnings visible after applying a configured roster', async () => {
  render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Upload Excel roster (.xlsx)'), {
    target: { files: [rosterFile([['name', 'decision'], [1234567890123456, 'yes']])] },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Map 1 roster row' }));
  expect(screen.getByText(/Excel may have rounded this number/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  expect(screen.getByText(/Excel may have rounded this number/)).toBeVisible();
  expect(screen.queryByText(/Missing value/)).not.toBeInTheDocument();
  const recipient = screen.getByRole('textbox', { name: 'Row 1: name' });
  expect(recipient).toHaveAttribute('aria-describedby', 'batch-roster-checks');
  expect(document.getElementById('batch-roster-checks')).not.toBeNull();
  fireEvent.change(recipient, { target: { value: '001234' } });
  expect(screen.queryByText(/Excel may have rounded this number/)).not.toBeInTheDocument();
  expect(recipient).not.toHaveAttribute('aria-describedby');
  expect(useDocumentStore.getState().genericForm?.answers.name).toBe('000123');
});


it.each(['text', 'identifier'] as const)('keeps date-like literal %s answers free of inferred roster date warnings', async kind => {
  const genericForm = fixtureInstance();genericForm.definition.rowGroups = {};
  genericForm.definition.fields.name.kind = kind;
  useDocumentStore.setState({ genericForm });
  render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Upload Excel roster (.xlsx)'), {
    target: { files: [rosterFile([['name', 'decision'], ['01/02/2026', 'yes']])] },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Map 1 roster row' }));
  expect(screen.queryByText(/Ambiguous date/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  const recipient = screen.getByRole('textbox', { name: 'Row 1: name' });
  expect(recipient).toHaveValue('01/02/2026');
  expect(recipient).not.toHaveAttribute('aria-describedby');
  expect(screen.queryByText(/Ambiguous date|Missing value/)).not.toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Form row checks' })).not.toBeInTheDocument();
});


for (const input of ['workbook', 'mapped paste', 'direct paste']) {
  it.each(['text', 'identifier'] as const)(`keeps configured %s spacing rules through ${input}`, async kind => {
    const genericForm = fixtureInstance();genericForm.definition.rowGroups = {};
    genericForm.definition.fields.name.kind = kind;
    genericForm.answers.name = 'SOURCE PERSON';
    useDocumentStore.setState({ genericForm });
    render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
    const raw = input === 'direct paste' ? '  Recipient B 42  ' : '  Recipient B  ';
    if (input === 'workbook') {
      fireEvent.change(screen.getByLabelText('Upload Excel roster (.xlsx)'), {
        target: { files: [rosterFile([['name', 'decision'], [raw, 'yes']])] },
      });
      fireEvent.click(await screen.findByRole('button', { name: 'Map 1 roster row' }));
      fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
    } else {
      fireEvent.paste(screen.getByPlaceholderText(/Paste tab-separated/), {
        clipboardData: { getData: () => `${input === 'mapped paste' ? 'name\tdecision\n' : ''}${raw}\tyes` },
      });
      if (input === 'mapped paste') fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
    }
    expect(screen.getByRole('textbox', { name: 'Row 1: name' })).toHaveValue(kind === 'text' ? raw : raw.trim());
    expect(useDocumentStore.getState().genericForm?.answers.name).toBe('SOURCE PERSON');
  });
}


it('preserves final configured text-cell spaces without retaining clipboard CRLF separators', () => {
  const genericForm = fixtureInstance();genericForm.definition.rowGroups = {};
  genericForm.definition.fields.name.kind = 'text';
  useDocumentStore.setState({ genericForm });
  render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
  fireEvent.paste(screen.getByPlaceholderText(/Paste tab-separated/), {
    clipboardData: { getData: () => 'decision\tname\r\nyes\t  Recipient B  \r\n' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  expect(useBatchStore.getState().rows[0].values.name).toBe('  Recipient B  ');
  expect(screen.getByRole('textbox', { name: 'Row 1: name' })).toHaveValue('  Recipient B  ');
});


for (const storage of ['number', 'Excel date']) {
  it.each(['identifier', 'decimal', 'text'] as const)(`uses configured %s semantics for a neutral field imported as an ${storage}`, async kind => {
    const genericForm = fixtureInstance();genericForm.definition.rowGroups = {};
    genericForm.definition.fields.name.kind = kind;
    useDocumentStore.setState({ genericForm });
    const { utils } = await import('xlsx');
    const sheet = utils.aoa_to_sheet([['name', 'decision'], [storage === 'number' ? 123 : 46000, 'yes']]);
    if (storage === 'Excel date') sheet.A2.z = 'm/d/yy';
    render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Upload Excel roster (.xlsx)'), {
      target: { files: [rosterFile([], { sheet })] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Map 1 roster row' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
    const risk = storage === 'number' ? /Stored as a number; leading zeros/ : /Stored as an Excel date; the original identifier/;
    if (kind === 'identifier') {
      expect(screen.getByText(risk)).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Row 1: name' })).toHaveAttribute('aria-describedby', 'batch-roster-checks');
    } else {
      expect(screen.queryByText(risk)).not.toBeInTheDocument();
    }
  });
}


it('keeps zero-padded Excel identifier formats without an unwarranted numeric-loss warning', async () => {
  const { utils } = await import('xlsx');
  const sheet = utils.aoa_to_sheet([['name', 'decision'], [123, 'yes']]);sheet.A2.z = '000000';
  render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Upload Excel roster (.xlsx)'), {
    target: { files: [rosterFile([], { sheet })] },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Map 1 roster row' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply Mapping' }));
  const recipient = screen.getByRole('textbox', { name: 'Row 1: name' });
  expect(recipient).toHaveValue('000123');
  expect(recipient).not.toHaveAttribute('aria-describedby');
  expect(screen.queryByText(/Stored as a number|original identifier/)).not.toBeInTheDocument();
});


it('keeps recovered non-string selection cells reviewable instead of crashing the batch panel', async () => {
  const { BATCH_KEY } = await import('@/stores/batchStore');
  const { getSerializedSession } = await import('@/stores/documentStore');
  const form = fixtureInstance();form.definition.rowGroups = {};
  form.definition.pages[0].sha256 = 'a'.repeat(64);
  form.definition.fields.decision.kind = 'multipleChoice';form.answers.decision = ['yes'];
  useDocumentStore.setState({ genericForm: form });
  const source = getSerializedSession();
  localStorage.setItem(BATCH_KEY, JSON.stringify({ state: {
    source, jobId: 'recovered-job', status: 'paused', placeholders: ['name', 'decision'],
    rows: [{ id: 'recovered-row', values: { name: 'Recipient B', decision: 42 }, status: 'pending' }],
  }, version: 0 }));
  await useBatchStore.persist.rehydrate();
  expect(() => render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />)).not.toThrow();
  expect(screen.getByRole('status', { name: 'Form row checks' })).toHaveTextContent('Decision: Enter text in the roster cell');
  expect(screen.getByRole('button', { name: 'Resume remaining' })).toBeDisabled();
});

it('maps repeating row objects, previews normalized answers and blocks overflow without changing source rows', () => {
  const genericForm = fixtureInstance();
  genericForm.definition.pages[0].sha256 = 'a'.repeat(64);
  genericForm.rows.roster = [{ id: 'saved-source', answers: { grade: 'e1' } }];
  useDocumentStore.setState({ genericForm });
  render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'Configured form roster fields' })).toHaveTextContent('at most 3 rows');
  fireEvent.change(screen.getByRole('textbox', { name: 'Row 1: name' }), { target: { value: 'B' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Row 1: decision' }), { target: { value: 'yes' } });
  const input = screen.getByRole('textbox', { name: 'Row 1: roster' });
  fireEvent.change(input, { target: { value: '[{"grade":"E-2","date":"2026-02-28"}]' } });
  const preview = screen.getByLabelText('Row 1: roster reviewed rows');
  expect(preview).toHaveTextContent('Row 1: Grade: E-2 (e2); Date: 2026-02-28');
  expect(input).toHaveAttribute('aria-describedby', preview.id);
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeEnabled();
  fireEvent.change(input, { target: { value: JSON.stringify(Array(4).fill({ grade: 'e1' })) } });
  expect(screen.queryByLabelText('Row 1: roster reviewed rows')).not.toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Form row checks' })).toHaveTextContent('at most 3 roster rows');
  expect(screen.getByRole('button', { name: 'Generate 1 PDF' })).toBeDisabled();
  expect(useDocumentStore.getState().genericForm?.rows.roster).toEqual([{ id: 'saved-source', answers: { grade: 'e1' } }]);
});

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BatchModal } from '@/components/modals/BatchModal';
import { useUIStore } from '@/stores/uiStore';
import { useBatchStore, runBatchJob } from '@/stores/batchStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import * as mapping from '@/lib/configuredFormBatch';
import * as roster from '@/lib/excelRoster';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { runPreparedBatchRow } from '@/services/exports/batchExecution';
import { captureExportFormTemplates } from '@/services/exports/formTemplates';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import type { ReadyExportJob } from '@/lib/preparedExport';
import { createExportArtifact } from '@/lib/exportExecution';

beforeEach(() => {
  useDocumentsStore.getState().newDocument();
  const genericForm = fixtureInstance();
  genericForm.definition.rowGroups = {};
  genericForm.definition.pages[0].sha256 = 'a'.repeat(64);
  useDocumentStore.setState({ documentMode: 'compliant', documentCategory: 'forms', formType: 'fixture', genericForm });
  useUIStore.setState({ batchModalOpen: false });
  useBatchStore.setState({ source: null, jobId: null, title: '', placeholders: [],
    rows: [{ id: 'one', values: { name: 'Recipient B', decision: 'yes' }, status: 'pending' }],
    status: 'idle', recoveryError: '', rowActive: false, review: null, stopRequested: false });
});
afterEach(() => { vi.restoreAllMocks();vi.unstubAllGlobals(); });
function modal() { render(<BatchModal compile={vi.fn()} isEngineReady={false} waitForReady={vi.fn()} />); }

it('defers configured mapping until opening and updates it after a closed-panel edit', async () => {
  const spy = vi.spyOn(mapping, 'configuredBatchMapping');
  modal();
  expect(spy).not.toHaveBeenCalled();
  const form = useDocumentStore.getState().genericForm!;
  act(() => useDocumentStore.setState({ genericForm: { ...form, answers: { ...form.answers, name: 'Typing ordinary form content' } } }));
  expect(spy).not.toHaveBeenCalled();
  act(() => useUIStore.setState({ batchModalOpen: true }));
  expect(screen.getByRole('region', { name: 'Configured form roster fields' })).toHaveTextContent('Name');
  expect(spy).toHaveBeenCalled();
  act(() => useUIStore.setState({ batchModalOpen: false }));
  spy.mockClear();
  const edited = structuredClone(useDocumentStore.getState().genericForm!);
  edited.definition.fields.name.label = 'Updated recipient';
  act(() => useDocumentStore.setState({ genericForm: edited }));
  expect(spy).not.toHaveBeenCalled();
  act(() => useUIStore.setState({ batchModalOpen: true }));
  expect(screen.getByRole('region', { name: 'Configured form roster fields' })).toHaveTextContent('Updated recipient');
});

it('continues and retains a running configured job while its panel is closed', async () => {
  const page = await fixturePage();
  const source = getSerializedSession();
  source.genericForm!.definition.pages[0].sha256 = page.sha256;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(page.bytes))));
  const generate = vi.fn(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
  let finish!: (bytes: Uint8Array) => void;
  const download = vi.fn();
  modal();
  let pending!: Promise<void>;
  await act(async () => { pending = runBatchJob({ source, title: 'Background form batch', placeholders: ['name', 'decision'], generate, download }); });
  await waitFor(() => expect(generate).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: /Batch running/ })).toBeVisible();
  act(() => useUIStore.setState({ batchModalOpen: true }));
  expect(screen.getByRole('region', { name: 'Configured form roster fields' })).toBeVisible();
  act(() => useUIStore.setState({ batchModalOpen: false }));
  await act(async () => { finish(page.bytes);await pending; });
  expect(download).toHaveBeenCalledOnce();
  expect(useBatchStore.getState().status).toBe('complete');
  expect(useBatchStore.getState().rows[0]).toMatchObject({ status: 'success', outputId: expect.any(String) });
});

it('keeps a background row privacy review usable without opening the batch panel', async () => {
  const page = await fixturePage();
  const source = getSerializedSession();
  source.genericForm!.definition.pages[0].sha256 = page.sha256;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(page.bytes))));
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  modal();
  let pending!: Promise<Uint8Array>;
  const renderOutput = vi.fn(async (ready: ReadyExportJob) => createExportArtifact(ready, new Blob([new Uint8Array(page.bytes)], { type: 'application/pdf' })));
  await act(async () => {
    pending = runPreparedBatchRow({ name: 'synthetic@example.test', decision: 'yes' }, {
      source, batchId: 'background-review', rowId: 'one', filename: 'review.pdf', capturedAt: 1,
    }, { resolvePolicy: async () => policy, captureResources: captureExportFormTemplates, render: renderOutput,
      onReview: review => useBatchStore.setState({ review }),
      onActiveChange: rowActive => useBatchStore.setState({ rowActive }),
    });
  });
  expect(await screen.findByRole('dialog', { name: 'Review batch row' })).toBeVisible();
  expect(useUIStore.getState().batchModalOpen).toBe(false);
  expect(renderOutput).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Continue with this row' }));
  await expect(pending).resolves.toEqual(page.bytes);
  expect(renderOutput).toHaveBeenCalledOnce();
  expect(useBatchStore.getState().review).toBeNull();
});


it('defers retained workbook warning review while closed and keeps visible provenance accessible', () => {
  const rows = Array.from({ length: 4999 }, (_, index) => ({
    id: `retained-${index}`, status: 'pending' as const, worksheetRow: index + 2,
    values: { name: '123', decision: 'yes' },
    rosterWarnings: [{
      placeholder: 'name', value: '123',
      message: `Worksheet row ${index + 2}, name: Stored as a number; leading zeros may already be missing.`,
    }],
  }));
  useBatchStore.setState({ source: getSerializedSession(), jobId: 'retained-workbook', rows,
    placeholders: ['name', 'decision', 'a', 'b', 'c'], status: 'paused' });
  const warningReview = vi.spyOn(roster, 'rosterRowWarnings');
  modal();
  expect(warningReview).not.toHaveBeenCalled();
  act(() => useDocumentStore.getState().setField('subject', 'Unrelated edit while the panel is closed'));
  expect(warningReview).not.toHaveBeenCalled();

  // A small retained view is sufficient to check the actual visible consumer.
  act(() => useBatchStore.getState().setRows([rows[0]]));
  act(() => useUIStore.setState({ batchModalOpen: true }));
  expect(warningReview).toHaveBeenCalled();
  expect(screen.getByText(/leading zeros may already be missing/)).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Row 1: name' })).toHaveAttribute('aria-describedby', 'batch-roster-checks');
  expect(document.getElementById('batch-roster-checks')).not.toBeNull();
});

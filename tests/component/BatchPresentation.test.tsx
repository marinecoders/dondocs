import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BatchModal } from '@/components/modals/BatchModal';
import { useUIStore } from '@/stores/uiStore';
import { useBatchStore } from '@/stores/batchStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';

beforeEach(() => {
  useDocumentsStore.getState().newDocument();
  useUIStore.setState({ batchModalOpen: true });
  useBatchStore.setState({ source: null, title: '', placeholders: [], rows: [{ id: 'one', values: {}, status: 'pending' }], status: 'idle', recoveryError: '', stopRequested: false });
});
const open = () => render(<BatchModal compile={vi.fn().mockResolvedValue(null)} isEngineReady={true} />);

it('shows completed saved-job context and downloads without inapplicable setup or resume controls', () => {
  useDocumentStore.getState().setField('subject', 'Saved source');
  useBatchStore.setState({ source: getSerializedSession(), title: 'Saved source', placeholders: ['NAME'], status: 'complete', rows: [{ id: 'one', values: { NAME: 'Sample' }, status: 'success', outputId: 'pdf-one', filename: 'Sample.pdf' }] });
  useDocumentStore.getState().setField('subject', 'Different live draft');
  open();
  expect(screen.getByText('Source: Saved source')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Batch complete · 1/1 generated');
  expect(screen.getByRole('button', { name: 'Download Sample.pdf' })).toBeVisible();
  expect(screen.queryByText('Add Variable to Document')).not.toBeInTheDocument();
  expect(screen.queryByText('Paste Data (Tab-separated)')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Resume remaining' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New batch' })).toBeVisible();
});

it('retains interrupted row errors, retry and pending-row resume', () => {
  useBatchStore.setState({ source: getSerializedSession(), title: 'Interrupted source', placeholders: ['NAME'], status: 'interrupted', rows: [
    { id: 'one', values: { NAME: 'Failed' }, status: 'error', error: 'Generation interrupted' },
    { id: 'two', values: { NAME: 'Pending' }, status: 'pending' },
  ] });
  open();
  expect(screen.getByRole('status')).toHaveTextContent('Interrupted batch · 0/2 generated · 1 failed');
  expect(screen.getByRole('button', { name: 'Retry failed rows' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Resume remaining' })).toBeEnabled();
  expect(screen.getAllByText(/Generation interrupted/).length).toBeGreaterThan(0);
});

it('keeps variable insertion available while setting up a new batch', () => {
  open();
  expect(screen.getByText('Add Variable to Document')).toBeVisible();
});

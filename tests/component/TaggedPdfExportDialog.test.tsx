import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaggedPdfExportDialog } from '@/components/modals/TaggedPdfExportDialog';
import { useDocumentStore } from '@/stores/documentStore';

const original = useDocumentStore.getState().getSnapshot();
beforeEach(() => { useDocumentStore.setState({ docType: 'standard_letter', documentCategory: 'correspondence', formData: { subject: 'Training', from: 'Marine', to: 'Office', date: '16 Nov 26', signatureType: 'none' }, paragraphs: [{ text: 'Training body.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] }); });
afterEach(() => { cleanup(); useDocumentStore.setState(original); });

it('states the real qualification boundary and requests an explicit tagged export', async () => {
  const onExport = vi.fn(); const onOpenChange = vi.fn();
  render(<TaggedPdfExportDialog open onOpenChange={onOpenChange} onExport={onExport} />);
  expect(screen.getByRole('dialog', { name: 'Export tagged PDF' })).toHaveTextContent('native screen-reader qualification and PDF/UA conformance have not been established');
  expect(screen.getByText(/Language: English/)).toBeVisible();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Export tagged PDF' }));
  expect(onOpenChange).toHaveBeenCalledWith(false); expect(onExport).toHaveBeenCalledOnce();
});

it('updates preflight and blocks original PDF attachments without losing the draft', async () => {
  const onExport = vi.fn(); render(<TaggedPdfExportDialog open onOpenChange={vi.fn()} onExport={onExport} />);
  await act(async () => { useDocumentStore.setState({ enclosures: [{ title: 'Original signed PDF' }] }); });
  expect(screen.getByRole('status')).toHaveTextContent('cannot include original PDFs or enclosures');
  expect(screen.getByRole('button', { name: 'Export tagged PDF' })).toBeDisabled();
  expect(useDocumentStore.getState().paragraphs[0].text).toBe('Training body.');
  expect(onExport).not.toHaveBeenCalled();
});

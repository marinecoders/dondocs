import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OfficialSignatureLocation } from '@/components/OfficialSignatureLocation';
import type { OfficialSigningRecord } from '@/lib/officialSigning';

const { read, preview } = vi.hoisted(() => ({ read: vi.fn(async () => new Uint8Array([1])), preview: vi.fn() }));
vi.mock('@/lib/officialSigning', () => ({ officialRevisionBytes: read }));
vi.mock('@/services/forms/nativeCatalog', async original => ({
  ...await original<typeof import('@/services/forms/nativeCatalog')>(),
  identifyOfficialOriginal: async () => 'fixture', officialEdition: () => ({ format: 'acroform' }),
}));
vi.mock('@/components/pdf/pdfConfig', () => ({ HARDENED_PDF_OPTIONS: {} }));
vi.mock('react-pdf', () => ({ pdfjs: { getDocument: () => ({ destroy: vi.fn(), promise: Promise.resolve({
  numPages: 2, getPage: async (number: number) => ({
    getViewport: () => ({ width: 612, height: 792, convertToViewportRectangle: (rect: number[]) => rect }),
    getAnnotations: () => number === 2 ? [{ fieldType: 'Sig', fieldName: 'Reviewer', rect: [1, 2, 30, 40] }] : [],
  }),
}) }) } }));
vi.mock('@/components/SigningPdfPreview', () => ({ SigningPdfPreview: (props: { page: number }) => {
  preview(props.page);
  return <div>PDF page {props.page + 1}</div>;
} }));

it('reads the PDF on request, selects its visible field before pairing, and reuses its layout across pages', async () => {
  const record: OfficialSigningRecord = { id: 'fixture', format: 'dondocs-official-signing-v1', filename: 'fixture.pdf', data: 'AQ==', revisions: [] };
  const onChoice = vi.fn();
  render(<OfficialSignatureLocation record={record} choice="" onChoice={onChoice} paired={false} />);
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Review signature location' }));
  await screen.findByText('PDF page 2');
  await waitFor(() => expect(onChoice).toHaveBeenCalledWith('Reviewer'));
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  await screen.findByText('PDF page 1');
  expect(read).toHaveBeenCalledTimes(1);
});

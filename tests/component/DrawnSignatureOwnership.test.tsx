import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { SignatureSection } from '@/components/editor/SignatureSection';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { renderSignatureDrawing } from '@/lib/signatureDrawing';
import { loadSignatureAsPngBase64 } from '@/lib/signatureImage';
import { persistSignature } from '@/lib/signatureAssets';

vi.mock('@/lib/signatureDrawing', async original => ({ ...await original<typeof import('@/lib/signatureDrawing')>(), renderSignatureDrawing: vi.fn() }));
vi.mock('@/lib/signatureImage', () => ({ loadSignatureAsPngBase64: vi.fn() }));
vi.mock('@/lib/signatureAssets', async original => ({ ...await original<typeof import('@/lib/signatureAssets')>(), persistSignature: vi.fn() }));
vi.mock('@/lib/attachments', async original => ({ ...await original<typeof import('@/lib/attachments')>(), withAttachmentStaging: async (operation: () => Promise<unknown>) => operation() }));
const original = { name: 'existing-signature.png', size: 8, data: 'existing-image' };
beforeEach(() => {
  vi.clearAllMocks();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ docType: 'business_letter', formData: { ...useDocumentStore.getState().formData, signatureType: 'image', signatureImage: original } });
  vi.mocked(renderSignatureDrawing).mockResolvedValue(new File(['png'], 'drawn-signature.png', { type: 'image/png' }));
  vi.mocked(loadSignatureAsPngBase64).mockResolvedValue('drawn-image');
  vi.mocked(persistSignature).mockImplementation(async image => image);
});
async function draw() {
  render(<TooltipProvider><SignatureSection config={DOC_TYPE_CONFIG.business_letter} /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: /^Signature Block/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Draw signature' }));
  screen.getByRole('application', { name: 'Signature drawing area' }).focus();
  await userEvent.keyboard(' {ArrowRight}{ArrowDown}{ArrowRight} ');
}

it('stores drawing through the existing image handler without changing the signature style', async () => {
  await draw();
  await userEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  await waitFor(() => expect(useDocumentStore.getState().formData.signatureImage?.data).toBe('drawn-image'));
  expect(persistSignature).toHaveBeenCalledTimes(1);
  expect(useDocumentStore.getState().formData.signatureType).toBe('image');
});
it('cancels a delayed PNG before the image handler can replace an existing signature', async () => {
  let finish!: (file: File) => void;
  vi.mocked(renderSignatureDrawing).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await draw();
  await userEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => finish(new File(['png'], 'drawn-signature.png', { type: 'image/png' })));
  expect(loadSignatureAsPngBase64).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().formData.signatureImage).toBe(original);
});
it('cancels a delayed persisted asset without replacing the current signature', async () => {
  let finish!: (image: typeof original) => void;
  vi.mocked(persistSignature).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await draw();
  await userEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  await waitFor(() => expect(persistSignature).toHaveBeenCalled());
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => finish({ ...original, data: 'late-image' }));
  expect(useDocumentStore.getState().formData.signatureImage).toBe(original);
});
it('keeps the drawing available for retry after storage failure', async () => {
  vi.mocked(persistSignature).mockRejectedValueOnce(new Error('Storage is full'));
  await draw();
  await userEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not saved');
  expect(useDocumentStore.getState().formData.signatureImage).toBe(original);
  await userEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  await waitFor(() => expect(useDocumentStore.getState().formData.signatureImage?.data).toBe('drawn-image'));
});
it('does not send a pending drawing into a different document', async () => {
  let finish!: (file: File) => void;
  vi.mocked(renderSignatureDrawing).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await draw();
  await userEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  await act(async () => { useDocumentsStore.getState().newDocument(); });
  await act(async () => finish(new File(['png'], 'drawn-signature.png', { type: 'image/png' })));
  expect(loadSignatureAsPngBase64).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
});

it('cancels a drawing when layout changes away and back in one update', async () => {
  await draw();
  await act(async () => {
    useDocumentStore.getState().setDocType('joint_letter');
    useDocumentStore.getState().setDocType('business_letter');
  });
  expect(screen.queryByRole('application', { name: 'Signature drawing area' })).not.toBeInTheDocument();
  expect(loadSignatureAsPngBase64).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().formData.signatureImage).toBe(original);
});

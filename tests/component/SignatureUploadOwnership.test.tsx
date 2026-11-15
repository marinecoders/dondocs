import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignatureSection } from '@/components/editor/SignatureSection';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { loadSignatureAsPngBase64 } from '@/lib/signatureImage';
import { persistSignature } from '@/lib/signatureAssets';

vi.mock('@/lib/signatureImage', () => ({ loadSignatureAsPngBase64: vi.fn() }));
vi.mock('@/lib/signatureAssets', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/signatureAssets')>(), persistSignature: vi.fn() }));
vi.mock('@/lib/attachments', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/attachments')>(), withAttachmentStaging: async (operation: () => Promise<void>) => operation() }));
const initial = useDocumentStore.getState().formData;
beforeEach(() => {
  vi.clearAllMocks();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ docType: 'business_letter', formData: { ...initial, signatureType: 'image', signatureImage: undefined, signatureImageSigner: 'senior' } });
  vi.mocked(loadSignatureAsPngBase64).mockResolvedValue('synthetic-image');
  vi.mocked(persistSignature).mockImplementation(async image => image);
});
afterEach(() => { useDocumentStore.setState({ formData: initial });vi.restoreAllMocks(); });

async function chooseFile() {
  render(<TooltipProvider><SignatureSection config={DOC_TYPE_CONFIG.business_letter} /></TooltipProvider>);
  await userEvent.setup().click(screen.getByRole('button', { name: /^Signature Block/ }));
  fireEvent.change(screen.getByLabelText('Upload signature image'), { target: { files: [new File(['synthetic'], 'business-signer.png', { type: 'image/png' })] } });
}

it.each([false, true])('does not move a pending single-signer upload to a dual-signer layout (return: %s)', async returnToOriginal => {
  let finish!: (value: string) => void;
  vi.mocked(loadSignatureAsPngBase64).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await chooseFile();
  await waitFor(() => expect(loadSignatureAsPngBase64).toHaveBeenCalledTimes(1));
  await act(async () => {
    useDocumentStore.getState().setDocType('joint_letter');
    if (returnToOriginal) useDocumentStore.getState().setDocType('business_letter');
    finish('previous-layout-image');
  });
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
  expect(persistSignature).not.toHaveBeenCalled();
});

it('does not install a persisted single-signer image after the layout changes', async () => {
  let finish!: (value: { name: string; size: number; data: string }) => void;
  vi.mocked(persistSignature).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await chooseFile();
  await waitFor(() => expect(persistSignature).toHaveBeenCalledTimes(1));
  await act(async () => {
    useDocumentStore.getState().setDocType('joint_letter');
    finish({ name: 'business-signer.png', size: 9, data: 'previous-layout-image' });
  });
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
});

it('keeps a pending upload valid through an unrelated text edit', async () => {
  let finish!: (value: string) => void;
  vi.mocked(loadSignatureAsPngBase64).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await chooseFile();
  await waitFor(() => expect(loadSignatureAsPngBase64).toHaveBeenCalledTimes(1));
  await act(async () => {
    useDocumentStore.getState().setField('subject', 'Updated while decoding');
    finish('current-layout-image');
  });
  await waitFor(() => expect(useDocumentStore.getState().formData.signatureImage?.data).toBe('current-layout-image'));
});

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WordSignatureImage } from '@/components/editor/WordSignatureImage';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
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
  useDocumentStore.setState({ docType: 'joint_letter', formData: { ...initial, signatureType: 'none', signatureImage: undefined, signatureImageSigner: undefined } });
  vi.mocked(loadSignatureAsPngBase64).mockResolvedValue('synthetic-base64');
  vi.mocked(persistSignature).mockImplementation(async image => image);
});
afterEach(() => { useDocumentStore.setState({ formData: initial });vi.restoreAllMocks(); });
function chooseFile() {
  fireEvent.change(screen.getByLabelText('Upload Word signature image'), { target: { files: [new File(['synthetic'], 'signature.png', { type: 'image/png' })] } });
}
it('requires an explicit party selection and uploads one retained image', async () => {
  const user = userEvent.setup();
  render(<WordSignatureImage dual />);
  expect(screen.getByLabelText('Signature image signer')).toHaveValue('');
  await user.selectOptions(screen.getByLabelText('Signature image signer'), 'senior');
  chooseFile();
  await waitFor(() => expect(useDocumentStore.getState().formData.signatureType).toBe('image'));
  expect(useDocumentStore.getState().formData.signatureImageSigner).toBe('senior');
  expect(useDocumentStore.getState().formData.signatureImage?.data).toBe('synthetic-base64');
  expect(persistSignature).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Word output only/)).toBeVisible();
});
it('does not install a late upload after signature mode changes', async () => {
  let finish!: (value: string) => void;
  vi.mocked(loadSignatureAsPngBase64).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<WordSignatureImage dual />);
  chooseFile();
  await waitFor(() => expect(loadSignatureAsPngBase64).toHaveBeenCalledTimes(1));
  await act(async () => {
    useDocumentStore.getState().setField('signatureType', 'digital');
    finish('late-result');
  });
  expect(persistSignature).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().formData.signatureType).toBe('digital');
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
});
it('removing an inactive retained image preserves digital signing selection', async () => {
  useDocumentStore.setState({ formData: { ...initial, signatureType: 'digital', signatureImage: { name: 'old.png', size: 1, data: 'old' } } });
  render(<WordSignatureImage dual />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Remove Word signature image' }));
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
  expect(useDocumentStore.getState().formData.signatureType).toBe('digital');
});
it('does not invent a dual-party selector for an information memorandum', () => {
  render(<WordSignatureImage />);
  expect(screen.queryByLabelText('Signature image signer')).not.toBeInTheDocument();
});

it('does not assign an in-flight upload to a newly selected signer', async () => {
  let finish!: (value: string) => void;
  vi.mocked(loadSignatureAsPngBase64).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<WordSignatureImage dual />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Signature image signer'), 'junior');
  chooseFile();
  await waitFor(() => expect(loadSignatureAsPngBase64).toHaveBeenCalledTimes(1));
  await user.selectOptions(screen.getByLabelText('Signature image signer'), 'senior');
  await act(async () => { finish('junior-image'); });
  expect(useDocumentStore.getState().formData.signatureImageSigner).toBe('senior');
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
  expect(persistSignature).not.toHaveBeenCalled();
});

it('does not carry a pending image into another document layout', async () => {
  let finish!: (value: string) => void;
  vi.mocked(loadSignatureAsPngBase64).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<WordSignatureImage dual />);
  chooseFile();
  await waitFor(() => expect(loadSignatureAsPngBase64).toHaveBeenCalledTimes(1));
  await act(async () => {
    useDocumentStore.setState({ docType: 'information_memorandum' });
    finish('old-layout-image');
  });
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
  expect(persistSignature).not.toHaveBeenCalled();
});

it('cancels a pending upload after changing layout away and back', async () => {
  let finish!: (value: string) => void;
  vi.mocked(loadSignatureAsPngBase64).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<WordSignatureImage dual />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Signature image signer'), 'junior');
  chooseFile();
  await waitFor(() => expect(loadSignatureAsPngBase64).toHaveBeenCalledTimes(1));
  await act(async () => {
    useDocumentStore.getState().setDocType('information_memorandum');
    useDocumentStore.getState().setDocType('joint_letter');
    finish('old-layout-image');
  });
  expect(useDocumentStore.getState().docType).toBe('joint_letter');
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
  expect(persistSignature).not.toHaveBeenCalled();
});


it('does not install a persisted upload after changing layout away and back', async () => {
  let finish!: (value: { name: string; size: number; data: string }) => void;
  vi.mocked(persistSignature).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<WordSignatureImage dual />);
  chooseFile();
  await waitFor(() => expect(persistSignature).toHaveBeenCalledTimes(1));
  await act(async () => {
    useDocumentStore.getState().setDocType('information_memorandum');
    useDocumentStore.getState().setDocType('joint_letter');
    finish({ name: 'signature.png', size: 9, data: 'saved-old-layout-image' });
  });
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
});

it('keeps an upload valid while ordinary document text changes', async () => {
  let finish!: (value: string) => void;
  vi.mocked(loadSignatureAsPngBase64).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<WordSignatureImage dual />);
  chooseFile();
  await waitFor(() => expect(loadSignatureAsPngBase64).toHaveBeenCalledTimes(1));
  await act(async () => {
    useDocumentStore.getState().setField('subject', 'Updated during image decoding');
    finish('current-layout-image');
  });
  await waitFor(() => expect(useDocumentStore.getState().formData.signatureImage?.data).toBe('current-layout-image'));
  expect(useDocumentStore.getState().formData.subject).toBe('Updated during image decoding');
});

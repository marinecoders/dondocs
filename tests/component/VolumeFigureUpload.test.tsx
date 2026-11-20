import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VolumeBodySection } from '@/components/editor/VolumeSections';
import { TooltipProvider } from '@/components/ui/tooltip';
import { emptyPublicationVolume } from '@/lib/publicationVolume';
import { prepareFigureUpload } from '@/lib/prepareFigureUpload';
import { persistAttachment } from '@/lib/attachments';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';

vi.mock('@/lib/prepareFigureUpload', () => ({ prepareFigureUpload: vi.fn() }));
vi.mock('@/services/docx/imageAssets', async original => ({ ...await original<typeof import('@/services/docx/imageAssets')>(), inspectRasterImage: vi.fn() }));
vi.mock('@/lib/attachments', async original => ({ ...await original<typeof import('@/lib/attachments')>(), persistAttachment: vi.fn() }));

beforeEach(() => {
  const volume = emptyPublicationVolume();
  useDocumentsStore.setState({ currentId: 'volume-image-owner' });
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState({ docType: 'technical_volume', formData: { volume }, paragraphs: [{ id: 'figure', text: 'Original caption', level: 0, volumeSectionId: volume.chapters[0].sections[0].id, figure: { placement: 'body', altText: '' } }] });
  vi.mocked(persistAttachment).mockResolvedValue({ id: 'normalized', name: 'image.png', size: 3, type: 'image/png' });
});
afterEach(() => vi.clearAllMocks());

it('retains alternative text typed while the selected image is being prepared', async () => {
  let finish!: (value: Awaited<ReturnType<typeof prepareFigureUpload>>) => void;
  vi.mocked(prepareFigureUpload).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<TooltipProvider><VolumeBodySection /></TooltipProvider>);
  fireEvent.change(screen.getByLabelText('Image for Figure 1.1-1'), { target: { files: [new File(['image'], 'image.png', { type: 'image/png' })] } });
  await waitFor(() => expect(prepareFigureUpload).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText('Alternative text for Figure 1.1-1'), { target: { value: 'Alternative text entered during preparation.' } });
  await act(async () => finish({ bytes: new Uint8Array([1, 2, 3]).buffer, width: 80, height: 60, type: 'image/png' }));
  await waitFor(() => expect(useDocumentStore.getState().paragraphs[0].figure?.fileRef?.id).toBe('normalized'));
  expect(useDocumentStore.getState().paragraphs[0].figure?.altText).toBe('Alternative text entered during preparation.');
});

it('keeps the latest image selection when preparation finishes in the reverse order', async () => {
  const finishes: Array<(value: Awaited<ReturnType<typeof prepareFigureUpload>>) => void> = [];
  vi.mocked(prepareFigureUpload).mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
  render(<TooltipProvider><VolumeBodySection /></TooltipProvider>);
  const input = screen.getByLabelText('Image for Figure 1.1-1');
  fireEvent.change(input, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } });
  await waitFor(() => expect(finishes).toHaveLength(1));
  fireEvent.change(input, { target: { files: [new File(['second'], 'second.png', { type: 'image/png' })] } });
  await waitFor(() => expect(finishes).toHaveLength(2));
  await act(async () => finishes[1]({ bytes: new Uint8Array([2]).buffer, width: 80, height: 60, type: 'image/png' }));
  await waitFor(() => expect(useDocumentStore.getState().paragraphs[0].figure?.name).toBe('second.png'));
  await act(async () => finishes[0]({ bytes: new Uint8Array([1]).buffer, width: 80, height: 60, type: 'image/png' }));
  expect(useDocumentStore.getState().paragraphs[0].figure?.name).toBe('second.png');
  expect(persistAttachment).toHaveBeenCalledOnce();
});

it.each(['remove', 'switch'])('does not apply a prepared image after %s changes its owner', async action => {
  let finish!: (value: Awaited<ReturnType<typeof prepareFigureUpload>>) => void;
  vi.mocked(prepareFigureUpload).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<TooltipProvider><VolumeBodySection /></TooltipProvider>);
  fireEvent.change(screen.getByLabelText('Image for Figure 1.1-1'), { target: { files: [new File(['image'], 'image.png', { type: 'image/png' })] } });
  await waitFor(() => expect(prepareFigureUpload).toHaveBeenCalledOnce());
  act(() => {
    if (action === 'remove') useDocumentStore.getState().setVolumeContent(useDocumentStore.getState().formData.volume!, []);
    else useDocumentsStore.setState({ currentId: 'another-document' });
  });
  await act(async () => finish({ bytes: new Uint8Array([1, 2, 3]).buffer, width: 80, height: 60, type: 'image/png' }));
  expect(persistAttachment).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().paragraphs.every(paragraph => !paragraph.figure?.fileRef)).toBe(true);
});

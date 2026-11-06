import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Sl3IllustrationsSection } from '@/components/editor/Sl3Sections';
import { prepareFigureUpload } from '@/lib/prepareFigureUpload';
import { persistAttachment } from '@/lib/attachments';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { sl3Fixture } from '../_helpers/sl3Fixture';

vi.mock('@/lib/prepareFigureUpload', () => ({ prepareFigureUpload: vi.fn() }));
vi.mock('@/lib/attachments', async original => ({ ...await original<typeof import('@/lib/attachments')>(), persistAttachment: vi.fn(), loadAttachment: vi.fn().mockResolvedValue(null), newAttachmentId: () => 'new-id' }));
beforeEach(() => {
  useDocumentsStore.setState({ currentId: 'sl3-photo-owner' });
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState(sl3Fixture());
  useDocumentStore.setState({ paragraphs: [{ referenceId: 'photo', level: 0, text: 'Training adapter', figure: { portionMarking: 'U' } }] });
  const s = useDocumentStore.getState();
  s.setField('sl3', { ...s.formData.sl3!, artwork: [{ figureId: 'photo', lettering: 'none', labels: [] }] });
});
afterEach(() => vi.clearAllMocks());

it('persists prepared pixels and dimensions, preserves the marking and resets lettering review', async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  vi.mocked(prepareFigureUpload).mockResolvedValue({ bytes, width: 900, height: 1600, type: 'image/jpeg' });
  vi.mocked(persistAttachment).mockResolvedValue({ id: 'normalized', name: 'phone.jpg', size: 3, type: 'image/jpeg' });
  render(<Sl3IllustrationsSection />);
  const file = new File(['raw'], 'phone.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText('Choose illustration for Illustration 1 (unassigned)'), { target: { files: [file] } });
  await waitFor(() => expect(useDocumentStore.getState().paragraphs[0].figure?.fileRef?.id).toBe('normalized'));
  expect(persistAttachment).toHaveBeenCalledWith({ name: 'phone.jpg', size: 3, type: 'image/jpeg' }, bytes);
  expect(useDocumentStore.getState().paragraphs[0].figure).toMatchObject({ width: 900, height: 1600, portionMarking: 'U' });
  expect(useDocumentStore.getState().formData.sl3!.artwork).toEqual([]);
  expect(screen.getByLabelText('Illustration 1 (unassigned) lettering review')).toHaveValue('');
});

it('retains the current artwork when photo preparation fails', async () => {
  vi.mocked(prepareFigureUpload).mockRejectedValueOnce(new Error('Cannot read this photo'));
  render(<Sl3IllustrationsSection />);
  fireEvent.change(screen.getByLabelText('Choose illustration for Illustration 1 (unassigned)'), { target: { files: [new File(['bad'], 'bad.jpg')] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot read this photo');
  expect(persistAttachment).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().formData.sl3!.artwork).toHaveLength(1);
});

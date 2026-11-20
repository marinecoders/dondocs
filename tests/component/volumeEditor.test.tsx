import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { VolumeDetailsSection, VolumeOutlineSection, VolumeBodySection } from '@/components/editor/VolumeSections';
import { useDocumentStore } from '@/stores/documentStore';
import { emptyPublicationVolume, orderedVolumeBlocks } from '@/lib/publicationVolume';
import { TooltipProvider } from '@/components/ui/tooltip';

beforeEach(() => {
  const volume = emptyPublicationVolume();
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState({ docType: 'technical_volume', formData: { subject: 'Maintenance guide', volume }, paragraphs: [{ id: 'intro', volumeSectionId: volume.chapters[0].sections[0].id, text: 'Original content', level: 0 }] });
});

it('edits and reorders chapter structure while preserving paragraph identity and content', () => {
  render(<VolumeOutlineSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Add chapter' }));
  fireEvent.change(screen.getByLabelText('Chapter 2 title'), { target: { value: 'Maintenance' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move chapter 2 up' }));
  const store = useDocumentStore.getState();
  expect(store.formData.volume!.chapters.map(node => node.title)).toEqual(['Maintenance', 'Introduction']);
  expect(store.paragraphs[0]).toMatchObject({ id: 'intro', text: 'Original content' });
  expect(orderedVolumeBlocks(store.formData.volume!, store.paragraphs)[0].label).toBe('2.1.1');
});

it('adds body blocks to the selected section rather than changing another section', () => {
  const store = useDocumentStore.getState();
  store.setVolumeContent({ ...store.formData.volume!, appendices: [{ id: 'appendix', title: 'Data', sections: [{ id: 'data', title: 'Limits' }] }] });
  render(<TooltipProvider><VolumeBodySection /></TooltipProvider>);
  fireEvent.change(screen.getByLabelText('Editing section'), { target: { value: 'data' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add volume paragraph' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add volume table' }));
  expect(useDocumentStore.getState().paragraphs).toHaveLength(3);
  expect(useDocumentStore.getState().paragraphs[0].text).toBe('Original content');
  expect(useDocumentStore.getState().paragraphs.slice(1).every(paragraph => paragraph.volumeSectionId === 'data')).toBe(true);
  expect(screen.getByRole('group', { name: 'Table in paragraph 3' })).toBeTruthy();
});

it('initializes a new volume without borrowing signing state or losing existing prose', () => {
  act(() => {
    useDocumentStore.setState({ docType: 'naval_letter', formData: { signatureType: 'digital' }, paragraphs: [{ id: 'retained', text: 'Retain me', level: 0 }] });
    useDocumentStore.getState().setDocType('technical_volume');
  });
  const store = useDocumentStore.getState();
  expect(store.formData.signatureType).toBe('none');
  expect(store.paragraphs[0]).toMatchObject({ id: 'retained', text: 'Retain me', volumeSectionId: store.formData.volume!.chapters[0].sections[0].id });
  render(<VolumeDetailsSection />);
  fireEvent.change(screen.getByLabelText('Volume title'), { target: { value: 'New volume title' } });
  expect(useDocumentStore.getState().formData.subject).toBe('New volume title');
});

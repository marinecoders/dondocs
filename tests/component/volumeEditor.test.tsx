import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { VolumeSupplementSection } from '@/components/editor/VolumeSupplementSections';
import { VolumeDetailsSection, VolumeOutlineSection, VolumeBodySection } from '@/components/editor/VolumeSections';
import { parseSavedSession } from '@/lib/savedSession';
import { publicationExportErrors } from '@/lib/publicationPreflight';
import { loadSharedSession } from '@/stores/documentStore';
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

it('inserts stable cross-references through the actual body controls', () => {
  render(<TooltipProvider><VolumeBodySection /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Insert reference in 1.1.1' }));
  const volume = useDocumentStore.getState().formData.volume!;
  fireEvent.change(screen.getByLabelText('Reference target'), { target: { value: volume.chapters[0].id } });
  fireEvent.click(screen.getByRole('button', { name: 'Insert reference at end' }));
  expect(useDocumentStore.getState().paragraphs[0].text).toBe(`Original content {{VOLREF_${volume.chapters[0].id}}}`);
});

it('edits glossary and change records independently of body text', () => {
  const view = render(<VolumeSupplementSection kind="glossary" />);
  fireEvent.click(screen.getByRole('button', { name: 'Add glossary entry' }));
  fireEvent.change(screen.getByLabelText('Term 1'), { target: { value: 'System' } });
  fireEvent.change(screen.getByLabelText('Definition 1'), { target: { value: 'A connected assembly.' } });
  view.unmount();
  render(<VolumeSupplementSection kind="changes" />);
  fireEvent.click(screen.getByRole('button', { name: 'Add change record' }));
  fireEvent.change(screen.getByLabelText('Change 1 number'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Change 1 date'), { target: { value: '2026-11-20' } });
  fireEvent.change(screen.getByLabelText('Change 1 description'), { target: { value: 'Updated system definition.' } });
  expect(useDocumentStore.getState().formData.volume).toMatchObject({ glossary: [{ term: 'System', definition: 'A connected assembly.' }], changes: [{ number: '1', date: '2026-11-20', description: 'Updated system definition.' }] });
  expect(useDocumentStore.getState().paragraphs[0].text).toBe('Original content');
});

it('bounds mounted editors for a large section and navigates without losing content', () => {
  const store = useDocumentStore.getState();
  const sectionId = store.formData.volume!.chapters[0].sections[0].id;
  store.setVolumeContent(store.formData.volume!, Array.from({ length: 60 }, (_, index) => ({ id: `body-${index}`, volumeSectionId: sectionId, text: `Content ${index + 1}`, level: 0 })));
  render(<TooltipProvider><VolumeBodySection /></TooltipProvider>);
  expect(screen.getAllByRole('textbox', { name: /^Text for / })).toHaveLength(25);
  expect(screen.getByText('Showing 1–25 of 60 blocks')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next blocks' }));
  expect(screen.getByRole('textbox', { name: 'Text for 1.1.26' }).textContent).toBe('Content 26');
  expect(screen.getByText('Showing 26–50 of 60 blocks')).toBeTruthy();
  expect(useDocumentStore.getState().paragraphs).toHaveLength(60);
});

it('lets an imported volume explicitly disable an unsupported embedded signature setting', () => {
  const original = useDocumentStore.getState().getSnapshot();
  const imported = parseSavedSession({ ...original, formData: { ...original.formData, signatureType: 'digital' } });
  loadSharedSession(imported);
  expect(publicationExportErrors(useDocumentStore.getState()).join(' ')).toContain('Select no embedded signature');
  render(<VolumeDetailsSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Use no embedded signature' }));
  expect(useDocumentStore.getState().formData.signatureType).toBe('none');
  expect(useDocumentStore.getState().paragraphs).toEqual(original.paragraphs);
  expect(publicationExportErrors(useDocumentStore.getState())).toEqual([]);
});

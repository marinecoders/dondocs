import { beforeEach, expect, it } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { emptyPublicationVolume, publicationVolumeErrors, resolveVolumeReferences } from '@/lib/publicationVolume';
import type { Paragraph } from '@/types/document';

beforeEach(() => useDocumentStore.getState().resetForm());

it('keeps retained outline targets coherent when copying a correspondence template', () => {
  const volume = emptyPublicationVolume();
  const paragraphs: Paragraph[] = [
    { id: 'original', volumeSectionId: volume.chapters[0].sections[0].id, text: 'Original volume content.', level: 0 },
    { id: 'ordinary', text: 'Continue with {{VOLREF_original}}.', level: 0 },
  ];
  const template = { formData: { subject: 'Copied correspondence', volume }, paragraphs };
  const before = structuredClone(template);
  useDocumentStore.setState({ docType: 'naval_letter', formData: { subject: 'Current letter' } });
  useDocumentStore.getState().loadTemplate(template);
  const copied = useDocumentStore.getState();
  expect(copied.docType).toBe('naval_letter');
  expect(copied.formData.volume!.chapters[0].id).not.toBe(volume.chapters[0].id);
  expect(copied.paragraphs[0].id).not.toBe('original');
  expect(copied.paragraphs[0].volumeSectionId).toBe(copied.formData.volume!.chapters[0].sections[0].id);
  expect(copied.paragraphs[1].volumeSectionId).toBeUndefined();
  expect(resolveVolumeReferences(copied.paragraphs[1].text, copied.formData.volume!, copied.paragraphs)).toBe('Continue with 1.1.1.');
  expect(template).toEqual(before);
  copied.setDocType('technical_volume');
  const activated = useDocumentStore.getState();
  expect(publicationVolumeErrors(activated.formData.volume, activated.paragraphs)).toEqual([]);
  expect(resolveVolumeReferences(activated.paragraphs[1].text, activated.formData.volume!, activated.paragraphs)).toBe('Continue with 1.1.1.');
});

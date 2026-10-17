import { expect, it } from 'vitest';
import { compressedStringify } from '@/lib/compressedStorage';
import { useDocumentStore, type SerializedSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { fixtureInstance } from '../_helpers/formFixture';

it('recovers a generic form from the session when no IndexedDB document exists', async () => {
  const session: SerializedSession = {
    documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: 'fixture',
    formData: {}, references: [], enclosures: [], paragraphs: [], copyTos: [], distributions: [],
    endItems: [], publicationTables: {}, timestamp: 123, genericForm: fixtureInstance(),
  };
  localStorage.setItem('dondocs-document-session', compressedStringify(session));
  expect(await useDocumentsStore.getState().init()).toBe(true);
  expect(useDocumentStore.getState().genericForm).toEqual(session.genericForm);
  const id = useDocumentsStore.getState().currentId!;
  expect(useDocumentsStore.getState().docs[id].session.genericForm).toEqual(session.genericForm);
});

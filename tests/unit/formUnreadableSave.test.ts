import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { idbGetAllDocuments, idbPutDocument, idbSetCurrentId } from '@/lib/documentsDb';
import { getSerializedSessionForShare, useDocumentStore } from '@/stores/documentStore';
import { exportLibrary, useDocumentsStore } from '@/stores/documentsStore';
import { useAlertStore } from '@/stores/alertStore';
import { fixtureInstance } from '../_helpers/formFixture';

it('keeps an unreadable saved form recoverable without attaching later edits to its ID', async () => {
  const instance = fixtureInstance();
  instance.definition.placements[0].page = 99;
  const session = { ...getSerializedSessionForShare(), documentCategory: 'forms' as const, formType: 'fixture', genericForm: instance };
  const meta = { id: 'unreadable', title: 'Saved form', docType: 'form', updatedAt: 123 };
  const record = { id: meta.id, meta, session };
  await idbPutDocument(record);
  await idbSetCurrentId(meta.id);

  expect(await useDocumentsStore.getState().init()).toBe(false);
  expect(useDocumentsStore.getState().currentId).not.toBe(meta.id);
  expect(useAlertStore.getState().current?.title).toBe('Saved document could not be opened');
  useDocumentsStore.getState().markBaseline();
  useDocumentStore.getState().setField('subject', 'ANOTHER LETTER');
  useDocumentsStore.getState().saveCurrent();
  const newId = useDocumentsStore.getState().currentId;
  useDocumentsStore.getState().switchTo(meta.id);
  expect(useDocumentsStore.getState().currentId).toBe(newId);
  expect(useDocumentStore.getState().formData.subject).toBe('ANOTHER LETTER');
  await waitFor(async () => expect((await idbGetAllDocuments())?.find(d => d.id === newId)?.session.formData.subject).toBe('ANOTHER LETTER'));
  expect((await idbGetAllDocuments())?.find(d => d.id === meta.id)).toEqual(record);
  expect(JSON.parse(await exportLibrary()).docs.find((d: { id: string }) => d.id === meta.id)).toEqual(JSON.parse(JSON.stringify(record)));

  // Deleting the current letter must not attach its replacement to a failed load.
  useDocumentsStore.getState().remove(newId!);
  expect(useDocumentsStore.getState().currentId).not.toBe(meta.id);
  useDocumentStore.getState().setField('subject', 'AFTER DELETION');
  useDocumentsStore.getState().saveCurrent();
  await waitFor(async () => expect((await idbGetAllDocuments())?.some(d => d.session.formData.subject === 'AFTER DELETION')).toBe(true));
  expect((await idbGetAllDocuments())?.find(d => d.id === meta.id)).toEqual(record);
});

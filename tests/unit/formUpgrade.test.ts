import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { waitFor } from '@testing-library/react';
import { useDocumentStore, type SerializedSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { FORMS_PERSIST_KEY, useFormStore } from '@/stores/formStore';
import { idbGetAllDocuments, idbPutDocument, idbSetCurrentId } from '@/lib/documentsDb';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { editForm, startForm } from '@/services/forms/documents';
import { fixtureDefinition, fixturePage } from '../_helpers/formFixture';
import { formCache } from '../_helpers/formCache';
import { ensureParagraphIds } from '@/lib/paragraphIdentity';

// Existing main saves have no genericForm member. Keep this fixture independent
// of the new serializer so the upgrade test cannot silently adopt a new format.
const oldLetter: SerializedSession = {
  documentMode: 'compliant', documentCategory: 'correspondence',
  docType: 'naval_letter', formType: 'navmc_10274',
  formData: { subject: 'EXISTING LETTER', ssic: '5216', from: 'Commanding Officer' },
  paragraphs: [{ text: 'Existing body', level: 0 }],
  references: [{ letter: 'a', title: 'Existing reference' }],
  enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {}, timestamp: 123,
};
afterEach(() => vi.unstubAllGlobals());

it('preserves main-format letters and NAVMC drafts through upgrade, form use, and backup', async () => {
  const meta = { id: 'old-letter', title: 'My letter', name: 'My letter', pinned: true, docType: 'naval_letter', updatedAt: 123 };
  await idbPutDocument({ id: meta.id, meta, session: oldLetter });
  await idbSetCurrentId(meta.id);
  localStorage.setItem(FORMS_PERSIST_KEY, JSON.stringify({ version: 0, state: {
    navmc10274: { actionNo: '0007', ssicFileNo: '5216', supplementalInfo: 'Existing AA draft', signatureBlocks: [] },
    navmc11811: { lastName: 'Existing', edipi: '0012345678', remarksText: 'Existing Page 11 draft', signatureBlocks: [] },
    includeCoverPage: true,
  } }));
  await useFormStore.persist.rehydrate();
  expect(await useDocumentsStore.getState().init()).toBe(true);
  useDocumentsStore.getState().syncCurrent();
  const upgradedLetter = { ...oldLetter, paragraphs: ensureParagraphIds(oldLetter.paragraphs) };
  expect(useDocumentsStore.getState().docs[meta.id]).toEqual({ meta, session: upgradedLetter });
  expect(useDocumentStore.getState().paragraphs).toEqual(upgradedLetter.paragraphs);
  expect(useFormStore.getState()).toMatchObject({
    navmc10274: { actionNo: '0007', supplementalInfo: 'Existing AA draft' },
    navmc11811: { edipi: '0012345678', remarksText: 'Existing Page 11 draft' },
    includeCoverPage: true, configFormValues: {}, configFormRows: {},
  });

  const page = await fixturePage(), definition = fixtureDefinition();definition.pages[0].sha256 = page.sha256;
  vi.stubGlobal('crypto', webcrypto);formCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(page.bytes))));
  startForm(definition, false);
  const formId = useDocumentsStore.getState().currentId!;
  editForm(form => { form.answers.name = 'NEW FORM'; });
  const backup = JSON.parse(await buildBackup());
  expect(backup.documents.find((d: { id: string }) => d.id === formId).session.genericForm.answers.name).toBe('NEW FORM');
  expect(backup.documents.find((d: { id: string }) => d.id === meta.id)).toEqual({ id: meta.id, meta, session: upgradedLetter });
  expect(backup.forms.navmc10274.supplementalInfo).toBe('Existing AA draft');
  expect(backup.forms.navmc11811.edipi).toBe('0012345678');
  expect(backup.forms.includeCoverPage).toBe(true);

  useDocumentsStore.getState().switchTo(meta.id);
  useDocumentStore.getState().setField('subject', 'LATEST LETTER EDIT');
  const latest = JSON.parse(await buildBackup());
  expect(latest.documents.find((d: { id: string }) => d.id === meta.id).session.formData.subject).toBe('LATEST LETTER EDIT');
  await waitFor(async () => expect((await idbGetAllDocuments())?.find(d => d.id === meta.id)?.session.formData.subject).toBe('LATEST LETTER EDIT'));
  // Restoring an older library cannot replace a more recent local letter.
  await restoreBackup(JSON.stringify({ kind: 'dondocs-library', version: 1, docs: [{ id: meta.id, meta, session: oldLetter }] }));
  expect(useDocumentsStore.getState().docs[meta.id].session.formData.subject).toBe('LATEST LETTER EDIT');
  expect(useDocumentsStore.getState().docs[meta.id].meta).toMatchObject({ name: 'My letter', pinned: true });
  expect(useDocumentsStore.getState().docs[formId].session.genericForm!.answers.name).toBe('NEW FORM');
});

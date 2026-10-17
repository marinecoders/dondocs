import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { getSerializedSessionForShare, loadSharedSession, useDocumentStore } from '@/stores/documentStore';
import { restoreBuiltInFormView, openSessionAsNew, useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { editForm, startForm } from '@/services/forms/documents';
import { idbPutDocument } from '@/lib/documentsDb';
import * as documentsDb from '@/lib/documentsDb';
import { fixtureDefinition } from '../_helpers/formFixture';

beforeEach(() => {
  vi.restoreAllMocks();
  useDocumentsStore.setState({ docs: {}, currentId: null, baseline: null, hydrated: true });
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState({ documentCategory: 'correspondence', formType: 'navmc_10274' });
});

it('does not let a stale built-in session hint displace a resumed generic document', () => {
  const stale = { ...getSerializedSessionForShare(), documentCategory: 'forms' as const };
  startForm(fixtureDefinition(), false);
  editForm(form => { form.answers.name = 'SAVED GENERIC'; });
  useDocumentsStore.getState().saveCurrent();
  restoreBuiltInFormView(stale);
  expect(useDocumentStore.getState().genericForm?.answers.name).toBe('SAVED GENERIC');
  expect(useDocumentStore.getState().formType).toBe('fixture');
});

it('preserves a generic form when returning to correspondence through a built-in form', () => {
  startForm(fixtureDefinition(), false);
  const formId = useDocumentsStore.getState().currentId!;
  editForm(form => { form.answers.name = 'KEEP FORM'; });
  useDocumentStore.getState().setFormType('navmc_10274');
  useDocumentStore.getState().setDocumentCategory('correspondence');
  useDocumentStore.getState().setField('subject', 'NEW LETTER');
  useDocumentsStore.getState().saveCurrent();
  expect(useDocumentsStore.getState().docs[formId].session.genericForm?.answers.name).toBe('KEEP FORM');
  expect(useDocumentsStore.getState().currentId).not.toBe(formId);
});

it('normalizes old NAVMC backups without mixing in another draft’s missing fields', async () => {
  useFormStore.getState().setIncludeCoverPage(true);
  useFormStore.getState().setNavmc10274Field('from', 'ANOTHER DRAFT');
  await restoreBackup(JSON.stringify({ kind: 'dondocs-backup', version: 2, forms: {
    navmc10274: { actionNo: '0007', supplementalInfo: 'OLD AA' },
    navmc11811: { edipi: '0012345678', remarksText: 'OLD PAGE 11', signatureBlocks: [{ name: 'SIGNER', statement: '', digital: true }] },
  } }));
  expect(useFormStore.getState().navmc10274).toMatchObject({ actionNo: '0007', supplementalInfo: 'OLD AA', from: '', signatureBlocks: [] });
  expect(useFormStore.getState().navmc11811).toMatchObject({ edipi: '0012345678', remarksText: 'OLD PAGE 11', signatureBlocks: [{ name: 'SIGNER', statement: '', style: 'digital' }] });
  expect(useFormStore.getState().includeCoverPage).toBe(true);
  const backup = await buildBackup();
  useFormStore.getState().setIncludeCoverPage(false);
  await restoreBackup(backup);
  expect(useFormStore.getState().includeCoverPage).toBe(true);
});


it('opens a shared or handed-over session separately from the existing letter', () => {
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'EXISTING LETTER');
  useDocumentsStore.getState().saveCurrent();
  const originalId = useDocumentsStore.getState().currentId!;
  useDocumentStore.getState().setField('to', 'LATEST UNSAVED RECIPIENT');
  const incoming = { ...getSerializedSessionForShare(), formData: { subject: 'SHARED LETTER' } };
  openSessionAsNew(incoming);
  expect(useDocumentsStore.getState().currentId).not.toBe(originalId);
  expect(useDocumentsStore.getState().docs[originalId].session.formData).toMatchObject({ subject: 'EXISTING LETTER', to: 'LATEST UNSAVED RECIPIENT' });
  useDocumentStore.getState().setField('subject', 'EDITED SHARED LETTER');
  useDocumentsStore.getState().saveCurrent();
  expect(useDocumentsStore.getState().docs[originalId].session.formData.subject).toBe('EXISTING LETTER');
});


it.each([false, true])('protects pending edits during backup restore (write failure: %s)', async (writeFails) => {
  const session = { ...getSerializedSessionForShare(), formData: { subject: 'OLDER LOCAL' } };
  const meta = { id: 'pending-restore', title: 'Existing letter', docType: 'naval_letter', updatedAt: 100 };
  await idbPutDocument({ id: meta.id, meta, session });
  loadSharedSession(session);
  useDocumentsStore.setState({ docs: { [meta.id]: { meta, session } }, currentId: meta.id, baseline: session });
  useDocumentStore.getState().setField('subject', 'LATEST UNSAVED EDIT');
  if (writeFails) vi.spyOn(documentsDb, 'idbPutDocument').mockResolvedValue(false);
  await restoreBackup(JSON.stringify({ kind: 'dondocs-library', version: 1, docs: [{
    id: meta.id, meta: { ...meta, updatedAt: 101 }, session: { ...session, formData: { subject: 'OLDER BACKUP' } },
  }] }));
  expect(useDocumentsStore.getState().docs[meta.id].session.formData.subject).toBe('LATEST UNSAVED EDIT');
});

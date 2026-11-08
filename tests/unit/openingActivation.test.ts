import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSerializedSession, rehydrateEnclosureFiles, persistUnsavedEnclosures, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, captureDocumentTarget, isCurrentDocumentScope, changeDocumentHistory, resetCurrentDocument, flushDocumentWrites, openSessionAsNew, openExistingDocument, openReviewedDocument, openFormInstance, newCorrespondenceDocument, prepareDocument, openPreparedDocument, useDocumentsStore } from '@/stores/documentsStore';
import { loadAttachment, persistAttachment, attachmentSweepCheckpoint } from '@/lib/attachments';
import { useHistoryStore } from '@/stores/historyStore';
import { useFormStore } from '@/stores/formStore';
import { useProfileStore } from '@/stores/profileStore';
import { parseSavedSession } from '@/lib/savedSession';
import * as formRegistry from '@/services/formRegistry';
import { WRITE_JOURNAL_KEY } from '@/lib/documentWrites';
import * as documentsDb from '@/lib/documentsDb';
import { fixtureInstance, fixtureDefinition } from '../_helpers/formFixture';
import type { FileRef } from '@/types/document';
import { sweepOrphanedAttachments } from '@/lib/attachmentGc';

vi.mock('@/lib/attachments', async original => { const actual = await original<typeof import('@/lib/attachments')>(); return { ...actual, loadAttachment: vi.fn(), persistAttachment: vi.fn(actual.persistAttachment) }; });
const load = vi.mocked(loadAttachment);
function deferred<T = ArrayBuffer | null>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  load.mockReset().mockResolvedValue(null);
  const actual = await vi.importActual<typeof import('@/lib/attachments')>('@/lib/attachments');
  vi.mocked(persistAttachment).mockReset().mockImplementation(actual.persistAttachment);
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Outgoing draft');
});
afterEach(async () => { await flushDocumentWrites(); vi.clearAllTimers(); vi.useRealTimers(); });

it('does not let the first A hydration fill a later activation of A', async () => {
  const first = deferred(); const later = deferred();
  const ref = { id: 'same-file', name: 'first.pdf', size: 1, type: 'application/pdf' };
  useDocumentStore.setState({ enclosures: [{ title: 'Attachment', fileRef: ref }] });
  useDocumentsStore.getState().saveCurrent();
  const a = useDocumentsStore.getState().currentId!;
  load.mockReturnValueOnce(first.promise).mockReturnValueOnce(later.promise);
  const scope = captureDocumentScope();
  const hydration = rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  useDocumentsStore.getState().newDocument();
  useDocumentsStore.getState().switchTo(a);
  first.resolve(new Uint8Array([1]).buffer);
  await hydration;
  expect(useDocumentStore.getState().enclosures[0].file).toBeUndefined();
  later.resolve(new Uint8Array([2]).buffer);
  await Promise.resolve();
});

it('does not let an outgoing hydration fill a different document sharing its reference', async () => {
  const first = deferred(); const second = deferred();
  const ref = { id: 'shared-file', name: 'first.pdf', size: 1, type: 'application/pdf' };
  useDocumentStore.setState({ enclosures: [{ title: 'Attachment', fileRef: ref }] });
  const incoming = getSerializedSession();
  load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const scope = captureDocumentScope();
  const hydration = rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  openSessionAsNew(incoming);
  first.resolve(new Uint8Array([1]).buffer);
  await hydration;
  expect(useDocumentStore.getState().enclosures[0].file).toBeUndefined();
  second.resolve(new Uint8Array([2]).buffer);
  await Promise.resolve();
});

it('rejects invalid external input before changing identity, content or history', () => {
  const before = useDocumentStore.getState();
  const history = useHistoryStore.getState();
  const id = useDocumentsStore.getState().currentId;
  const epoch = useDocumentsStore.getState().activationEpoch;
  // External readers have no TypeScript guarantee at runtime.
  const incoming = { ...getSerializedSession(), paragraphs: 'invalid' };
  try {
    openSessionAsNew(incoming);
  } catch { /* Older adapters throw after attempting installation. */ }
  expect(useDocumentsStore.getState().currentId).toBe(id);
  expect(useDocumentsStore.getState().activationEpoch).toBe(epoch);
  expect(useDocumentStore.getState().paragraphs).toBe(before.paragraphs);
  expect(useHistoryStore.getState().currentSnapshot).toBe(history.currentSnapshot);
});

it('rejects a malformed saved record before advancing the outgoing activation', () => {
  const registry = useDocumentsStore.getState();
  const id = registry.currentId;
  const epoch = registry.activationEpoch;
  const history = useHistoryStore.getState();
  const forms = useFormStore.getState();
  useDocumentsStore.setState({ docs: { ...registry.docs, broken: {
    meta: { id: 'broken', title: 'Broken', updatedAt: 1, docType: 'form' },
    // @ts-expect-error malformed stored data can arrive from older backups
    session: { ...getSerializedSession(), genericForm: {} },
  } } });
  expect(openExistingDocument('broken')).toBe('invalid');
  expect(useDocumentsStore.getState().currentId).toBe(id);
  expect(useDocumentsStore.getState().activationEpoch).toBe(epoch);
  expect(useHistoryStore.getState().currentSnapshot).toBe(history.currentSnapshot);
  expect(useFormStore.getState().navmc10274).toBe(forms.navmc10274);
  expect(isCurrentDocumentScope(history.owner)).toBe(true);
});

it('rolls back identity, form buffers and Undo after an unexpected install failure', async () => {
  useDocumentStore.getState().setField('subject', 'Earlier outgoing');
  await vi.advanceTimersByTimeAsync(500);
  useDocumentStore.getState().setField('subject', 'Latest outgoing');
  await vi.advanceTimersByTimeAsync(500);
  const id = useDocumentsStore.getState().currentId!;
  const before = useDocumentStore.getState().getSnapshot();
  const forms = useFormStore.getState();
  const history = useHistoryStore.getState();
  const prepared = prepareDocument({ ...getSerializedSession(), documentCategory: 'forms', formType: 'navmc_10274', forms: { navmc10274: { natureOfAction: 'Incoming form' } } });
  const set = vi.spyOn(useDocumentStore, 'setState').mockImplementationOnce(() => { throw new Error('Install failed'); });
  try { expect(openPreparedDocument(prepared, captureDocumentTarget())).toBe('invalid'); }
  finally { set.mockRestore(); }
  expect(useDocumentsStore.getState().currentId).toBe(id);
  expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
  expect(useFormStore.getState().navmc10274).toBe(forms.navmc10274);
  expect(useFormStore.getState().includeCoverPage).toBe(forms.includeCoverPage);
  expect(useHistoryStore.getState().past.map(entry => entry.formData.subject)).toEqual(history.past.map(entry => entry.formData.subject));
  expect(useHistoryStore.getState().future.map(entry => entry.formData.subject)).toEqual(history.future.map(entry => entry.formData.subject));
  expect(isCurrentDocumentScope(useHistoryStore.getState().owner)).toBe(true);
  await flushDocumentWrites();
  expect((await documentsDb.idbGetAllDocuments())!.find(record => record.id === id)!.session.formData.subject).toBe('Latest outgoing');
  expect(Object.values(useDocumentsStore.getState().docs).some(entry => entry.session.forms?.navmc10274?.natureOfAction === 'Incoming form')).toBe(false);
});

it('preserves external signatures when a different profile is selected', () => {
  const image = { name: 'recipient.png', size: 1, data: 'recipient-signature' };
  useProfileStore.setState({ selectedProfile: 'Recipient', profiles: { Recipient: {
    unitLine1: 'Recipient unit', unitLine2: '', unitAddress: '', ssic: '1000', from: 'Recipient',
    sigFirst: 'Recipient', sigMiddle: '', sigLast: 'Signer', sigRank: '', sigTitle: '', signatureImage: image,
  } } });
  const incoming = { ...getSerializedSession(), formData: { subject: 'Received letter', sigFirst: 'Sender' } };
  expect(openSessionAsNew(incoming)).toBe('applied');
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
  expect(useDocumentStore.getState().formData.sigFirst).toBe('Sender');
  expect(openFormInstance(fixtureInstance())).toBe('applied');
  expect(useDocumentStore.getState().formData).toEqual({});
});

it('preserves local references and signature images in saved-record decoding', () => {
  const ref = { id: 'local-file', name: 'local.pdf', size: 1, type: 'application/pdf' };
  const session = { ...getSerializedSession(), formData: { signatureImage: { name: 'sign.png', size: 1, data: 'signature' }, basicLetterFileRef: ref }, enclosures: [{ title: 'Attachment', fileRef: ref }], paragraphs: [{ text: 'Figure', level: 0, figure: { fileRef: ref } }] };
  const parsed = parseSavedSession(session);
  expect(parsed.formData).toEqual(session.formData);
  expect(parsed.enclosures[0].fileRef).toEqual(ref);
  expect(parsed.paragraphs[0].figure!.fileRef).toEqual(ref);
  const form = parseSavedSession({ ...session, documentCategory: 'forms', formType: 'navmc_10274', forms: { navmc10274: { signatureBlocks: [{ name: 'Signer', statement: '', style: 'image', image: 'saved-image' }] } } });
  expect(form.forms!.navmc10274!.signatureBlocks[0].image).toBe('saved-image');
});

it('seeds one complete history state for an external open', () => {
  let seeds = 0;
  const unsubscribe = useHistoryStore.subscribe(state => { if (state.currentSnapshot) seeds++; });
  try {
    const instance = fixtureInstance(); instance.rows.roster = [{ id: 'one', answers: { grade: 'e1' } }];
    expect(openFormInstance(instance)).toBe('applied');
    expect(seeds).toBe(1);
    expect(useHistoryStore.getState().currentSnapshot!.genericForm!.rows).toEqual(instance.rows);
    expect(useHistoryStore.getState().past).toEqual([]);
  } finally { unsubscribe(); }
});

it.each(['edit', 'navigate', 'reactivate'] as const)('cancels staged opening after %s and keeps the reviewed input reusable', async action => {
  const actual = await vi.importActual<typeof import('@/lib/attachments')>('@/lib/attachments');
  const barrier = deferred<void>();
  let stored: FileRef | undefined;
  vi.mocked(persistAttachment).mockImplementationOnce(async (...args) => {
    await barrier.promise;
    stored = await actual.persistAttachment(...args);
    return stored;
  });
  const file = { name: 'original.pdf', size: 1, data: new Uint8Array([7]).buffer };
  const reviewed = { session: { ...getSerializedSession(), formData: { subject: 'Reviewed import' }, enclosures: [{ title: 'Upload' }] }, files: [file], figures: [] };
  const a = useDocumentsStore.getState().currentId!;
  useDocumentsStore.getState().saveCurrent();
  const opening = openReviewedDocument(reviewed, captureDocumentTarget());
  if (action === 'edit') useDocumentStore.getState().setField('subject', 'Intervening edit');
  else {
    useDocumentsStore.getState().newDocument();
    if (action === 'reactivate') useDocumentsStore.getState().switchTo(a);
  }
  const currentId = useDocumentsStore.getState().currentId;
  const current = useDocumentStore.getState().getSnapshot();
  barrier.resolve();
  expect(await opening).toBe('stale');
  expect(useDocumentsStore.getState().currentId).toBe(currentId);
  expect(useDocumentStore.getState().getSnapshot()).toEqual(current);
  expect(new Uint8Array((await actual.loadAttachment(stored!.id))!)[0]).toBe(7);
  expect(reviewed.files[0].name).toBe('original.pdf');
  expect(await openReviewedDocument(reviewed, captureDocumentTarget())).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('Reviewed import');
  expect(useDocumentStore.getState().enclosures[0].file!.data).not.toBe(file.data);
});

it('keeps captured enclosure names when duplicate references are reordered during hydration', async () => {
  const pending = deferred();
  load.mockReturnValueOnce(pending.promise);
  const ref = { id: 'duplicate-bytes', name: 'first.pdf', size: 1, type: 'application/pdf' };
  useDocumentStore.setState({ enclosures: [{ title: 'First', fileRef: ref }, { title: 'Second', fileRef: { ...ref, name: 'second.pdf' } }] });
  const scope = captureDocumentScope();
  const hydration = rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  useDocumentStore.getState().reorderEnclosures(0, 1);
  pending.resolve(new Uint8Array([1]).buffer);
  await hydration;
  expect(useDocumentStore.getState().enclosures.map(enclosure => enclosure.file!.name)).toEqual(['second.pdf', 'first.pdf']);
  expect(load).toHaveBeenCalledTimes(1);
});

it('does not stamp a late persisted file into another activation using the same live bytes', async () => {
  const pending = deferred<FileRef>();
  vi.mocked(persistAttachment).mockReturnValueOnce(pending.promise);
  const file = { name: 'same.pdf', size: 1, data: new Uint8Array([1]).buffer };
  useDocumentStore.setState({ enclosures: [{ title: 'A', file }] });
  const scope = captureDocumentScope();
  const persistence = persistUnsavedEnclosures(() => isCurrentDocumentScope(scope));
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ enclosures: [{ title: 'B', file }] });
  pending.resolve({ id: 'old-result', name: file.name, size: file.size, type: '' });
  await persistence;
  expect(useDocumentStore.getState().enclosures[0].fileRef).toBeUndefined();
});

it('retains failed outgoing writes under their original ID when an import opens', async () => {
  const documents = useDocumentsStore.getState();
  documents.saveCurrent();
  await flushDocumentWrites();
  const a = useDocumentsStore.getState().currentId!;
  useDocumentStore.getState().setField('subject', 'Latest unsaved outgoing');
  const actualWrite = documentsDb.idbWriteDocument;
  const write = vi.spyOn(documentsDb, 'idbWriteDocument').mockImplementation((before, after, ...rest) => after.id === a ? Promise.resolve('failed') : actualWrite(before, after, ...rest));
  try {
    expect(openSessionAsNew({ ...getSerializedSession(), formData: { subject: 'Incoming draft' } })).toBe('applied');
    const b = useDocumentsStore.getState().currentId!;
    await expect(flushDocumentWrites()).rejects.toThrow();
    expect(useDocumentsStore.getState().docs[a].session.formData.subject).toBe('Latest unsaved outgoing');
    expect(sessionStorage.getItem(WRITE_JOURNAL_KEY)).toContain('Latest unsaved outgoing');
    const stored = await documentsDb.idbGetAllDocuments();
    expect(stored!.find(record => record.id === a)!.session.formData.subject).toBe('Outgoing draft');
    expect(stored!.find(record => record.id === b)!.session.formData.subject).toBe('Incoming draft');
    documents.switchTo(a);
    expect(useDocumentStore.getState().formData.subject).toBe('Latest unsaved outgoing');
  } finally { write.mockRestore(); }
});

it('rejects copied scope and prepared-token lookalikes at runtime', () => {
  const scope = captureDocumentScope()!;
  expect(Reflect.apply(isCurrentDocumentScope, null, [{ ...scope }])).toBe(false);
  const currentId = useDocumentsStore.getState().currentId;
  expect(Reflect.apply(openPreparedDocument, null, [{}, captureDocumentTarget()])).toBe('invalid');
  expect(useDocumentsStore.getState().currentId).toBe(currentId);
});

it('retains sparse historical saved-record defaults while rejecting malformed collections', () => {
  const sparse = parseSavedSession({ docType: 'naval_letter', formData: { subject: 'Sparse draft' } });
  expect(sparse.documentMode).toBe('compliant');
  expect(sparse.documentCategory).toBe('correspondence');
  expect(sparse.paragraphs).toEqual([]);
  expect(sparse.references).toEqual([]);
  expect(sparse.enclosures).toEqual([]);
  expect(sparse.copyTos).toEqual([]);
  expect(parseSavedSession({ docType: 'naval_letter' }).formData).toEqual({});
  expect(() => parseSavedSession({ docType: 'naval_letter', references: 'invalid' })).toThrow();
});

it('prepares a generic form before creating exactly one new document', async () => {
  const definition = fixtureDefinition();
  const pending = deferred<typeof definition | null>();
  const resolve = vi.spyOn(formRegistry, 'configForFormType').mockReturnValueOnce(pending.promise);
  const a = useDocumentsStore.getState().currentId!;
  try {
    useDocumentsStore.getState().newDocument(definition.formId);
    expect(useDocumentsStore.getState().currentId).toBe(a);
    pending.resolve(definition);
    await pending.promise;
    const b = useDocumentsStore.getState().currentId!;
    expect(b).not.toBe(a);
    expect(Object.keys(useDocumentsStore.getState().docs)).toHaveLength(2);
    expect(useDocumentStore.getState().genericForm!.definition.formId).toBe(definition.formId);
    expect(useHistoryStore.getState().currentSnapshot!.genericForm!.definition.formId).toBe(definition.formId);
    await flushDocumentWrites();
    const stored = await documentsDb.idbGetAllDocuments();
    expect(stored!.find(record => record.id === a)!.session.formData.subject).toBe('Outgoing draft');
    expect(stored!.find(record => record.id === b)!.session.genericForm!.definition.formId).toBe(definition.formId);
  } finally { resolve.mockRestore(); }
});

it('cancels a generic-form open when the outgoing document is edited during preparation', async () => {
  const definition = fixtureDefinition();
  const pending = deferred<typeof definition | null>();
  const resolve = vi.spyOn(formRegistry, 'configForFormType').mockReturnValueOnce(pending.promise);
  const a = useDocumentsStore.getState().currentId!;
  try {
    useDocumentsStore.getState().newDocument(definition.formId);
    useDocumentStore.getState().setField('subject', 'Edited while form loads');
    pending.resolve(definition);
    await pending.promise;
    expect(useDocumentsStore.getState().currentId).toBe(a);
    expect(useDocumentStore.getState().formData.subject).toBe('Edited while form loads');
    expect(useDocumentStore.getState().genericForm).toBeUndefined();
  } finally { resolve.mockRestore(); }
});

it('keeps the latest generic-form opening request when preparation finishes out of order', async () => {
  const first = fixtureDefinition(); const second = { ...fixtureDefinition(), formId: 'fixture-two' };
  const older = deferred<typeof first | null>(); const newer = deferred<typeof second | null>();
  const resolve = vi.spyOn(formRegistry, 'configForFormType').mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const a = useDocumentsStore.getState().currentId!;
  try {
    useDocumentsStore.getState().newDocument(first.formId);
    useDocumentsStore.getState().newDocument(second.formId);
    older.resolve(first);
    await older.promise;
    expect(useDocumentsStore.getState().currentId).toBe(a);
    newer.resolve(second);
    await newer.promise;
    expect(useDocumentStore.getState().genericForm!.definition.formId).toBe(second.formId);
  } finally { resolve.mockRestore(); }
});

it.each(['kind', 'document'] as const)('cancels a pending form open when navigation returns to the current %s', async navigation => {
  const definition = fixtureDefinition();
  const pending = deferred<typeof definition | null>();
  const resolve = vi.spyOn(formRegistry, 'configForFormType').mockReturnValueOnce(pending.promise);
  const documents = useDocumentsStore.getState();
  const id = documents.currentId!;
  documents.saveCurrent();
  try {
    documents.newDocument(definition.formId);
    if (navigation === 'kind') documents.selectKind('correspondence');
    else documents.switchTo(id);
    pending.resolve(definition);
    await pending.promise;
    expect(useDocumentsStore.getState().currentId).toBe(id);
    expect(useDocumentStore.getState().documentCategory).toBe('correspondence');
    expect(useDocumentStore.getState().genericForm).toBeUndefined();
  } finally { resolve.mockRestore(); }
});

it('seeds a new correspondence shortcut after its intended document type is installed', () => {
  const outgoing = useDocumentsStore.getState().currentId!;
  expect(newCorrespondenceDocument('mfr')).toBe('applied');
  const current = useDocumentsStore.getState().currentId!;
  expect(current).not.toBe(outgoing);
  expect(useHistoryStore.getState().currentSnapshot!.docType).toBe('mfr');
  expect(useHistoryStore.getState().past).toEqual([]);
  expect(useDocumentsStore.getState().docs[current]).toBeUndefined();
  expect(useDocumentsStore.getState().docs[outgoing].session.formData.subject).toBe('Outgoing draft');
});

it('keeps correspondence Reset undoable while invalidating its previous activation', () => {
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setDocType('business_letter');
  useDocumentStore.getState().setField('subject', 'Latest user text before Reset');
  const before = useDocumentStore.getState().getSnapshot();
  const id = useDocumentsStore.getState().currentId;
  const oldScope = captureDocumentScope();
  const oldTarget = captureDocumentTarget();
  expect(resetCurrentDocument()).toBe('applied');
  const sample = useDocumentStore.getState().getSnapshot();
  expect(sample.docType).toBe('naval_letter');
  expect(useDocumentsStore.getState().currentId).toBe(id);
  expect(isCurrentDocumentScope(oldScope)).toBe(false);
  expect(openPreparedDocument(prepareDocument(getSerializedSession()), oldTarget)).toBe('stale');
  const scope = captureDocumentScope();
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  expect(useDocumentStore.getState().getSnapshot()).toEqual(sample);
  expect(useHistoryStore.getState().past.every(entry => entry.formData.subject !== 'Outgoing draft')).toBe(true);
});

it('cancels a staged draft open when correspondence is reset', async () => {
  const actual = await vi.importActual<typeof import('@/lib/attachments')>('@/lib/attachments');
  const barrier = deferred<void>();
  vi.mocked(persistAttachment).mockImplementationOnce(async (...args) => {
    await barrier.promise;
    return actual.persistAttachment(...args);
  });
  const file = { name: 'pending.pdf', size: 1, data: new Uint8Array([7]).buffer };
  const opening = openReviewedDocument({
    session: { ...getSerializedSession(), formData: { subject: 'Older pending import' }, enclosures: [{ title: 'Pending' }] },
    files: [file], figures: [],
  }, captureDocumentTarget());
  expect(resetCurrentDocument()).toBe('applied');
  const sample = useDocumentStore.getState().getSnapshot();
  barrier.resolve();
  expect(await opening).toBe('stale');
  expect(useDocumentStore.getState().getSnapshot()).toEqual(sample);
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('Outgoing draft');
});

it('rejects malformed scalar fields before a prepared open can mutate the editor', () => {
  const id = useDocumentsStore.getState().currentId;
  const epoch = useDocumentsStore.getState().activationEpoch;
  const content = useDocumentStore.getState().getSnapshot();
  const history = useHistoryStore.getState().currentSnapshot;
  expect(openSessionAsNew({ ...getSerializedSession(), formData: { subject: ['invalid'] } })).toBe('invalid');
  expect(useDocumentsStore.getState().currentId).toBe(id);
  expect(useDocumentsStore.getState().activationEpoch).toBe(epoch);
  expect(useDocumentStore.getState().getSnapshot()).toEqual(content);
  expect(useHistoryStore.getState().currentSnapshot).toBe(history);
});

it('rejects malformed built-in form fields without replacing the current document', () => {
  const id = useDocumentsStore.getState().currentId;
  const epoch = useDocumentsStore.getState().activationEpoch;
  expect(openSessionAsNew({ ...getSerializedSession(), documentCategory: 'forms', formType: 'navmc_10274', forms: { navmc10274: { natureOfAction: [] } } })).toBe('invalid');
  expect(useDocumentsStore.getState().currentId).toBe(id);
  expect(useDocumentsStore.getState().activationEpoch).toBe(epoch);
  expect(useDocumentStore.getState().formData.subject).toBe('Outgoing draft');
});

it('owns file metadata before asynchronous hydration reads', async () => {
  const pending = deferred();
  const ref = { id: 'owned-metadata', name: 'captured.pdf', size: 1, type: 'application/pdf' };
  useDocumentStore.setState({ enclosures: [{ title: 'Attachment', fileRef: ref }] });
  load.mockReturnValueOnce(pending.promise);
  const scope = captureDocumentScope();
  const hydration = rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  ref.name = 'later alias mutation.pdf';
  pending.resolve(new Uint8Array([1]).buffer);
  await hydration;
  expect(useDocumentStore.getState().enclosures[0].file!.name).toBe('captured.pdf');
});

it.each(['install', 'cancel', 'fail'] as const)('protects staged files until import %s finishes', async outcome => {
  const actual = await vi.importActual<typeof import('@/lib/attachments')>('@/lib/attachments');
  const entered = deferred<void>(); const release = deferred<void>();
  const refs: FileRef[] = [];
  vi.mocked(persistAttachment)
    .mockImplementationOnce(async (...args) => {
      const ref = await actual.persistAttachment(...args); refs.push(ref); return ref;
    })
    .mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise;
      if (outcome === 'fail') throw new Error('Attachment write failed');
      const ref = await actual.persistAttachment(...args); refs.push(ref); return ref;
    });
  const file = (value: number) => ({ name: `${value}.pdf`, size: 1, data: new Uint8Array([value]).buffer });
  const opening = openReviewedDocument({ session: { ...getSerializedSession(), enclosures: [{ title: 'First' }, { title: 'Second' }] }, files: [file(1), file(2)], figures: [] }, captureDocumentTarget());
  await entered.promise;
  try {
    expect(await sweepOrphanedAttachments()).toBeNull();
    expect(await actual.loadAttachment(refs[0].id)).not.toBeNull();
    if (outcome === 'cancel') useDocumentStore.getState().setField('subject', 'Newer edit');
  } finally { release.resolve(); }
  if (outcome === 'fail') await expect(opening).rejects.toThrow('Attachment write failed');
  else expect(await opening).toBe(outcome === 'install' ? 'applied' : 'stale');
  await flushDocumentWrites();
  expect(attachmentSweepCheckpoint()).not.toBeNull();
  await sweepOrphanedAttachments();
  for (const ref of refs) {
    expect(await actual.loadAttachment(ref.id)).not.toBeNull();
  }
});

it('keeps the reviewed draft and current activation intact when attachment storage refuses a write', async () => {
  const id = useDocumentsStore.getState().currentId;
  const scope = captureDocumentScope();
  const file = { name: 'quota.pdf', size: 1, data: new Uint8Array([7]).buffer };
  const reviewed = { session: { ...getSerializedSession(), enclosures: [{ title: 'Upload' }] }, files: [file], figures: [] };
  const write = vi.spyOn(documentsDb, 'idbPutAttachment').mockResolvedValueOnce(false);
  try {
    await expect(openReviewedDocument(reviewed, captureDocumentTarget())).rejects.toThrow('Could not save quota.pdf');
    expect(useDocumentsStore.getState().currentId).toBe(id);
    expect(isCurrentDocumentScope(scope)).toBe(true);
    expect(useDocumentStore.getState().enclosures).toEqual([]);
    expect(reviewed.files[0]).toBe(file);
  } finally { write.mockRestore(); }
  expect(attachmentSweepCheckpoint()).not.toBeNull();
  await sweepOrphanedAttachments();
});

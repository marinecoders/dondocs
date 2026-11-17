import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { parseLetterFile } from '@/lib/importLetter';
import { openWordImport } from '@/lib/importWord';
import { loadAttachment } from '@/lib/attachments';
import { getSerializedSession, suspendSessionSaves, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, captureDocumentTarget, changeDocumentHistory, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { idbDeleteAttachment, idbGetAllAttachments, idbGetAllDocuments, idbInstallDocumentWithAssets, idbReadReviewSuggestions } from '@/lib/documentsDb';
import { buildReviewCopy } from '@/lib/reviewRoundActions';
import { listReviewRounds } from '@/lib/reviewRounds';
import { decideReviewSuggestion, loadReviewSuggestionWorkspace } from '@/lib/reviewSuggestionActions';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { getExportDeploymentPolicy } from '@/config/classification';
import { reconcileReviewText } from '@/lib/reconcileReviewText';
import { prepareWordTrackedReview } from '@/lib/wordTrackedChanges';
import { copyWordImport } from '@/services/docx/import/readWord';
import { useUIStore } from '@/stores/uiStore';

installWordXmlDom();
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
async function clearDb() {
  await flushDocumentWrites();
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  if (db.objectStoreNames.length) await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([...db.objectStoreNames], 'readwrite');
    for (const name of db.objectStoreNames) transaction.objectStore(name).clear();
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
beforeEach(async () => {
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy);
  suspendSessionSaves(); await clearDb();
  useUIStore.setState({ storageHealth: 'ok' });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null, lastKindIds: {} });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Previous work');
  useDocumentsStore.getState().saveCurrent(); await flushDocumentWrites();
});
afterEach(async () => { await flushDocumentWrites(); });

async function imported() {
  const body = `${wordParagraph('Subj: TRACKED SOURCE')}<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${wordRun('Purpose')}</w:p>`
    + `<w:p>${wordRun('1. Before ')}<w:del w:id="1" w:author="Word Chief">${wordRun('old', '<w:b/>').replaceAll('w:t', 'w:delText')}</w:del><w:ins w:id="2" w:author="Word Chief">${wordRun('new', '<w:b/>')}</w:ins>${wordRun(' after.')}</w:p>`
    + wordParagraph('2. Independent tail.');
  const bytes = await wordImportFixture(body), parsed = await parseLetterFile(new File([bytes.buffer as ArrayBuffer], 'tracked-source.docx'));
  const previous = useDocumentsStore.getState().currentId!;
  expect(await openWordImport(parsed, 'naval_letter')).toBe('applied'); await flushDocumentWrites();
  const id = useDocumentsStore.getState().currentId!, round = (await listReviewRounds()).find(item => item.ownerDocumentId === id)!;
  expect(round).toBeDefined();
  return { bytes, parsed, previous, id, round };
}

describe('Word tracked text through native review persistence', () => {
  it('atomically retains original, baseline, proposals and prior work; accepts and undoes through the native owner', async () => {
    const { bytes, previous, id, round } = await imported();
    const original = getSerializedSession();
    expect(useDocumentsStore.getState().docs[previous].session.formData.subject).toBe('Previous work');
    expect(original.paragraphs[0].header).toBe('Purpose');
    expect(original.paragraphs[1].text).toBe('Before **old** after.');
    const workspace = await loadReviewSuggestionWorkspace(round.id), proposal = workspace.state!.proposals[0];
    expect(proposal.changes[0]).toMatchObject({ expected: 'Before **old** after.', proposed: 'Before **new** after.' });
    expect(proposal.author).toContain('unverified'); expect(proposal.origin.context).toContain(original.formData.wordSource!.sha256);
    expect(new Uint8Array((await loadAttachment(original.formData.wordSource!.fileRef!.id))!)).toEqual(bytes);
    expect(await buildReviewCopy(round)).toBeDefined();
    useDocumentStore.getState().updateParagraph(2, { text: 'Newer independent tail.' });
    expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted')).status).toBe('committed');
    expect(getSerializedSession().paragraphs[1].text).toBe('Before **new** after.');
    expect(getSerializedSession().paragraphs[0].header).toBe('Purpose');
    expect(getSerializedSession().paragraphs[2].text).toBe('Newer independent tail.');
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied'); await flushDocumentWrites();
    expect(getSerializedSession().paragraphs[1].text).toBe('Before **old** after.');
    expect(getSerializedSession().paragraphs[2].text).toBe('Newer independent tail.');
    useDocumentsStore.getState().switchTo(previous); useDocumentsStore.getState().switchTo(id);
    expect((await loadReviewSuggestionWorkspace(round.id)).state!.decisions.map(decision => decision.action)).toEqual(['accepted', 'reversed']);
    expect(new Uint8Array((await loadAttachment(getSerializedSession().formData.wordSource!.fileRef!.id))!)).toEqual(bytes);
  });

  it('rejects an edit without rewriting its paragraph or exact source', async () => {
    const { round } = await imported(); const before = getSerializedSession();
    const proposal = (await loadReviewSuggestionWorkspace(round.id)).state!.proposals[0];
    expect((await decideReviewSuggestion(round.id, proposal.id, 'rejected')).status).toBe('committed');
    expect(getSerializedSession().paragraphs).toEqual(before.paragraphs);
    expect(getSerializedSession().formData.wordSource).toEqual(before.formData.wordSource);
  });

  it('uses the existing three-way resolution for independent same-paragraph edits and restores it with Undo', async () => {
    const { round } = await imported();
    const proposal = (await loadReviewSuggestionWorkspace(round.id)).state!.proposals[0], change = proposal.changes[0];
    const current = 'Before **old** after. Newer author sentence.';
    useDocumentStore.getState().updateParagraph(1, { text: current });
    await expect(decideReviewSuggestion(round.id, proposal.id, 'accepted')).rejects.toThrow('target differs');
    expect(getSerializedSession().paragraphs[1].text).toBe(current);
    const combined = reconcileReviewText(change.expected, current, change.proposed);
    expect(combined).toEqual({ kind: 'combined', value: 'Before **new** after. Newer author sentence.' });
    expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted', [{ changeId: change.id, expectedCurrent: current, value: combined.value }])).status).toBe('committed');
    expect(getSerializedSession().paragraphs[1].text).toBe(combined.value);
    expect(getSerializedSession().paragraphs[0].header).toBe('Purpose');
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied'); await flushDocumentWrites();
    expect(getSerializedSession().paragraphs[1].text).toBe(current);
  });

  it('surfaces a real overlap and rejects a stale human resolution before a deliberate current decision', async () => {
    const { round } = await imported();
    const proposal = (await loadReviewSuggestionWorkspace(round.id)).state!.proposals[0], change = proposal.changes[0];
    const current = 'Before **author** after.';
    useDocumentStore.getState().updateParagraph(1, { text: current });
    expect(reconcileReviewText(change.expected, current, change.proposed)).toEqual({ kind: 'overlap', value: current });
    await expect(decideReviewSuggestion(round.id, proposal.id, 'accepted')).rejects.toThrow('target differs');
    await expect(decideReviewSuggestion(round.id, proposal.id, 'accepted', [{ changeId: change.id, expectedCurrent: 'stale value', value: change.proposed }])).rejects.toThrow();
    expect(getSerializedSession().paragraphs[1].text).toBe(current);
    expect((await loadReviewSuggestionWorkspace(round.id)).state!.decisions).toEqual([]);
    expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted', [{ changeId: change.id, expectedCurrent: current, value: current }])).status).toBe('committed');
    expect(getSerializedSession().paragraphs[1].text).toBe(current);
  });

  it('cancels a tracked import before installation without leaving a round, document or source', async () => {
    const bytes = await wordImportFixture(`<w:p>${wordRun('Baseline ')}<w:ins w:id="1">${wordRun('inserted ')}</w:ins>${wordRun('text.')}</w:p>`);
    const parsed = await parseLetterFile(new File([bytes.buffer as ArrayBuffer], 'cancel-tracked.docx'));
    const documents = await idbGetAllDocuments(), assets = await idbGetAllAttachments(), rounds = await listReviewRounds(), current = useDocumentsStore.getState().currentId;
    const controller = new AbortController();
    const pending = openWordImport(parsed, 'naval_letter', captureDocumentTarget(), () => true, controller.signal);
    controller.abort(); expect(await pending).toBe('stale');
    expect(await idbGetAllDocuments()).toEqual(documents); expect(await idbGetAllAttachments()).toEqual(assets); expect(await listReviewRounds()).toEqual(rounds);
    expect(useDocumentsStore.getState().currentId).toBe(current);
  });

  it('rejects absent owned baseline resources before installing anything', async () => {
    const { parsed } = await imported(), snapshot = useDocumentStore.getState().getSnapshot();
    const before = await idbGetAllDocuments(), assets = await idbGetAllAttachments(), rounds = await listReviewRounds();
    await expect(prepareWordTrackedReview(copyWordImport(parsed.word!), snapshot, crypto.randomUUID(), Date.now(), [])).rejects.toThrow('missing or inconsistent');
    expect(await idbGetAllDocuments()).toEqual(before); expect(await idbGetAllAttachments()).toEqual(assets); expect(await listReviewRounds()).toEqual(rounds);
  });

  it('pins one owned snapshot for the plan, digest and baseline throughout asynchronous preparation', async () => {
    const { parsed } = await imported(), snapshot = structuredClone(useDocumentStore.getState().getSnapshot());
    const before = structuredClone(snapshot), assets = (await idbGetAllAttachments())!;
    const pending = prepareWordTrackedReview(copyWordImport(parsed.word!), snapshot, crypto.randomUUID(), Date.now(), assets);
    snapshot.paragraphs[1].text = 'A caller changed this snapshot while serialization was pending.';
    snapshot.formData.subject = 'A DIFFERENT REVISION';
    const prepared = (await pending)!;
    expect(prepared.round.baseline.session.paragraphs).toEqual(before.paragraphs);
    expect(prepared.round.baseline.session.formData.subject).toBe(before.formData.subject);
    expect(prepared.suggestions.state.proposals[0].changes[0].expected).toBe('Before **old** after.');
    expect(await buildReviewCopy(prepared.round)).toBeDefined();
  });

  it('bounds repeated portable image expansion before serializing a complete baseline', async () => {
    const { parsed } = await imported(), snapshot = structuredClone(useDocumentStore.getState().getSnapshot());
    const sourceAssets = await idbGetAllAttachments();
    const data = new Uint8Array(4 * 1024 * 1024).buffer;
    const resource = { id: 'repeated-image', name: 'image.png', type: 'image/png', size: data.byteLength, data };
    const ref = { id: resource.id, name: resource.name, type: resource.type, size: resource.size };
    snapshot.paragraphs.push(...Array.from({ length: 9 }, (_, index) => ({ id: `image-${index}`, level: 0, text: '', figure: { placement: 'body' as const, fileRef: ref } })));
    await expect(prepareWordTrackedReview(copyWordImport(parsed.word!), snapshot, crypto.randomUUID(), Date.now(), [...sourceAssets!, resource])).rejects.toThrow('32 MB expanded resource limit');
    expect(await loadAttachment(resource.id)).toBeNull();
  });

  it('refuses an incomplete review copy after original source deletion without changing the pinned baseline', async () => {
    const { round } = await imported(), before = structuredClone(round.baseline);
    await idbDeleteAttachment(getSerializedSession().formData.wordSource!.fileRef!.id);
    await expect(buildReviewCopy(round)).rejects.toThrow();
    expect(round.baseline).toEqual(before);
    expect((await loadReviewSuggestionWorkspace(round.id)).state!.proposals).toHaveLength(1);
  });

  const underlined = (text: string) => wordRun(text, '<w:u w:val="single"/>');
  const counters = ([
    [wordRun('1. '), wordRun('2. '), 0], [wordRun('a. '), wordRun('b. '), 1],
    [wordRun('(1) '), wordRun('(2) '), 2], [wordRun('(a) '), wordRun('(b) '), 3],
    [underlined('1') + wordRun('. '), underlined('2') + wordRun('. '), 4],
    [underlined('a') + wordRun('. '), underlined('b') + wordRun('. '), 5],
    [underlined('(1)') + wordRun(' '), underlined('(2)') + wordRun(' '), 6],
    [underlined('(a)') + wordRun(' '), underlined('(b)') + wordRun(' '), 7],
    [wordRun('(') + underlined('1') + wordRun(') '), wordRun('(') + underlined('2') + wordRun(') '), 6],
    [wordRun('(') + underlined('a') + wordRun(') '), wordRun('(') + underlined('b') + wordRun(') '), 7],
  ] as const).map(([label, next, level], index) => ({ label, next, level, variant: index >= 8 ? 'inner underline' : 'whole label' }));
  it.each(counters)('maps only body text after the unchanged printed label at level $level ($variant)', async ({ label, level }) => {
    const source = await wordImportFixture(`<w:p>${label}${wordRun('Before ')}<w:del w:id="1">${wordRun('old', '<w:b/>').replaceAll('w:t', 'w:delText')}</w:del><w:ins w:id="2">${wordRun('new', '<w:b/>')}</w:ins>${wordRun(' after.')}</w:p>`);
    const parsed = await parseLetterFile(new File([source.buffer as ArrayBuffer], 'counter.docx'));
    expect(await openWordImport(parsed, 'naval_letter')).toBe('applied');
    expect(getSerializedSession().paragraphs[0]).toMatchObject({ level, text: 'Before **old** after.' });
    const round = (await listReviewRounds())[0], proposal = (await loadReviewSuggestionWorkspace(round.id)).state!.proposals[0];
    expect(proposal.changes[0]).toMatchObject({ expected: 'Before **old** after.', proposed: 'Before **new** after.' });
  });
  for (const operation of ['insert', 'change', 'delete'] as const) it.each(counters)(`declines ${operation} of a printed label at level $level ($variant)`, async ({ label, next }) => {
    const deleted = `<w:del w:id="1">${label.replaceAll('w:t', 'w:delText')}</w:del>`;
    const inserted = `<w:ins w:id="2">${operation === 'change' ? next : label}</w:ins>`;
    const source = await wordImportFixture(`<w:p>${operation === 'insert' ? inserted : operation === 'delete' ? deleted : deleted + inserted}${wordRun('Keep this body text.')}</w:p>`);
    const parsed = await parseLetterFile(new File([source.buffer as ArrayBuffer], 'changed-counter.docx'));
    expect(await openWordImport(parsed, 'naval_letter')).toBe('applied');
    expect(getSerializedSession().paragraphs[0].text).toBe('Keep this body text.');
    expect(await listReviewRounds()).toEqual([]);
    expect(getSerializedSession().formData.wordSource!.notices.join(' ')).toContain('changed printed numbering');
  });

  it('rolls back a new document and assets on an actual initial-review key collision', async () => {
    const { round, id } = await imported();
    const state = (await loadReviewSuggestionWorkspace(round.id)).state!;
    const beforeDocuments = await idbGetAllDocuments(), beforeAssets = await idbGetAllAttachments();
    const existing = beforeDocuments!.find(document => document.id === id)!;
    const newId = crypto.randomUUID(), copy = { ...existing, id: newId, meta: { ...existing.meta, id: newId } };
    const collision = { ...round, sourceDocumentId: newId, ownerDocumentId: newId };
    expect(await idbInstallDocumentWithAssets(copy, [{ id: 'never-retained', name: 'owned', type: 'application/octet-stream', size: 1, data: new Uint8Array([1]).buffer }], () => true, undefined,
      { round: collision, suggestions: { documentId: newId, state } })).toBe('failed');
    expect(await idbGetAllDocuments()).toEqual(beforeDocuments); expect(await idbGetAllAttachments()).toEqual(beforeAssets);
    expect(await idbReadReviewSuggestions(newId, round.id)).toBeNull();
  });
});

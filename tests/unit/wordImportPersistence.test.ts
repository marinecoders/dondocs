import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordDrawing, wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { parseLetterFile } from '@/lib/importLetter';
import { openWordImport } from '@/lib/importWord';
import { createBlankSession, getSerializedSession, suspendSessionSaves, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { buildDraftFile, parsePortableDraft } from '@/lib/draftFile';
import { buildAssetSharePayload, parseAssetSharePayload } from '@/lib/assetShare';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { idbDeleteAttachment, idbDeleteDocument, idbDeleteSnapshots, idbGetAllAttachments, idbGetAllDocuments, idbInstallDocumentWithAssets, idbPutAttachment } from '@/lib/documentsDb';
import { loadAttachment, persistAttachment } from '@/lib/attachments';
import { useUIStore } from '@/stores/uiStore';
import { validatePackageDraft } from '@/lib/actionPackageDraft';
import { captureCurrentDocumentRevision } from '@/stores/captureDocument';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, packageAssets, reviseActionPackage } from '@/lib/actionPackages';
import { capturePackageTemplate, exportPackageTemplate, importPackageTemplate, listPackageTemplates } from '@/lib/packageTemplateLibrary';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { createSharedPayload, parseSharedSession, draftEnvelope } from '@/lib/sharedSession';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
installWordXmlDom();

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
  suspendSessionSaves(); await clearDb();
  useUIStore.setState({ storageHealth: 'ok' });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null, lastKindIds: {} });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Previous draft remains');
  useDocumentsStore.getState().saveCurrent(); await flushDocumentWrites();
});
afterEach(async () => { await flushDocumentWrites(); });

async function imported() {
  const bytes = await wordImportFixture(`${wordParagraph('From: Training Office')}${wordParagraph('To: Training Marine')}${wordParagraph('Subj: WORD NATIVE IMPORT')}${wordParagraph('Introductory prose must remain.')}<w:tbl><w:tr><w:tc>${wordParagraph('Name')}</w:tc><w:tc>${wordParagraph('MARINE')}</w:tc></w:tr></w:tbl><w:p>${wordDrawing}</w:p>${wordParagraph('1. Action text remains.')}`);
  const parsed = await parseLetterFile(new File([bytes.buffer as ArrayBuffer], 'native-source.docx'));
  const oldId = useDocumentsStore.getState().currentId!;
  expect(await openWordImport(parsed, 'naval_letter')).toBe('applied');
  await flushDocumentWrites();
  return { bytes, parsed, oldId, id: useDocumentsStore.getState().currentId! };
}

describe('rich Word storage and portable ownership', () => {
  it('retains prefix prose/table/image, prior work, source bytes and portable draft/share/backup data', async () => {
    const { bytes, oldId, id } = await imported();
    expect(id).not.toBe(oldId);
    expect(useDocumentsStore.getState().docs[oldId].session.formData.subject).toBe('Previous draft remains');
    const session = getSerializedSession();
    expect(session.formData.subject).toBe('WORD NATIVE IMPORT');
    expect(session.formData.sigFirst).toBe(''); expect(session.formData.sigLast).toBe('');
    expect(session.formData.unitLine1).toBe(''); expect(session.formData.unitAddress).toBe('');
    expect(session.paragraphs.map(paragraph => paragraph.text)).toEqual(['Introductory prose must remain.', '', 'Source image', 'Action text remains.']);
    expect(session.paragraphs[1].bodyTable?.rows).toEqual([['Name', 'MARINE']]);
    expect(new Uint8Array((await loadAttachment(session.formData.wordSource!.fileRef!.id))!)).toEqual(bytes);
    const draft = await buildDraftFile();
    expect(draft).toMatchObject({ version: 4, documentKind: 'correspondence' });
    const read = await parsePortableDraft(draft, false, true);
    expect(new Uint8Array(read.wordSourceFile!.data)).toEqual(bytes);
    expect(read.session.paragraphs[1].bodyTable).toEqual(session.paragraphs[1].bodyTable);
    const share = await buildAssetSharePayload(useDocumentStore.getState().getSnapshot(), Date.now());
    expect(share).toMatchObject({ version: 6 });
    expect(new Uint8Array((await parseAssetSharePayload(share)).wordSourceFile!.data)).toEqual(bytes);
    const backup = await buildBackup(); expect(JSON.parse(backup).version).toBe(14);
    await clearDb(); useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null });
    await restoreBackup(backup);
    const restored = (await idbGetAllDocuments())!.find(document => document.id === id)!;
    expect(restored.session.paragraphs[1].bodyTable).toEqual(session.paragraphs[1].bodyTable);
    expect(new Uint8Array((await loadAttachment(restored.session.formData.wordSource!.fileRef!.id))!)).toEqual(bytes);
  });

  it('retains all table layout controls through complete drafts, encrypted payloads, packages and backup restoration', async () => {
    const { id } = await imported();
    const original = useDocumentStore.getState().paragraphs[1].bodyTable!;
    const layout = { ...original, columnWidths: [25, 75], columnAlignments: ['left', 'right'] as const, borders: 'outline' as const, fontSize: 10 as const, minimumRowHeight: 24, repeatHeaders: false };
    const formatted = { ...layout, columnAlignments: [...layout.columnAlignments] };
    useDocumentStore.getState().updateParagraph(1, { bodyTable: formatted });
    useDocumentsStore.getState().saveCurrent();await flushDocumentWrites();
    const complete = await parsePortableDraft(await buildDraftFile(), false, true);
    expect(complete.session.paragraphs[1].bodyTable).toEqual(formatted);
    const shared = await parseAssetSharePayload(await buildAssetSharePayload(useDocumentStore.getState().getSnapshot(), Date.now()));
    expect(shared.session.paragraphs[1].bodyTable).toEqual(formatted);
    const member = await capturePackageMember(captureCurrentDocumentRevision(), 'Formatted table', 'basic-letter');
    if (member.kind !== 'native') throw new Error('Expected native package member');
    expect(member.session.paragraphs[1].bodyTable).toEqual(formatted);
    const backup = await buildBackup();
    await clearDb();useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null });
    await restoreBackup(backup);
    const restored = (await idbGetAllDocuments())!.find(document => document.id === id)!;
    expect(restored.session.paragraphs[1].bodyTable).toEqual(formatted);
  });

  it('installs an exact non-example sender symbol and no invented signer/authority/contact fields', async () => {
    const source = await wordImportFixture(['5216', 'Ser TRNG/001', '16 Nov 26', 'From: Training Office', 'To: Fictional Marine', 'Subj: EXACT SENDER', '1. Source body.', 'A. EXAMPLE'].map(wordParagraph).join(''));
    const parsed = await parseLetterFile(new File([source.buffer as ArrayBuffer], 'sender-symbol.docx'));
    expect(await openWordImport(parsed, 'naval_letter')).toBe('applied');
    const session = getSerializedSession();
    expect(session.formData).toMatchObject({ serial: 'TRNG/001', officeCode: '', pocEmail: '', sigFirst: 'A', sigLast: 'EXAMPLE', sigRank: '', sigTitle: '', acting: false, byDirection: false, byDirectionAuthority: '', salutation: '', complimentaryClose: '' });
    const word = generateFlatLatex(session), pdf = Object.values(generateAllLatexFiles(session).texFiles).join('\n');
    for (const output of [word, pdf]) {
      expect(output).toContain('Ser TRNG/001');
      expect(output).not.toContain('S-3/TRNG/001');
      expect(output).not.toContain('john.doe@usmc.mil');
      expect(output).not.toContain('Lieutenant Colonel');
    }
  });

  it('reopens an imported native baseline without address or legacy-mark normalization', async () => {
    const source = await wordImportFixture(`${wordParagraph('Subj: NATIVE WORD BASELINE')}${wordParagraph('(U) Original portion-prefix wording.')}`);
    const parsed = await parseLetterFile(new File([source.buffer as ArrayBuffer], 'literal-prefix.docx'));
    const priorId = useDocumentsStore.getState().currentId!;
    expect(await openWordImport(parsed, 'naval_letter')).toBe('applied');
    const id = useDocumentsStore.getState().currentId!;
    useDocumentStore.getState().setField('unitAddress', 'NORFOLK VA 23511');
    useDocumentStore.getState().updateParagraph(0, { portionMarking: 'FOUO' });
    useDocumentsStore.getState().saveCurrent();
    const before = getSerializedSession();
    expect(before.paragraphs[0].text).toBe('(U) Original portion-prefix wording.');
    await flushDocumentWrites();
    useDocumentsStore.getState().switchTo(priorId);
    useDocumentsStore.getState().switchTo(id);
    expect(getSerializedSession().paragraphs).toEqual(before.paragraphs);
    expect(getSerializedSession().formData).toEqual(before.formData);
    expect(useDocumentsStore.getState().docs[id].meta.nativeReviewText).toBe(true);
  });

  it('persists imported native Word discussions with exact original bytes through a complete draft', async () => {
    const source = await wordImportFixture('<w:p><w:r><w:t>Before </w:t></w:r><w:commentRangeStart w:id="1"/><w:r><w:t>selected</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:t> after.</w:t></w:r></w:p>', {
      'word/comments.xml': '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="1" w:author="Word Chief"><w:p><w:r><w:t>Imported Word feedback.</w:t></w:r></w:p></w:comment></w:comments>',
    });
    const parsed = await parseLetterFile(new File([source.buffer as ArrayBuffer], 'word-comments.docx'));
    expect(await openWordImport(parsed, 'naval_letter')).toBe('applied');
    const session = getSerializedSession(), thread = session.reviewComments!.threads[0];
    expect(thread.anchor.kind).toBe('range');
    expect(thread.messages[0].text).toContain('Imported Word feedback.');
    const draft = await parsePortableDraft(await buildDraftFile(), false, true);
    expect(draft.session.reviewComments).toEqual(session.reviewComments);
    expect(new Uint8Array(draft.wordSourceFile!.data)).toEqual(source);
    const share = await parseAssetSharePayload(await buildAssetSharePayload(useDocumentStore.getState().getSnapshot(), Date.now()));
    expect(share.session.reviewComments).toEqual(session.reviewComments);
  });

  it('aborts an asynchronous import without changing documents or retaining partial files', async () => {
    const bytes = await wordImportFixture(wordParagraph('1. Cancel this import.'));
    const parsed = await parseLetterFile(new File([bytes.buffer as ArrayBuffer], 'cancel.docx'));
    const before = await idbGetAllDocuments(), files = await idbGetAllAttachments(), current = useDocumentsStore.getState().currentId;
    const controller = new AbortController();
    const pending = openWordImport(parsed, 'naval_letter', captureDocumentTarget(), () => true, controller.signal);
    controller.abort(); expect(await pending).toBe('stale');
    expect(useDocumentsStore.getState().currentId).toBe(current);
    expect(await idbGetAllDocuments()).toEqual(before); expect(await idbGetAllAttachments()).toEqual(files);
  });

  it('rolls back all imported resources and the document on an actual IDB attachment-key collision', async () => {
    const existing = await persistAttachment({ name: 'existing', size: 1, type: 'application/octet-stream' }, new Uint8Array([7]).buffer);
    const id = crypto.randomUUID(), now = Date.now();
    const record = { id, meta: { id, title: 'Should not exist', docType: 'naval_letter', updatedAt: now }, session: createBlankSession() };
    const result = await idbInstallDocumentWithAssets(record, [
      { id: 'new-operation-asset', name: 'first', type: 'application/octet-stream', size: 1, data: new Uint8Array([1]).buffer },
      { id: existing.id, name: 'collision', type: 'application/octet-stream', size: 1, data: new Uint8Array([2]).buffer },
    ], () => true);
    expect(result).toBe('failed'); expect((await idbGetAllDocuments())!.some(document => document.id === id)).toBe(false);
    expect(await loadAttachment('new-operation-asset')).toBeNull(); expect(new Uint8Array((await loadAttachment(existing.id))!)).toEqual(new Uint8Array([7]));
  });

  it('rejects a packaged original whose retained text or bytes disagree with its claimed Word source', async () => {
    await imported();
    const draft = JSON.parse(JSON.stringify(await buildDraftFile()));
    draft.formData.wordSource.retainedText = 'forged harmless metadata';
    await expect(validatePackageDraft(draft)).rejects.toThrow('retained content');
    const other = await wordImportFixture(wordParagraph('Different source text.'));
    draft.wordSourceFile.data = Buffer.from(other).toString('base64'); draft.wordSourceFile.size = other.byteLength;
    await expect(validatePackageDraft(draft)).rejects.toThrow('retained content');
  });

  it('refuses complete-draft delivery after actual stored source bytes change', async () => {
    await imported();
    const metadata = getSerializedSession().formData.wordSource!;
    const replacement = await wordImportFixture(wordParagraph('A different original Word file.'));
    await idbPutAttachment({ ...metadata.fileRef!, size: replacement.byteLength, data: replacement.buffer as ArrayBuffer });
    const before = getSerializedSession();
    await expect(buildDraftFile()).rejects.toThrow('retained content');
    expect(getSerializedSession().paragraphs).toEqual(before.paragraphs);
  });

  it('refuses source delivery when a restored backup carries a forged Word identity', async () => {
    const { id } = await imported();
    const backup = JSON.parse(await buildBackup());
    backup.documents.find((document: { id: string }) => document.id === id).session.formData.wordSource.sha256 = '0'.repeat(64);
    await clearDb(); useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null });
    await restoreBackup(JSON.stringify(backup));
    useDocumentsStore.getState().switchTo(id);
    expect(getSerializedSession().formData.wordSource?.sha256).toBe('0'.repeat(64));
    await expect(buildDraftFile()).rejects.toThrow('retained content');
  });

  it('uses the actual form kind after a public category switch and keeps the saved correspondence independent', async () => {
    const { id } = await imported();
    const retained = structuredClone(useDocumentStore.getState().getSnapshot());
    useDocumentsStore.getState().selectKind('forms', 'navmc_10274');
    const draft = await buildDraftFile(), share = createSharedPayload(getSerializedSession());
    expect((await parsePortableDraft(draft)).session.documentCategory).toBe('forms');
    expect(parseSharedSession(share).documentCategory).toBe('forms');
    expect(useDocumentsStore.getState().docs[id].session.paragraphs[1].bodyTable).toEqual(retained.paragraphs[1].bodyTable);
    const inactive = { ...createBlankSession('navmc_10274'), paragraphs: retained.paragraphs };
    expect(draftEnvelope(inactive)).toMatchObject({ version: 4, documentKind: 'builtin-form' });
    expect(parseSharedSession(createSharedPayload(inactive)).paragraphs[1].bodyTable).toEqual(retained.paragraphs[1].bodyTable);
  });

  it.each(['package', 'template'] as const)('uses rich backup version when only a %s retains the supported Word content', async kind => {
    const { id } = await imported();
    const member = await capturePackageMember(captureCurrentDocumentRevision(), 'Retained Word letter', 'basic-letter');
    const record = await reviseActionPackage(await createActionPackage('Word action'), [member]);
    if (kind === 'template') {
      const template = await capturePackageTemplate(record, record.currentRevisionId, 'Word starter');
      expect(JSON.stringify(template)).not.toContain('wordSourceFile');
      const portable = await exportPackageTemplate(template);
      await clearDb(); await importPackageTemplate(portable);
    }
    for (const document of (await idbGetAllDocuments())!) { await idbDeleteDocument(document.id); await idbDeleteSnapshots(document.id); }
    const old = useDocumentStore.getState().formData.wordSource!;
    await idbDeleteAttachment(old.fileRef!.id);
    for (const paragraph of useDocumentStore.getState().paragraphs) if (paragraph.figure?.fileRef) await idbDeleteAttachment(paragraph.figure.fileRef.id);
    useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null });
    useDocumentStore.getState().resetForm();
    const backup = await buildBackup(), parsed = JSON.parse(backup); expect(parsed.documents).toHaveLength(0); expect(parsed.version).toBe(14);
    await clearDb(); await restoreBackup(backup);
    if (kind === 'template') expect((await listPackageTemplates())[0].members.some(item => item.kind === 'native' && JSON.stringify(item.draft).includes('bodyTable'))).toBe(true);
    else expect(parsed.actionPackages?.[0].revisions.some((revision: { members: Array<{ kind: string }> }) => revision.members.some(member => member.kind === 'native'))).toBe(true);
    expect((await idbGetAllDocuments())!.some(document => document.id === id)).toBe(false);
    if (kind === 'package') expect(packageAssets(record).length).toBeGreaterThan(0);
  });
});

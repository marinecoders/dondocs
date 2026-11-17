import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { readWordDocument } from '@/services/docx/import/readWord';
import { parseLetterFile } from '@/lib/importLetter';
import { getSerializedSession, suspendSessionSaves, useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { idbGetAllAttachments, idbGetAllDocuments } from '@/lib/documentsDb';
import { assertRetainedTextPolicy } from '@/lib/retainedDocumentTextPolicy';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
installWordXmlDom();
const fixture = (name: string) => new Uint8Array(readFileSync(resolve('tests/fixtures/word', name)));

it.each(['unsupported-conflict-deletion.docx', 'unsupported-split-conflict.docx', 'unsupported-inline-alternatives.docx'])('rejects %s before accepting an incomplete original-text inventory', async name => {
  await expect(readWordDocument(fixture(name), name)).rejects.toThrow(/unsupported inline text/);
});

it('rejects text excluded from both nested revision views instead of omitting it from the retained source', async () => {
  const source = await wordImportFixture(`${wordParagraph('Native baseline.')}<w:p><w:ins w:id="1"><w:del w:id="2">${wordRun('SECRET').replaceAll('w:t', 'w:delText')}</w:del></w:ins></w:p>`);
  await expect(readWordDocument(source, 'nested-revision.docx')).rejects.toThrow(/unsupported inline text/);
});

it('preserves the existing early rejection of unsupported inline math namespaces', async () => {
  const source = await wordImportFixture(`${wordParagraph('Native baseline.')}<w:p><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>SEC</m:t></m:r><m:r><m:t>RET</m:t></m:r></m:oMath></w:p>`);
  await expect(readWordDocument(source, 'inline-equation.docx')).rejects.toThrow('unsupported XML namespace');
});

it('rejects an unsupported original through file import before touching prior work or durable assets', async () => {
  suspendSessionSaves();useUIStore.setState({ storageHealth: 'ok' });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null, lastKindIds: {} });
  useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('subject', 'Prior source stays open');
  useDocumentsStore.getState().saveCurrent();await flushDocumentWrites();
  const before = { id: useDocumentsStore.getState().currentId, session: getSerializedSession(), docs: await idbGetAllDocuments(), assets: await idbGetAllAttachments() };
  const source = fixture('unsupported-inline-alternatives.docx');
  await expect(parseLetterFile(new File([source.buffer as ArrayBuffer], 'unsupported-inline.docx'))).rejects.toThrow(/Nothing has been imported/);
  await flushDocumentWrites();
  expect(useDocumentsStore.getState().currentId).toBe(before.id);
  expect({ ...getSerializedSession(), timestamp: before.session.timestamp }).toEqual(before.session);
  expect(await idbGetAllDocuments()).toEqual(before.docs);expect(await idbGetAllAttachments()).toEqual(before.assets);
});

it('keeps normal split-run before and after revisions complete for the original handling gate', async () => {
  const source = await wordImportFixture(`<w:p><w:del w:id="1">${wordRun('SEC').replaceAll('w:t', 'w:delText')}${wordRun('RET').replaceAll('w:t', 'w:delText')}</w:del><w:ins w:id="2">${wordRun('Reviewed alternative.')}</w:ins></w:p>`);
  const result = await readWordDocument(source, 'ordinary-revisions.docx');
  expect(result.source.retainedText).toContain('SECRET');expect(result.source.retainedText).toContain('Reviewed alternative.');
  expect(result.source.bytes).toEqual(source);
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  expect(() => assertRetainedTextPolicy([result.source.retainedText], policy)).toThrow('outside');
});

it('preserves ordinary Word page fields and their displayed result', async () => {
  const source = await wordImportFixture(`<w:p>${wordRun('Training page ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${wordRun('1')}<w:r><w:fldChar w:fldCharType="end"/></w:r>${wordRun('.')}</w:p>`);
  const result = await readWordDocument(source, 'page-field.docx');
  expect(result.blocks[0].paragraph.text).toBe('Training page 1.');
  expect(result.source.retainedText).toContain(' PAGE ');expect(result.source.bytes).toEqual(source);
});

it('still reads the actual prior native DonDocs Word export without changing its retained bytes', async () => {
  const source = fixture('dondocs-naval-deep.docx'), result = await readWordDocument(source, 'dondocs-naval-deep.docx');
  expect(result.blocks).toHaveLength(20);expect(result.source.retainedText).toContain('WORD LAYOUT QUALIFICATION');expect(result.source.bytes).toEqual(source);
});

it('inventories independent Word text-box paragraphs even though their drawing stays original-only', async () => {
  const source = await wordImportFixture(`${wordParagraph('Native baseline.')}<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="box"><v:textbox><w:txbxContent><w:p>${wordRun('SEC')}${wordRun('RET')}</w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`);
  const result = await readWordDocument(source, 'legacy-textbox.docx');
  expect(result.blocks[0].paragraph.text).toBe('Native baseline.');expect(result.source.retainedText).toContain('SECRET');expect(result.source.bytes).toEqual(source);
});

it('retains independently inventoried block-level alternatives without choosing a visible branch', async () => {
  const source = await wordImportFixture(`${wordParagraph('Native baseline.')}<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><mc:Choice Requires="w14"><w:p>${wordRun('SEC')}${wordRun('RET')}</w:p></mc:Choice><mc:Fallback>${wordParagraph('Visible fallback.')}</mc:Fallback></mc:AlternateContent>`);
  const result = await readWordDocument(source, 'block-alternatives.docx');
  expect(result.blocks).toHaveLength(1);expect(result.source.retainedText).toContain('SECRET');expect(result.source.retainedText).toContain('Visible fallback.');
  expect(result.notices.join(' ')).toContain('Some body objects are not editable');
});

it('does not mistake formatting whitespace in empty alternate branches for unaccounted text', async () => {
  const source = await wordImportFixture(`<w:p>${wordRun('Native baseline.')}<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><mc:Choice Requires="w14"><w:r><w:t/></w:r></mc:Choice><mc:Fallback>
  </mc:Fallback></mc:AlternateContent></w:p>`);
  const result = await readWordDocument(source, 'empty-alternative.docx');
  expect(result.blocks[0].paragraph.text).toBe('Native baseline.');expect(result.source.bytes).toEqual(source);
});

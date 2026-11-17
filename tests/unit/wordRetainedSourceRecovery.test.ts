import { afterEach, expect, it, vi } from 'vitest';
import * as attachments from '@/lib/attachments';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { WORD_NS, wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { readRetainedWordSource, readWordDocument } from '@/services/docx/import/readWord';
import { validateWordSourceFile } from '@/lib/wordSourceResources';
import { buildDraftFileFromSnapshot, parsePortableDraft } from '@/lib/draftFile';
import { createBlankSession } from '@/stores/documentStore';
import { assertRetainedTextPolicy } from '@/lib/retainedDocumentTextPolicy';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

installWordXmlDom();
afterEach(() => vi.restoreAllMocks());

it.each([{ count: 101, text: 'Short comment.', error: 'more than 100 comments' }, { count: 1, text: 'x'.repeat(8_001), error: 'supported text limits' }])('recovers and transfers an existing original with $count comments while new native imports remain bounded', async ({ count, text, error }) => {
  const comments = Array.from({ length: count }, (_, id) => `<w:comment w:id="${id}" w:author="Chief">${wordParagraph(id === 0 ? `(S) Synthetic retained feedback. ${text}` : text)}</w:comment>`).join('');
  const bytes = await wordImportFixture(wordParagraph('1. Existing editable draft.'), { 'word/comments.xml': `<w:comments xmlns:w="${WORD_NS}">${comments}</w:comments>` });
  await expect(readWordDocument(bytes, 'legacy-original.docx')).rejects.toThrow(error);
  const source = await readRetainedWordSource(bytes, 'legacy-original.docx');
  expect(source.bytes).toEqual(bytes);
  expect(source.retainedText).toContain(`(S) Synthetic retained feedback. ${text}`);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), byte => byte.toString(16).padStart(2, '0')).join('');
  expect(source.sha256).toBe(sha256);
  const metadata = { name: source.name, sha256, retainedText: source.retainedText, notices: [], fileRef: { id: 'legacy-source', name: source.name, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: bytes.byteLength } };
  await expect(validateWordSourceFile({ data: bytes.buffer as ArrayBuffer }, metadata)).resolves.toBeUndefined();
  await expect(validateWordSourceFile({ data: bytes.buffer as ArrayBuffer }, { ...metadata, sha256: '0'.repeat(64) })).rejects.toThrow('identity');
  await expect(validateWordSourceFile({ data: bytes.buffer as ArrayBuffer }, { ...metadata, retainedText: 'forged harmless inventory' })).rejects.toThrow('identity');
  const snapshot = { ...createBlankSession(), endItems: [], publicationTables: {} };snapshot.formData.wordSource = metadata;snapshot.paragraphs = [{ ...snapshot.paragraphs[0], text: 'Existing editable draft.', level: 0 }];
  const readSource = vi.spyOn(attachments, 'loadAttachment').mockResolvedValue(bytes.buffer as ArrayBuffer);
  const draft = await buildDraftFileFromSnapshot(snapshot, 1);
  expect(readSource).toHaveBeenCalledWith(metadata.fileRef.id);
  const restored = await parsePortableDraft(draft, false, true);
  expect(new Uint8Array(restored.wordSourceFile!.data)).toEqual(bytes);
  expect(restored.session.paragraphs).toEqual(snapshot.paragraphs);
  const restricted = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  expect(() => assertRetainedTextPolicy([source.retainedText], restricted)).toThrow('outside this deployment');
});

it('recovers the exact older hyphen inventory without accepting stripped literal hyphens or forged text', async () => {
  const bytes = await wordImportFixture(`<w:p><w:r><w:t>Token M</w:t><w:noBreakHyphen/><w:t>16.</w:t></w:r></w:p>${wordParagraph('Literal M\u201116. (S) stays literal.')}`);
  const source = await readRetainedWordSource(bytes, 'legacy-hyphen.docx');
  const legacyInventory = source.retainedText.replace('Token M\u201116.', 'Token M16.');
  expect(legacyInventory).not.toBe(source.retainedText);
  const metadata = { name: source.name, sha256: source.sha256, retainedText: legacyInventory, notices: [] };
  await expect(validateWordSourceFile({ data: bytes.buffer as ArrayBuffer }, metadata)).resolves.toBeUndefined();
  await expect(validateWordSourceFile({ data: bytes.buffer as ArrayBuffer }, { ...metadata, retainedText: legacyInventory.replaceAll('\u2011', '') })).rejects.toThrow('identity');
  await expect(validateWordSourceFile({ data: bytes.buffer as ArrayBuffer }, { ...metadata, retainedText: legacyInventory.replace(' (S)', '') })).rejects.toThrow('identity');
  const snapshot = { ...createBlankSession(), endItems: [], publicationTables: {} };snapshot.formData.wordSource = { ...metadata, fileRef: { id: 'source', name: source.name, size: bytes.byteLength, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } };
  const readSource = vi.spyOn(attachments, 'loadAttachment').mockResolvedValue(bytes.buffer as ArrayBuffer);
  const restored = await parsePortableDraft(await buildDraftFileFromSnapshot(snapshot, 1), false, true);
  expect(readSource).toHaveBeenCalledWith('source');
  expect(new Uint8Array(restored.wordSourceFile!.data)).toEqual(bytes);
  expect(restored.session.formData.wordSource?.retainedText).toBe(legacyInventory);
});

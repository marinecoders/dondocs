import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph, wordDrawing } from '../_helpers/wordImportFixture';
import { readWordDocument } from '@/services/docx/import/readWord';
import { parseLetterFile } from '@/lib/importLetter';
import { openWordImport } from '@/lib/importWord';
import { getSerializedSession, suspendSessionSaves } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { idbGetAllAttachments } from '@/lib/documentsDb';
import { loadAttachment } from '@/lib/attachments';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
installWordXmlDom();
afterEach(async () => { await flushDocumentWrites(); });

it('retains every visual occurrence of a large shared image with one durable owned media resource', async () => {
  suspendSessionSaves();
  useUIStore.setState({ storageHealth: 'ok' });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null, lastKindIds: {} });
  useDocumentsStore.getState().newDocument();
  await flushDocumentWrites();
  const source = new Uint8Array(readFileSync(resolve('tests/fixtures/word/repeated-shared-media.docx')));
  const parsed = await parseLetterFile(new File([source.buffer as ArrayBuffer], 'repeated-shared-media.docx'));
  expect(parsed.word!.blocks.filter(block => block.paragraph.figure)).toHaveLength(24);
  const before = await idbGetAllAttachments();
  expect(await openWordImport(parsed, 'naval_letter')).toBe('applied');
  await flushDocumentWrites();
  const session = getSerializedSession(), images = session.paragraphs.filter(paragraph => paragraph.figure);
  expect(images).toHaveLength(24);
  const refs = new Set(images.map(paragraph => paragraph.figure!.fileRef!.id));
  expect(refs.size).toBe(1);
  expect((await idbGetAllAttachments())!.length - before!.length).toBe(2);
  expect((await loadAttachment([...refs][0]))!.byteLength).toBe(3_145_810);
  expect(new Uint8Array((await loadAttachment(session.formData.wordSource!.fileRef!.id))!)).toEqual(source);
});

it('owns even a pooled Node Buffer input before asynchronous ZIP inspection', async () => {
  const bytes = Buffer.from(await wordImportFixture(wordParagraph('Owned source')));
  const pending = readWordDocument(bytes, 'owned.docx');
  bytes.fill(0);
  const result = await pending;
  expect(result.blocks[0].paragraph.text).toBe('Owned source');
  expect(result.source.bytes).toBeInstanceOf(Uint8Array);
  expect(result.source.bytes[0]).toBe(80);
});


it('retains the total visual-pixel guard for repeated large images while sharing their stored bytes', async () => {
  const image = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#88aaee' } }).png().toBuffer();
  const source = (count: number) => wordImportFixture(`<w:p>${wordDrawing}</w:p>`.repeat(count), { 'word/media/test.png': image });
  expect((await readWordDocument(await source(19), 'large-repeated.docx')).blocks).toHaveLength(19);
  await expect(readWordDocument(await source(20), 'too-many-visual-pixels.docx')).rejects.toThrow('combined 80 megapixel');
});

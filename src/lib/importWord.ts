import { captureDocumentTarget, isCurrentDocumentTarget, openCommittedDocument, prepareDocument, copyPreparedDocument, deriveTitle, flushDocumentWrites, useDocumentsStore, type DocumentTarget } from '@/stores/documentsStore';
import { copyWordImport, wordImageBytes, wordImageResourceKey } from '@/services/docx/import/readWord';
import { parsedLetterSession, parseLetterText, parsedWordFields, type ParsedImport } from './importLetter';
import { newAttachmentId, withAttachmentStaging } from './attachments';
import { idbInstallDocumentWithAssets, type StoredAttachment, type StoredDocument } from './documentsDb';
import { serializeDocumentSnapshot } from './documentSerialization';
import { WORD_DOCUMENT_TYPE } from '@/services/docx/import/readWord';
import type { FileRef } from '@/types/document';

/** Install one prepared revision after all source/media writes, under the original owner. */
export async function openWordImport(result: ParsedImport, docType: string, target: DocumentTarget | null = captureDocumentTarget(), active = () => true, signal?: AbortSignal): Promise<'applied' | 'stale'> {
  if (!result.word) throw new Error('Read a Word document before importing it.');
  const imported = copyWordImport(result.word);
  const current = () => !signal?.aborted && active() && (target ? isCurrentDocumentTarget(target) : useDocumentsStore.getState().currentId === null);
  if (!current()) return 'stale';
  const parsed = parseLetterText(imported.plainText, `${imported.markings}\n${imported.source.retainedText}`);
  parsed.parsed = parsedWordFields(imported);
  const session = parsedLetterSession(parsed.parsed, docType, parsed.classification);
  // A missing source field is blank, never an example signer or organization.
  for (const key of ['ssic', 'serial', 'date', 'from', 'to', 'via', 'subject', 'unitLine1', 'unitLine2', 'unitAddress'] as const) {
    if (parsed.parsed[key] === undefined) session.formData[key] = '';
  }
  Object.assign(session.formData, { officeCode: '', pocEmail: '', sigRank: '', sigTitle: '',
    acting: false, actingTitle: '', seniorActing: false, juniorActing: false,
    byDirection: false, byDirectionAuthority: '', signatureType: 'none',
    salutation: '', complimentaryClose: '' });
  if (!parsed.parsed.signature) { session.formData.sigFirst = ''; session.formData.sigMiddle = ''; session.formData.sigLast = ''; }
  const paragraphs = imported.blocks;
  session.paragraphs = paragraphs.map(block => block.paragraph);
  session.formData.wordSource = { name: imported.source.name, sha256: imported.source.sha256, notices: imported.notices, retainedText: imported.source.retainedText };
  const assets: StoredAttachment[] = [];
  const stage = (name: string, type: string, bytes: Uint8Array): FileRef => {
    const asset: StoredAttachment = { id: newAttachmentId(), name, type, size: bytes.byteLength, data: bytes.buffer as ArrayBuffer };
    assets.push(asset);
    return { id: asset.id, name, type, size: asset.size };
  };
  session.formData.wordSource!.fileRef = stage(imported.source.name, WORD_DOCUMENT_TYPE, imported.source.bytes);
  const imageRefs = new Map<string, FileRef>();
  for (const block of paragraphs) {
    const key = wordImageResourceKey(result.word!, block.paragraph.id!);
    if (!key) continue;
    let ref = imageRefs.get(key);
    if (!ref) {
      const bytes = wordImageBytes(result.word!, block.paragraph.id!)!;
      ref = stage(block.paragraph.figure!.name!, block.paragraph.figure!.type!, bytes);
      imageRefs.set(key, ref);
    }
    block.paragraph.figure!.fileRef = ref;
  }
  const prepared = prepareDocument(session, true);
  return withAttachmentStaging(async () => {
    await flushDocumentWrites();
    if (!current()) return 'stale';
    const now = Date.now(), id = crypto.randomUUID();
    const saved = serializeDocumentSnapshot(copyPreparedDocument(prepared), now);
    const record: StoredDocument = { id, meta: { id, title: deriveTitle(saved), docType, updatedAt: now, nativeReviewText: true }, session: saved };
    const outcome = await idbInstallDocumentWithAssets(record, assets, current, signal);
    if (outcome === 'failed') throw new Error('The Word document and original files could not be saved. Your current draft is unchanged.');
    if (outcome === 'stale') return 'stale';
    return openCommittedDocument(prepared, record, target, current) === 'applied' ? 'applied' : 'stale';
  });
}

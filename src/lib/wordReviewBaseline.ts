import { copyWordImport, wordImageBytes, wordImageResourceKey, type WordBlock, type WordImport } from '@/services/docx/import/readWord';
import { readWordPrintedCounter } from '@/services/docx/import/printedCounter';
import { wordReviewStaticDigest } from '@/services/docx/review/staticContent';
import type { WordReviewIdentity } from '@/services/docx/review/identity';
import { supportsPlainTextRange } from './reviewTextRanges';
import { suggestionTargetValue } from './reviewSuggestions';
import { parseReviewRound, reviewPayloadDigest, type ReviewRound } from './reviewRounds';
import { wordReviewHandoffSchema, validWordReviewPrefix, type WordReviewHandoff, type WordReviewParagraphBinding } from './wordReviewModel';
import type { Paragraph } from '@/types/document';

function meaningful(block: WordBlock): boolean { return !!block.plainText.trim() || !!block.paragraph.header || !!block.paragraph.bodyTable || !!block.paragraph.figure; }
function ordinary(block: WordBlock): boolean { return !!block.paragraph.text.trim() && !block.paragraph.figure && !block.paragraph.bodyTable; }
function opaqueDigester(imported: WordImport, signal?: AbortSignal) {
  const images = new Map<string, string>();
  return async (block: WordBlock): Promise<string> => {
    signal?.throwIfAborted();
    const { id: _id, figure, ...paragraph } = block.paragraph;
    let image: { metadata: Omit<NonNullable<Paragraph['figure']>, 'name' | 'fileRef'>; sha256: string } | undefined;
    if (figure) {
      const key = block.paragraph.id && wordImageResourceKey(imported, block.paragraph.id);
      if (!key) throw new Error('A Word review image has no owned source resource.');
      let sha256 = images.get(key);
      if (!sha256) {
        const bytes = wordImageBytes(imported, block.paragraph.id!);
        if (!bytes) throw new Error('A Word review image is unavailable.');
        if (!(bytes.buffer instanceof ArrayBuffer)) throw new Error('A Word review image has unsupported shared memory.');
        sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
        images.set(key, sha256);
      }
      const { name: _name, fileRef: _fileRef, ...metadata } = figure;
      image = { metadata, sha256 };
    }
    signal?.throwIfAborted();
    return reviewPayloadDigest({ paragraph, plainText: block.plainText, numbered: Boolean(block.numbered), ...(image ? { image } : {}) });
  };
}
function nativeParagraph(round: ReviewRound, binding: WordReviewParagraphBinding): Paragraph {
  const matches = round.baseline.session.paragraphs.filter(paragraph => paragraph.id === binding.paragraphId);
  if (matches.length !== 1 || !suggestionTargetValue(round.baseline.session, { kind: 'paragraph', paragraphId: binding.paragraphId, docType: round.baseline.session.docType })
    || !validWordReviewPrefix(binding.prefix, matches[0])) throw new Error('The locally retained Word binding does not match its native baseline. Recover an intact review backup.');
  return matches[0];
}

/** Plan only from the immutable local baseline and an actually issued Word
 * parse of its approved derivative. No current draft or Word IDs grant authority.
 */
export async function buildWordReviewHandoff(roundInput: ReviewRound, importedInput: WordImport,
  metadata: { id: string; createdAt: number; docxSha256: string }, signal?: AbortSignal): Promise<{ receipt: WordReviewHandoff; sourceIndexes: number[] }> {
  signal?.throwIfAborted();
  const round = parseReviewRound(roundInput), imported = copyWordImport(importedInput);
  const blockDigest = opaqueDigester(importedInput, signal);
  if (!round.ownerDocumentId) throw new Error('Only the original local draft can issue a Word review copy.');
  const natives = round.baseline.session.paragraphs.filter(paragraph => paragraph.id && paragraph.text.trim()
    && suggestionTargetValue(round.baseline.session, { kind: 'paragraph', paragraphId: paragraph.id, docType: round.baseline.session.docType }));
  const projected = imported.blocks.filter(ordinary);
  if (!natives.length || natives.length !== projected.length) throw new Error('This Word layout cannot be matched completely to its native body paragraphs. Use a native reviewer copy or simplify the draft.');
  const bindings = new Map<number, WordReviewParagraphBinding>();
  for (const [index, paragraph] of natives.entries()) {
    signal?.throwIfAborted();
    const block = projected[index], raw = imported.sourceBlocks.filter(item => item.sourceIndex === block.sourceIndex && ordinary(item));
    if (raw.length !== 1 || !raw[0].paragraph.text.endsWith(paragraph.text)) throw new Error('The approved Word body differs from its exact native baseline. No review identity was issued.');
    const prefix = raw[0].paragraph.text.slice(0, raw[0].paragraph.text.length - paragraph.text.length);
    if (!validWordReviewPrefix(prefix, paragraph) || bindings.has(block.sourceIndex)) throw new Error('The Word paragraph mapping is ambiguous or changes its native heading/numbering.');
    const plainPrefixLength = supportsPlainTextRange(paragraph) && raw[0].plainText.endsWith(paragraph.text) ? raw[0].plainText.length - paragraph.text.length : block.nativeTextOffset ?? 0;
    bindings.set(block.sourceIndex, { kind: 'paragraph', sourceIndex: block.sourceIndex, paragraphId: paragraph.id!, prefix, plainPrefixLength,
      beforePlainDigest: await reviewPayloadDigest(raw[0].plainText) });
  }
  const blocks: WordReviewHandoff['blocks'] = [];
  for (const block of imported.sourceBlocks.filter(meaningful)) {
    const binding = ordinary(block) && bindings.get(block.sourceIndex);
    blocks.push(binding || { kind: 'opaque', sourceIndex: block.sourceIndex, digest: await blockDigest(block) });
  }
  const staticDigest = await wordReviewStaticDigest(imported.source.bytes, signal);
  const receipt = wordReviewHandoffSchema.parse({ version: 1, ...metadata, staticDigest, blocks });
  signal?.throwIfAborted();
  if (receipt.createdAt < round.createdAt) throw new Error('The Word review copy predates its native baseline.');
  return { receipt, sourceIndexes: receipt.blocks.filter(block => block.kind === 'paragraph').map(block => block.sourceIndex) };
}

export interface MatchedWordReviewParagraph { paragraphId: string; sourceIndex: number; plainPrefixLength: number; expected: string; proposed: string }
/** The locator only finds a retained receipt. Every mapped node still has to
 * occupy its original structural slot and match that local native authority.
 */
export async function matchWordReviewHandoff(roundInput: ReviewRound, identity: WordReviewIdentity,
  importedInput: WordImport, ownerDocumentId: string, signal?: AbortSignal): Promise<MatchedWordReviewParagraph[]> {
  signal?.throwIfAborted();
  const round = parseReviewRound(roundInput), imported = copyWordImport(importedInput), evidence = structuredClone(identity);
  const blockDigest = opaqueDigester(importedInput, signal);
  if (imported.trackedChangesIncomplete !== false) throw new Error('This Word return includes unsupported or unassessed tracked changes. Keep the file for manual review.');
  const receipt = round.wordHandoffs?.find(item => item.id === evidence.locator.handoffId);
  if (!receipt) throw new Error('This Word return has no authoritative locally issued copy. Keep it for manual review.');
  if (!round.ownerDocumentId || round.ownerDocumentId !== ownerDocumentId || evidence.locator.roundId !== round.id
    || evidence.locator.baselineDigest !== round.baselineDigest || evidence.locator.handoffId !== receipt.id) throw new Error('This Word return does not match an issued copy owned by the open native draft.');
  if (await wordReviewStaticDigest(imported.source.bytes, signal) !== receipt.staticDigest) throw new Error('The Word return changes a protected hyperlink, drawing or header/footer content or field instructions. Review those changes manually.');
  const blocks = imported.sourceBlocks.filter(meaningful), bindings = receipt.blocks.filter(block => block.kind === 'paragraph');
  if (blocks.length !== receipt.blocks.length || evidence.markers.length !== bindings.length) throw new Error('The Word return changes paragraph boundaries or has missing review markers. Keep it for manual review.');
  const edits = new Map((imported.trackedEdits ?? []).map(edit => [edit.sourceIndex, edit]));
  if ([...edits.keys()].some(sourceIndex => !bindings.some(binding => binding.sourceIndex === sourceIndex))) throw new Error('The Word return changes an unmapped field or structural block through tracked edits. Review it manually.');
  const result: MatchedWordReviewParagraph[] = [];
  let ordinal = 0;
  for (const [index, retained] of receipt.blocks.entries()) {
    signal?.throwIfAborted();
    const block = blocks[index];
    if (retained.kind === 'opaque') {
      if (await blockDigest(block) !== retained.digest) throw new Error('The returned Word file changes an unmapped field, table, image or heading. Review those changes manually.');
      continue;
    }
    const marker = evidence.markers[ordinal];
    if (marker.ordinal !== ordinal++ || marker.sourceIndex !== block.sourceIndex || !ordinary(block)) throw new Error('The returned Word paragraph identities are missing, moved or ambiguous.');
    const paragraph = nativeParagraph(round, retained), edit = edits.get(block.sourceIndex);
    if (edit && (edit.before !== retained.prefix + paragraph.text || await reviewPayloadDigest(edit.beforePlain) !== retained.beforePlainDigest)) throw new Error('The Word tracked-edit baseline differs from the exact copy that was sent. Nothing was applied.');
    const proposed = edit?.proposed ?? block.paragraph.text;
    if (!proposed.startsWith(retained.prefix)) throw new Error('A returned edit changes a printed paragraph label or heading. Review it manually.');
    const text = proposed.slice(retained.prefix.length);
    if (text.length > 20_000) throw new Error('A returned Word paragraph exceeds the native 20,000-character review limit.');
    if (!retained.prefix && readWordPrintedCounter(text) && !readWordPrintedCounter(paragraph.text)) throw new Error('A returned text edit introduces a new printed paragraph label. Review the structure manually.');
    result.push({ paragraphId: retained.paragraphId, sourceIndex: block.sourceIndex, plainPrefixLength: retained.plainPrefixLength, expected: paragraph.text, proposed: text });
  }
  signal?.throwIfAborted();
  return result;
}

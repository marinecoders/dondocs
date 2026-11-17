import { buildDraftFileFromSnapshot, parseDraftFile } from './draftFile';
import { parseReviewRound, reviewPayloadDigest, type ReviewRound } from './reviewRounds';
import { appendReviewSuggestions, createReviewSuggestion, emptyReviewSuggestionState, REVIEW_SUGGESTION_LIMITS } from './reviewSuggestions';
import { reviewSuggestionRecordSchema, type ReviewSuggestionRecord } from './reviewSuggestionWrites';
import { serializeDocumentSnapshot } from './documentSerialization';
import { supportsReviewComments } from './reviewCommentTargets';
import type { DocumentSnapshot } from '@/stores/historyStore';
import type { StoredAttachment } from './documentsDb';
import type { WordImport } from '@/services/docx/import/readWord';
import { readWordPrintedCounter } from '@/services/docx/import/printedCounter';
import { clip } from '@/services/docx/import/readTrackedChanges';

export interface ImportedWordReview { round: ReviewRound; suggestions: ReviewSuggestionRecord }
const MAX_EXPANDED_RESOURCE_BYTES = 32 * 1024 * 1024;

function mappedWordEdits(imported: WordImport, snapshot: Pick<DocumentSnapshot, 'paragraphs'>) {
  return (imported.trackedEdits ?? []).flatMap(edit => {
    const blocks = imported.blocks.filter(block => block.sourceIndex === edit.sourceIndex && !block.paragraph.figure && !block.paragraph.bodyTable);
    if (blocks.length !== 1) return [];
    const block = blocks[0], matches = snapshot.paragraphs.filter(paragraph => paragraph.id === block.paragraph.id);
    if (matches.length !== 1) return [];
    const paragraph = matches[0];
    if (!paragraph.id || paragraph.header || paragraph.figure || paragraph.bodyTable || !paragraph.text.trim() || !edit.before.endsWith(paragraph.text)) return [];
    const prefix = edit.before.slice(0, edit.before.length - paragraph.text.length);
    if (!edit.proposed.startsWith(prefix)) return [];
    const proposed = edit.proposed.slice(prefix.length);
    // A previously unnumbered source must not acquire a new printed native
    // designator through what is presented as a body-text replacement.
    if (!prefix && readWordPrintedCounter(proposed) && !readWordPrintedCounter(paragraph.text)) return [];
    if (proposed === paragraph.text) return [];
    return [{ edit, paragraphId: paragraph.id, expected: paragraph.text, proposed }];
  });
}

function wordReviewPlan(imported: WordImport, snapshot: Pick<DocumentSnapshot, 'paragraphs'>) {
  const mapped = mappedWordEdits(imported, snapshot).map(change => {
    const authors = [...new Set(change.edit.revisions.map(revision => revision.author?.trim()).filter((author): author is string => !!author))];
    const evidence = change.edit.revisions.map(revision => `${revision.kind} ${revision.id}${revision.author ? ` by ${revision.author}` : ''}${revision.date ? ` dated ${revision.date}` : ''}`).join('; ');
    const metadata = {
      author: authors.length === 1 ? `${clip(authors[0], 75)} (Word, unverified)` : 'Word reviewers (unverified)',
      label: 'Word tracked paragraph text', category: 'edit' as const,
      origin: { kind: 'manual' as const, rule: 'word-tracked-text', context: clip(`Source SHA-256 ${imported.source.sha256}. Word metadata is unverified: ${evidence}. Complete records remain in the original.`, 500) },
    };
    return { ...change, metadata };
  });
  const characters = mapped.reduce((total, item) => total + item.expected.length + item.proposed.length
    + item.metadata.author.length + item.metadata.label.length + item.metadata.origin.rule.length + item.metadata.origin.context.length, 0);
  const limited = mapped.length > REVIEW_SUGGESTION_LIMITS.proposals || characters > REVIEW_SUGGESTION_LIMITS.totalCharacters;
  return { selected: limited ? [] : mapped, limited, unmapped: (imported.trackedEdits?.length ?? 0) - mapped.length };
}

export function wordTrackedReviewSummary(imported: WordImport, snapshot: Pick<DocumentSnapshot, 'paragraphs'>): { detected: number; proposals: number; notices: string[] } {
  const { selected, limited, unmapped } = wordReviewPlan(imported, snapshot), notices: string[] = [];
  if (unmapped) notices.push('Some tracked Word text belongs to mapped letter fields, headings, spacing or changed printed numbering. Those revisions remain in the original file and were not converted to native proposals.');
  if (limited) notices.push('Tracked Word text and its metadata exceed the native review limit. No proposals were created; the baseline and original file are preserved.');
  if (selected.length) notices.push(`Imported Word tracked text: ${selected.length} native paragraph proposal${selected.length === 1 ? '' : 's'} in Reviews. The imported draft shows the baseline until you accept an edit; Word authors and dates are unverified.`);
  return { detected: imported.trackedEdits?.length ?? 0, proposals: selected.length, notices };
}

export function wordTrackedReviewNotices(imported: WordImport, snapshot: Pick<DocumentSnapshot, 'paragraphs'>): string[] {
  return wordTrackedReviewSummary(imported, snapshot).notices;
}

/** This is an exact new native baseline, not approval of a Word identity. Only
 * source-index mappings whose complete before text matches the projected native
 * paragraph can become ordinary native paragraph replacements. */
export async function prepareWordTrackedReview(imported: WordImport, snapshot: DocumentSnapshot, documentId: string, createdAt: number,
  assets: readonly StoredAttachment[], signal?: AbortSignal): Promise<ImportedWordReview | undefined> {
  if (!imported.trackedEdits?.length) return;
  const owned = structuredClone(snapshot), sourceName = imported.source.name;
  const { selected } = wordReviewPlan(imported, owned);
  if (!selected.length) return;
  if (!supportsReviewComments(owned)) throw new Error('Word tracked text requires a native correspondence document. Keep the original and choose a supported letter layout.');
  signal?.throwIfAborted();
  const resources = new Map(assets.map(asset => [asset.id, asset]));
  const references = [owned.formData.wordSource?.fileRef, ...owned.paragraphs.map(paragraph => paragraph.figure?.fileRef)].filter(ref => ref !== undefined);
  let expandedBytes = 0;
  for (const ref of references) {
    const asset = resources.get(ref.id);
    if (!asset || asset.size !== asset.data.byteLength) throw new Error('A Word review source resource is missing or inconsistent. Nothing was imported.');
    expandedBytes += asset.size;
    if (expandedBytes > MAX_EXPANDED_RESOURCE_BYTES) throw new Error('The Word review baseline exceeds its 32 MB expanded resource limit. Reduce repeated images before importing tracked text.');
  }
  // Reuse the complete portable-draft serializer before the single commit.
  // The resource reader sees only this import's owned, still-uncommitted bytes.
  const draft = await buildDraftFileFromSnapshot(owned, createdAt, async id => resources.get(id)?.data.slice(0) ?? null);
  parseDraftFile(draft, false, true);
  const baselineDigest = await reviewPayloadDigest(draft);
  signal?.throwIfAborted();
  const round = parseReviewRound({ kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt, label: clip(`Word tracked text: ${sourceName}`, 120), sourceDocumentId: documentId, ownerDocumentId: documentId,
    baselineDigest, baseline: { ts: createdAt, session: serializeDocumentSnapshot(owned, createdAt) } });
  const proposals = selected.map(({ metadata, paragraphId, proposed }) => createReviewSuggestion(round, {
    ...metadata, changes: [{ target: { kind: 'paragraph', paragraphId, docType: owned.docType }, proposed }],
  }));
  const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), proposals);
  return { round, suggestions: reviewSuggestionRecordSchema.parse({ documentId, state }) };
}

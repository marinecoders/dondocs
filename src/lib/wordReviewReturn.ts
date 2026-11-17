import { getExportDeploymentPolicy } from '@/config/classification';
import { readWordDocument, copyWordImport, type WordImport } from '@/services/docx/import/readWord';
import { readWordReviewIdentity, type WordReviewIdentity } from '@/services/docx/review/identity';
import { captureDocumentTarget, isCurrentDocumentTarget, type DocumentTarget } from '@/stores/documentsStore';
import { assertRetainedTextPolicy } from './retainedDocumentTextPolicy';
import { matchWordReviewHandoff, type MatchedWordReviewParagraph } from './wordReviewBaseline';
import { parseReviewRound, readReviewRound, reviewPayloadDigest, type ReviewRound } from './reviewRounds';
import { nativeWordComments } from './wordComments';
import { reviewCommentsSchema, reviewCommentsVersion, type ReviewComments } from './reviewComments';
import { createReviewSuggestion, createSelectedTextSuggestion, validateReviewSuggestion, type ReviewSuggestion } from './reviewSuggestions';
import { isTextRangeBoundary, supportsPlainTextRange } from './reviewTextRanges';
import { applyReviewReturn, createCheckedReviewReturn, prepareReviewReturnImport, reviewReturnPlan, type PreparedReviewReturnImport } from './reviewReturnActions';
import type { ReviewReturnChoice } from './reviewCommentMerge';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ReviewReturn } from './reviewReturns';

function current(target: DocumentTarget | null): asserts target is DocumentTarget {
  if (!target || !isCurrentDocumentTarget(target)) throw new Error('The draft changed. Review the returned Word file again.');
}
async function stableUuid(key: unknown): Promise<string> {
  const hex = await reviewPayloadDigest(key);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function splice(before: string, after: string) {
  const boundaries = (text: string) => new Set([0, text.length, ...Array.from(new Intl.Segmenter('en', { granularity: 'word' }).segment(text), segment => segment.index)]);
  const beforeBoundaries = boundaries(before), afterBoundaries = boundaries(after);
  let start = 0, suffix = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (start > 0 && (!isTextRangeBoundary(before, start) || !isTextRangeBoundary(after, start) || !beforeBoundaries.has(start) || !afterBoundaries.has(start))) start--;
  while (suffix < Math.min(before.length, after.length) - start && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  while (suffix > 0 && (!isTextRangeBoundary(before, before.length - suffix) || !isTextRangeBoundary(after, after.length - suffix) || !beforeBoundaries.has(before.length - suffix) || !afterBoundaries.has(after.length - suffix))) suffix--;
  return { start, end: before.length - suffix, proposed: after.slice(start, after.length - suffix) };
}
async function proposals(round: ReviewRound, mapped: readonly MatchedWordReviewParagraph[], key: string, createdAt: number): Promise<ReviewSuggestion[]> {
  const result: ReviewSuggestion[] = [];
  for (const item of mapped) {
    if (item.expected === item.proposed) continue;
    const paragraph = round.baseline.session.paragraphs.find(paragraph => paragraph.id === item.paragraphId)!;
    const plain = supportsPlainTextRange(paragraph) && supportsPlainTextRange({ ...paragraph, text: item.proposed });
    const proposal = plain ? createSelectedTextSuggestion(round, { author: 'Word reviewer (unverified)', label: 'Returned Word text',
      paragraphId: item.paragraphId, ...splice(item.expected, item.proposed), category: 'edit' })
      : createReviewSuggestion(round, { author: 'Word reviewer (unverified)', label: 'Returned Word text', category: 'edit',
        changes: [{ target: { kind: 'paragraph', paragraphId: item.paragraphId, docType: round.baseline.session.docType }, proposed: item.proposed }] });
    proposal.id = `proposal_${await stableUuid([key, item.paragraphId, 'proposal'])}`;
    proposal.createdAt = createdAt;
    proposal.origin = { kind: 'manual', rule: 'word-review-return', context: `Returned Word handoff/source ${key}. Word markers and reviewer metadata are editable, unverified matching evidence; the baseline is retained locally.` };
    proposal.changes[0].id = await stableUuid([key, item.paragraphId, 'change']);
    result.push(validateReviewSuggestion(round, proposal));
  }
  return result;
}
async function comments(round: ReviewRound, imported: WordImport, mapped: readonly MatchedWordReviewParagraph[], key: string, createdAt: number): Promise<ReviewComments | undefined> {
  const bySource = new Map(mapped.map(item => [item.sourceIndex, item]));
  const adapted = { ...imported, blocks: imported.blocks.map(block => {
    const binding = bySource.get(block.sourceIndex);
    return binding && !block.paragraph.figure && !block.paragraph.bodyTable
      ? { ...block, paragraph: { ...block.paragraph, id: binding.paragraphId }, nativeTextOffset: binding.plainPrefixLength } : block;
  }) };
  const converted = nativeWordComments(adapted, round.baseline.session);
  const threads = structuredClone(round.baseline.session.reviewComments?.threads ?? []);
  for (const [index, thread] of (converted?.threads ?? []).entries()) {
    thread.id = await stableUuid([key, 'comment', index]);
    for (const [messageIndex, message] of thread.messages.entries()) {
      message.id = await stableUuid([key, 'comment', index, messageIndex]);message.createdAt = new Date(createdAt).toISOString();
    }
    threads.push(thread);
  }
  return threads.length ? reviewCommentsSchema.parse({ version: reviewCommentsVersion(threads), threads }) : undefined;
}

/** Pure conversion after the exact issued-copy matcher. No draft is written. */
export async function buildWordReviewReturn(round: ReviewRound, identity: WordReviewIdentity, input: WordImport,
  documentId: string, policy: PolicyResolution, signal?: AbortSignal): Promise<ReviewReturn> {
  round = parseReviewRound(round);identity = structuredClone(identity);
  const imported = copyWordImport(input), mapped = await matchWordReviewHandoff(round, identity, input, documentId, signal);
  assertRetainedTextPolicy([imported.source.name, imported.source.retainedText], policy);
  const receipt = round.wordHandoffs!.find(item => item.id === identity.locator.handoffId)!;
  const key = `${receipt.id}:${imported.source.sha256}`, createdAt = receipt.createdAt;
  if (mapped.filter(item => item.expected !== item.proposed).length > 100) throw new Error('A Word return supports up to 100 paragraph text proposals. Split this review before importing.');
  const suggestions = await proposals(round, mapped, key, createdAt), discussions = await comments(round, imported, mapped, key, createdAt);
  signal?.throwIfAborted();
  return createCheckedReviewReturn(round, { id: `return_${await stableUuid([key, 'return'])}`, createdAt, comments: discussions, proposals: suggestions }, policy);
}

export interface PreparedWordReviewReturn {
  readonly native: PreparedReviewReturnImport;
  readonly name: string;
  readonly sha256: string;
  readonly notices: readonly string[];
}
const preparedReturns = new WeakMap<PreparedWordReviewReturn, { target: DocumentTarget; retainedText: string; name: string; policyIdentity: string; roundId: string; handoffId: string; receiptDigest: string }>();
export async function prepareWordReviewReturn(bytes: Uint8Array, name: string, signal?: AbortSignal): Promise<PreparedWordReviewReturn> {
  const target = captureDocumentTarget();current(target);
  const imported = await readWordDocument(bytes, name, signal);current(target);
  const identity = await readWordReviewIdentity(imported.source.bytes, signal);current(target);
  const round = await readReviewRound(identity.locator.roundId);current(target);
  if (!round) throw new Error('The original locally retained review baseline is unavailable. Keep the Word file for manual review.');
  const policy = await getExportDeploymentPolicy(undefined, true);current(target);
  if (policy.status !== 'ready') throw new Error(policy.message);
  const payload = await buildWordReviewReturn(round, identity, imported, target.scope.documentId, policy, signal);current(target);
  const native = await prepareReviewReturnImport(payload);current(target);signal?.throwIfAborted();
  const result: PreparedWordReviewReturn = Object.freeze({ native, name: imported.source.name, sha256: imported.source.sha256,
    notices: Object.freeze(['Only matched body text and comments become native feedback. Word page layout and unsupported formatting are not applied; supported bold, italic and underline use native text formatting; structural, field, table, image and header/footer content changes require manual review.',
      'Word authors, dates and markers are unverified. Newer draft text stays in place; imported text edits remain pending suggestions.',
      'Keep the returned Word file separately. DonDocs saves converted feedback and its receipt, not the original returned file or all of its Word metadata.', ...imported.notices]) });
  preparedReturns.set(result, { target, retainedText: imported.source.retainedText, name: imported.source.name, policyIdentity: policy.policy.identity,
    roundId: round.id, handoffId: identity.locator.handoffId, receiptDigest: await reviewPayloadDigest(round.wordHandoffs!.find(item => item.id === identity.locator.handoffId)!) });
  current(target);signal?.throwIfAborted();
  return result;
}
export function wordReviewReturnPlan(prepared: PreparedWordReviewReturn, choices: Readonly<Record<string, ReviewReturnChoice>>) {
  const owned = preparedReturns.get(prepared);
  if (!owned) throw new Error('Review this Word return again.');current(owned.target);
  return reviewReturnPlan(prepared.native, choices);
}
export async function applyWordReviewReturn(prepared: PreparedWordReviewReturn, choices: Readonly<Record<string, ReviewReturnChoice>>) {
  const owned = preparedReturns.get(prepared);
  if (!owned) throw new Error('Review this Word return again.');current(owned.target);
  const policy = await getExportDeploymentPolicy(undefined, true);current(owned.target);
  if (policy.status !== 'ready' || policy.policy.identity !== owned.policyIdentity) throw new Error('The deployment policy changed. Review this Word return again before importing.');
  assertRetainedTextPolicy([owned.name, owned.retainedText], policy);
  const round = await readReviewRound(owned.roundId);current(owned.target);
  const receipt = round?.wordHandoffs?.find(item => item.id === owned.handoffId);
  if (!round || round.ownerDocumentId !== owned.target.scope.documentId || !receipt || await reviewPayloadDigest(receipt) !== owned.receiptDigest) throw new Error('The locally issued Word handoff is no longer available or changed. Review the file again.');
  current(owned.target);
  return applyReviewReturn(prepared.native, choices);
}

import { z } from 'zod';
import { PUBLICATION_SECTIONS, type PublicationSection } from '@/data/techpub/sections';
import type { Paragraph } from '@/types/document';
import type { SerializedSession } from '@/stores/documentStore';
import { outlineParagraphs } from '@/services/latex/paragraphLabel';
import { canonicalReviewPayload } from './reviewRounds';
import { paragraphCommentIds, paragraphIdSchema, validateParagraphIds } from './paragraphIdentity';
import { supportsReviewComments, paragraphCommentContext } from './reviewCommentTargets';
import { isTextRangeBoundary, supportsPlainTextRange } from './reviewTextRanges';
import { normalizeLevels } from './paragraphUtils';
import { splitReviewParagraph, joinReviewParagraphs } from './reviewStructureFormatting';
import { mapStructuralRangeComments, type StructuralRangeSpan, transformRangeComments } from './reviewCommentRanges';

const text = z.string().max(20_000);
const fileRef = z.object({ id: z.string().min(1).max(200), name: text, size: z.number().int().nonnegative(), type: text }).strict();
/** Full native nodes, including marks and resource handles; never a session restore. */
export const reviewStructureParagraphSchema = z.object({
  id: paragraphIdSchema, text, level: z.number().int().min(0).max(10), header: text.optional(),
  portionMarking: z.enum(['U', 'CUI', 'C', 'S', 'TS', 'FOUO']).optional(),
  referenceId: text.optional(), publicationSection: z.enum(Object.keys(PUBLICATION_SECTIONS) as [PublicationSection, ...PublicationSection[]]).optional(),
  tableKey: text.optional(), tableIdentifierMode: z.enum(['stock', 'software']).optional(),
  tableFootnotes: z.array(z.object({ id: text, text }).strict()).max(100).optional(),
  callout: z.enum(['warning', 'caution', 'note']).optional(), procedure: z.boolean().optional(), appendix: z.boolean().optional(),
  figure: z.object({ fileRef: fileRef.optional(), name: text.optional(), type: text.optional(), width: z.number().optional(), height: z.number().optional(),
    portionMarking: z.enum(['U', 'CUI', 'C', 'S', 'TS', 'FOUO']).optional() }).strict().optional(),
}).strict();
const boundary = z.object({ id: paragraphIdSchema, level: z.number().int().min(0).max(10) }).strict().nullable();
const common = { before: z.array(reviewStructureParagraphSchema).max(100), after: z.array(reviewStructureParagraphSchema).max(100),
  gap: z.object({ before: boundary, after: boundary }).strict(), parentId: paragraphIdSchema.nullable() };
export const reviewStructureOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('insert-paragraph'), ...common }).strict(),
  z.object({ kind: z.literal('delete-paragraph'), ...common }).strict(),
  z.object({ kind: z.literal('split-paragraph'), ...common, splitAt: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('join-paragraphs'), ...common, separator: z.enum(['', ' ']) }).strict(),
]);
export const reviewStructureTargetSchema = z.object({ kind: z.literal('structure'), docType: z.string().min(1).max(100), operation: reviewStructureOperationSchema }).strict();
export type ReviewStructureTarget = z.infer<typeof reviewStructureTargetSchema>;
export type ReviewStructureOperation = ReviewStructureTarget['operation'];
const same = (left: unknown, right: unknown) => canonicalReviewPayload(left) === canonicalReviewPayload(right);
export function structureSuggestionText(paragraphs: readonly Paragraph[]): string {
  return paragraphs.map(paragraphCommentContext).join('\n\n');
}
export function structureSuggestionLabel(target: ReviewStructureTarget): string {
  return ({ 'insert-paragraph': 'Insert paragraph', 'delete-paragraph': 'Delete paragraph', 'split-paragraph': 'Split paragraph', 'join-paragraphs': 'Join paragraphs' })[target.operation.kind];
}
export function structureOperationIds(target: ReviewStructureTarget): string[] {
  return [...new Set([...target.operation.before, ...target.operation.after].map(paragraph => paragraph.id)
    .concat([target.operation.gap.before?.id, target.operation.gap.after?.id, target.operation.parentId].filter((id): id is string => !!id)))];
}
export function structureNewIds(target: ReviewStructureTarget): string[] {
  return target.operation.after.filter(paragraph => !target.operation.before.some(before => before.id === paragraph.id)).map(paragraph => paragraph.id);
}
function parentId(paragraphs: readonly Paragraph[], index: number): string | null {
  const outline = outlineParagraphs(paragraphs.map(paragraph => paragraph.level));
  const parent = outline[index]?.parentIndex;
  return parent === null || parent === undefined ? null : paragraphs[parent].id ?? null;
}
function assertOutline(paragraphs: Paragraph[]): void {
  if (normalizeLevels(paragraphs).some((paragraph, index) => paragraph.level !== paragraphs[index].level)) throw new Error('This operation would create invalid paragraph nesting.');
}
function assertOperation(target: ReviewStructureTarget): void {
  const operation = target.operation;
  if (operation.kind === 'insert-paragraph') {
    const paragraph = operation.after[0];
    if (operation.before.length !== 0 || operation.after.length !== 1 || !paragraph
      || Object.keys(paragraph).some(key => !['id', 'text', 'level'].includes(key)) || !supportsPlainTextRange(paragraph)
      || !paragraph.text.trim() || !isTextRangeBoundary(paragraph.text, 0) || !isTextRangeBoundary(paragraph.text, paragraph.text.length)) throw new Error('Insert one nonempty plain native paragraph. Formatting, variables and structured blocks are not supported for new paragraphs.');
  } else if (operation.kind === 'delete-paragraph') {
    if (operation.before.length !== 1 || operation.after.length !== 0) throw new Error('Delete exactly one leaf paragraph.');
    const paragraph = operation.before[0];
    if (paragraph.figure || paragraph.tableKey || paragraph.tableIdentifierMode || paragraph.tableFootnotes?.length
      || paragraph.callout || paragraph.procedure || paragraph.appendix || paragraph.publicationSection)
      throw new Error('Structured paragraphs require resource-aware structural review. Keep the paragraph and add a comment describing the deletion.');
  } else if (operation.kind === 'split-paragraph') {
    if (operation.before.length !== 1 || operation.after.length !== 2 || operation.after[1].id === operation.before[0].id
      || !same(operation.after, splitReviewParagraph(operation.before[0], operation.splitAt, operation.after[1].id)))
      throw new Error('A split must preserve the exact paragraph properties, formatting and generated identity.');
  } else if (operation.before.length !== 2 || operation.after.length !== 1
    || !same(operation.after, [joinReviewParagraphs(operation.before[0], operation.before[1], operation.separator)]))
    throw new Error('A join must preserve both exact adjacent paragraphs and their supported properties.');
}
/** Locate an exact gap/span by stable IDs. Neighbor text edits survive; moved,
 * removed, indented or interposed neighbors invalidate the captured operation. */
function locate(source: SerializedSession, target: ReviewStructureTarget, direction: 'forward' | 'reverse'): { start: number; before: Paragraph[]; after: Paragraph[] } {
  if (!supportsReviewComments(source) || source.docType !== target.docType) throw new Error('This structure belongs to another document type.');
  validateParagraphIds(source.paragraphs);
  if (source.paragraphs.some(paragraph => !paragraph.id)) throw new Error('Paragraph identities are required.');
  assertOutline(source.paragraphs);
  const operation = target.operation;
  const before = direction === 'forward' ? operation.before : operation.after;
  const after = direction === 'forward' ? operation.after : operation.before;
  const left = operation.gap.before;
  const start = left === null ? 0 : source.paragraphs.findIndex(paragraph => paragraph.id === left.id) + 1;
  if (left && (start === 0 || source.paragraphs[start - 1].level !== left.level)) throw new Error('The paragraph before this change moved or was removed.');
  if (!same(source.paragraphs.slice(start, start + before.length), before)) throw new Error('The captured paragraph changed or moved.');
  const right = source.paragraphs[start + before.length], expectedRight = operation.gap.after;
  if (expectedRight === null ? !!right : right?.id !== expectedRight.id || right?.level !== expectedRight.level)
    throw new Error('The paragraph after this change moved or was removed.');
  const replacement = [...source.paragraphs.slice(0, start), ...after, ...source.paragraphs.slice(start + before.length)];
  if (!replacement.length) throw new Error('Keep at least one paragraph in the document.');
  assertOutline(replacement);
  const parents = (paragraphs: readonly Paragraph[]) => {
    const outline = outlineParagraphs(paragraphs.map(paragraph => paragraph.level));
    return new Map(paragraphs.map((paragraph, index) => [paragraph.id, outline[index].parentIndex === null ? null : paragraphs[outline[index].parentIndex!].id ?? null]));
  };
  const sourceParents = parents(source.paragraphs), nextParents = parents(replacement);
  const affected = before.length ? sourceParents.get(before[0].id) : nextParents.get(after[0]?.id);
  if (affected !== operation.parentId) throw new Error('The captured paragraph parent changed.');
  // Add/delete operates only on a leaf. Inserting ahead of a child cannot steal it.
  if (before.length && source.paragraphs[start + before.length]?.level > before[before.length - 1].level
    || after.length && replacement[start + after.length]?.level > after[after.length - 1].level)
    throw new Error('This change would delete or reparent child paragraphs. Choose a leaf paragraph or another position.');
  // Every surviving node must retain its parent; numbering itself is derived.
  for (let index = 0; index < source.paragraphs.length; index++) {
    const paragraph = source.paragraphs[index];
    if (before.some(item => item.id === paragraph.id)) continue;
    if (sourceParents.get(paragraph.id) !== nextParents.get(paragraph.id)) throw new Error('This change would reparent unrelated paragraphs.');
  }
  return { start, before, after };
}
/** Semantic validation precedes scoped mutation; after nodes never authorize a
 * general array replacement. New operation kinds must prove their own derivation. */
export function validateReviewStructureTarget(baseline: SerializedSession, input: ReviewStructureTarget): ReviewStructureTarget {
  const target = reviewStructureTargetSchema.parse(input);
  assertOperation(target);
  locate(baseline, target, 'forward');
  const reserved = new Set([...baseline.paragraphs.map(paragraph => paragraph.id), ...paragraphCommentIds(baseline.reviewComments)]);
  for (const id of structureNewIds(target)) if (reserved.has(id)) throw new Error('The new paragraph identity is already reserved by document content or discussion history.');
  return target;
}
/** Validate applicability before deriving a writable document or discussion mappings. */
function prepareReviewStructure(source: SerializedSession, input: ReviewStructureTarget, direction: 'forward' | 'reverse', reservedIds: readonly string[], historyReplay: boolean) {
  const target = reviewStructureTargetSchema.parse(input);assertOperation(target);
  const { start, before, after } = locate(source, target, direction);
  const retained = new Set(before.map(paragraph => paragraph.id));
  const occupied = new Set([...source.paragraphs.map(paragraph => paragraph.id), ...paragraphCommentIds(source.reviewComments), ...reservedIds]);
  for (const paragraph of after) if (!retained.has(paragraph.id) && occupied.has(paragraph.id)
    // An inverse deletion restores the exact captured ID and discussions; never
    // use the inverse outside a tagged, independently verified history action.
    && !((direction === 'reverse' && ['delete-paragraph', 'join-paragraphs'].includes(target.operation.kind) || historyReplay && direction === 'forward' && structureNewIds(target).includes(paragraph.id!))
      && !source.paragraphs.some(current => current.id === paragraph.id))) throw new Error('The new paragraph identity is already reserved.');
  return { target, start, before, after };
}
export function applyReviewStructure(source: SerializedSession, input: ReviewStructureTarget, direction: 'forward' | 'reverse' = 'forward', reservedIds: readonly string[] = [], historyReplay = false): SerializedSession {
  const { target, start, before, after } = prepareReviewStructure(source, input, direction, reservedIds, historyReplay);
  const session = structuredClone(source);
  session.paragraphs.splice(start, before.length, ...structuredClone(after));
  const spans = structureRangeSpans(target);
  if (spans.length) {
    const mapping = direction === 'forward' ? spans : spans.map(span => ({ fromParagraphId: span.toParagraphId, fromStart: span.toStart,
      fromEnd: span.toStart + span.fromEnd - span.fromStart, toParagraphId: span.fromParagraphId, toStart: span.fromStart }));
    const comments = mapStructuralRangeComments(session.reviewComments, before, after, mapping);
    if (comments) session.reviewComments = comments;
  }
  for (const paragraph of before) if (!after.some(item => item.id === paragraph.id)) {
    const comments = transformRangeComments(session.reviewComments, paragraph, { ...paragraph, id: undefined });
    if (comments) session.reviewComments = comments;
  }
  return session;
}
/** Proposal/import preflight checks identity reservations even when position is stale. */
export function assertReviewStructureNewIdsAvailable(source: SerializedSession, target: ReviewStructureTarget, reservedIds: readonly string[] = []): void {
  const occupied = new Set([...source.paragraphs.map(paragraph => paragraph.id), ...paragraphCommentIds(source.reviewComments), ...reservedIds]);
  if (structureNewIds(target).some(id => occupied.has(id))) throw new Error('The new paragraph identity is already reserved by current content, history or another review operation.');
}
export function inspectReviewStructure(source: SerializedSession, target: ReviewStructureTarget, direction: 'forward' | 'reverse' = 'forward', reservedIds: readonly string[] = []): boolean {
  try { prepareReviewStructure(source, target, direction, reservedIds, false);return true; } catch { return false; }
}
/** Capture once; callers retain the generated new ID when submitting/retrying. */
export type CaptureReviewStructureInput = { kind: 'insert-paragraph'; index: number; text: string; level: number; paragraphId?: string }
  | { kind: 'delete-paragraph'; paragraphId: string }
  | { kind: 'split-paragraph'; paragraphId: string; splitAt: number; newParagraphId?: string }
  | { kind: 'join-paragraphs'; paragraphId: string; nextParagraphId: string; separator: '' | ' ' };
export function captureReviewStructure(source: SerializedSession, input: CaptureReviewStructureInput): ReviewStructureTarget {
  const index = input.kind === 'insert-paragraph' ? input.index : source.paragraphs.findIndex(paragraph => paragraph.id === input.paragraphId);
  if (!Number.isInteger(index) || index < 0 || index > source.paragraphs.length || input.kind !== 'insert-paragraph' && index === source.paragraphs.length) throw new Error('Choose a current stable paragraph or insertion position.');
  const before = input.kind === 'insert-paragraph' ? [] : structuredClone(source.paragraphs.slice(index, index + (input.kind === 'join-paragraphs' ? 2 : 1)));
  if (input.kind === 'join-paragraphs' && before[1]?.id !== input.nextParagraphId) throw new Error('Explicitly select two adjacent paragraphs. Their descendants cannot be joined.');
  const after = input.kind === 'insert-paragraph' ? [{ id: input.paragraphId ?? crypto.randomUUID(), text: input.text, level: input.level }]
    : input.kind === 'split-paragraph' ? splitReviewParagraph(before[0], input.splitAt, input.newParagraphId ?? crypto.randomUUID())
      : input.kind === 'join-paragraphs' ? [joinReviewParagraphs(before[0], before[1], input.separator)] : [];
  const boundaryOf = (paragraph: Paragraph | undefined) => paragraph ? { id: paragraph.id!, level: paragraph.level } : null;
  const next = [...source.paragraphs.slice(0, index), ...after, ...source.paragraphs.slice(index + before.length)];
  const common = { before: before as ReviewStructureOperation['before'], after: after as ReviewStructureOperation['after'],
    gap: { before: boundaryOf(source.paragraphs[index - 1]), after: boundaryOf(source.paragraphs[index + before.length]) }, parentId: parentId(before.length ? source.paragraphs : next, index) };
  const operation = input.kind === 'split-paragraph' ? { ...common, kind: input.kind, splitAt: input.splitAt }
    : input.kind === 'join-paragraphs' ? { ...common, kind: input.kind, separator: input.separator } : { ...common, kind: input.kind };
  return validateReviewStructureTarget(source, { kind: 'structure', docType: source.docType, operation });
}

/** Derived solely from validated explicit offsets. Rich paragraphs preserve
 * marks, while current selected-text comments remain limited to plain text. */
export function structureRangeSpans(target: ReviewStructureTarget): StructuralRangeSpan[] {
  const operation = target.operation;
  if (operation.kind === 'split-paragraph') return [
    { fromParagraphId: operation.before[0].id, fromStart: 0, fromEnd: operation.splitAt, toParagraphId: operation.after[0].id, toStart: 0 },
    { fromParagraphId: operation.before[0].id, fromStart: operation.splitAt, fromEnd: operation.before[0].text.length, toParagraphId: operation.after[1].id, toStart: 0 },
  ];
  if (operation.kind === 'join-paragraphs') return operation.before.map((paragraph, index) => ({ fromParagraphId: paragraph.id,
    fromStart: 0, fromEnd: paragraph.text.length, toParagraphId: operation.after[0].id,
    toStart: index ? operation.before[0].text.length + operation.separator.length : 0 }));
  return [];
}

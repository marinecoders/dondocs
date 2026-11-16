import type { Paragraph } from '@/types/document';
import { outlineParagraphs } from '@/services/latex/paragraphLabel';
import { paragraphSubtreeEnd } from './paragraphUtils';

export interface ParagraphMoveIntent {
  paragraphId: string;
  destinationId: string;
  placement: 'before' | 'after';
}
/** Enumerate sibling positions once for the picker. Submission still derives
 * and validates the complete native move through the structural writer. */
export function availableReviewParagraphMoveDestinations(paragraphs: readonly Paragraph[], paragraphId: string, placement: ParagraphMoveIntent['placement']): Paragraph[] {
  if (!paragraphId) return [];
  const ids = new Set<string>();
  let from = -1;
  for (let index = 0; index < paragraphs.length; index++) {
    const id = paragraphs[index].id;
    if (!id || ids.has(id)) return [];
    ids.add(id);
    if (id === paragraphId) from = index;
  }
  if (from < 0) return [];
  const outline = outlineParagraphs(paragraphs.map(paragraph => paragraph.level));
  const end = paragraphSubtreeEnd(paragraphs, from);
  return paragraphs.filter((paragraph, index) => index !== from
    && paragraph.level === paragraphs[from].level && outline[index].parentIndex === outline[from].parentIndex
    && (placement === 'before' ? index !== end : index > from || paragraphSubtreeEnd(paragraphs, index) !== from));
}
/** Derive a move from stable identities. This deliberately refuses reparenting;
 * the complete source subtree travels unchanged beside a sibling subtree. */
export function deriveReviewParagraphMove(paragraphs: readonly Paragraph[], intent: ParagraphMoveIntent): Paragraph[] {
  const ids = new Set<string>();
  for (const paragraph of paragraphs) {
    if (!paragraph.id || ids.has(paragraph.id)) throw new Error('Unique stable paragraph identities are required for a move.');
    ids.add(paragraph.id);
  }
  const from = paragraphs.findIndex(paragraph => paragraph.id === intent.paragraphId);
  const to = paragraphs.findIndex(paragraph => paragraph.id === intent.destinationId);
  if (from < 0 || to < 0 || from === to) throw new Error('Choose two distinct current paragraphs for the move.');
  const outline = outlineParagraphs(paragraphs.map(paragraph => paragraph.level));
  if (paragraphs[from].level !== paragraphs[to].level || outline[from].parentIndex !== outline[to].parentIndex)
    throw new Error('Move a paragraph beside a sibling with the same parent. Its children move with it.');
  const end = paragraphSubtreeEnd(paragraphs, from);
  if (to >= from && to < end) throw new Error('A paragraph cannot move inside its own subtree.');
  const block = paragraphs.slice(from, end);
  const rest = [...paragraphs.slice(0, from), ...paragraphs.slice(end)];
  const destination = rest.findIndex(paragraph => paragraph.id === intent.destinationId);
  const insertion = intent.placement === 'before' ? destination : paragraphSubtreeEnd(rest, destination);
  const next = [...rest.slice(0, insertion), ...block, ...rest.slice(insertion)];
  if (next.every((paragraph, index) => paragraph === paragraphs[index])) throw new Error('This paragraph is already in that position.');
  return next;
}
/** Smallest contiguous guarded corridor containing both complete subtrees. The
 * surrounding gap and parent are captured by the shared structural framework. */
export function captureReviewParagraphMove(paragraphs: readonly Paragraph[], intent: ParagraphMoveIntent): { start: number; before: Paragraph[]; after: Paragraph[] } {
  const next = deriveReviewParagraphMove(paragraphs, intent);
  const from = paragraphs.findIndex(paragraph => paragraph.id === intent.paragraphId);
  const to = paragraphs.findIndex(paragraph => paragraph.id === intent.destinationId);
  const start = Math.min(from, to);
  const end = Math.max(paragraphSubtreeEnd(paragraphs, from), paragraphSubtreeEnd(paragraphs, to));
  return { start, before: structuredClone(paragraphs.slice(start, end)), after: structuredClone(next.slice(start, end)) };
}
/** Human-readable identity context, never encoded structure or derived numbering. */
export function reviewParagraphMoveDescription(paragraphs: readonly Paragraph[], intent: ParagraphMoveIntent): string {
  const name = (id: string) => {
    const paragraph = paragraphs.find(item => item.id === id);
    const text = (paragraph?.header || paragraph?.text || 'Untitled paragraph').replace(/\s+/g, ' ').trim();
    return `“${text.length > 90 ? `${text.slice(0, 87)}…` : text}”`;
  };
  return `Move ${name(intent.paragraphId)} ${intent.placement} ${name(intent.destinationId)} with all child paragraphs.`;
}

/** Movement evidence for review summaries and captured redlines. Numbering is
 * intentionally absent: callers derive it from their complete document view. */
export interface ReviewParagraphMoveView extends ParagraphMoveIntent {
  paragraphIds: string[];
  description: string;
}
export function reviewParagraphMoveView(paragraphs: readonly Paragraph[], intent: ParagraphMoveIntent): ReviewParagraphMoveView {
  deriveReviewParagraphMove(paragraphs, intent);
  const index = paragraphs.findIndex(paragraph => paragraph.id === intent.paragraphId);
  return { paragraphId: intent.paragraphId, destinationId: intent.destinationId, placement: intent.placement,
    paragraphIds: paragraphs.slice(index, paragraphSubtreeEnd(paragraphs, index)).map(paragraph => paragraph.id!),
    description: reviewParagraphMoveDescription(paragraphs, intent) };
}

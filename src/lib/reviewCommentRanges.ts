import type { Paragraph } from '@/types/document';
import { reviewCommentsSchema, type ReviewComments } from './reviewComments';
import { supportsPlainTextRange, transformTextRangeForText } from './reviewTextRanges';

/** Shared by editor edits and guarded review writers. Caller supplies the exact
 * paragraph before/after at the same write boundary; discussion history is immutable. */
export function transformRangeComments(comments: ReviewComments | undefined, before: Paragraph, after: Paragraph): ReviewComments | undefined {
  if (!comments) return comments;
  const detach = () => ({ ...comments, threads: comments.threads.map(thread => thread.anchor.kind === 'range' && thread.anchor.paragraphId === before.id
    ? { ...thread, anchor: { ...thread.anchor, detached: true as const } } : thread) });
  const next = { ...comments, threads: comments.threads.map(thread => thread.anchor.kind === 'range' && thread.anchor.paragraphId === before.id
    ? { ...thread, anchor: after.id === before.id && supportsPlainTextRange(after)
      ? transformTextRangeForText(thread.anchor, before.text, after.text) : { ...thread.anchor, detached: true as const } } : thread) };
  // Growing text can exceed the aggregate retained-context budget. Preserve
  // the previously valid context and detach, so the text edit can still save.
  return reviewCommentsSchema.safeParse(next).success ? next : detach();
}

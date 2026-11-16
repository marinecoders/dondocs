import type { Paragraph } from '@/types/document';
import { reviewCommentsSchema, type ReviewComments } from './reviewComments';
import type { DocumentFieldSource } from './documentFields';
import { captureTextRange, resolveTextRange, type SelectedTextRange, supportsPlainTextRange, transformTextRangeForText } from './reviewTextRanges';

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

/** A reviewer copy's runtime offsets never authorize attachment in the owner's
 * draft. New range discussions must originate in the exact reviewed baseline.
 * An owner paragraph changed since then stays detached for deliberate review. */
export function normalizeReturnedRangeComments(baseline: DocumentFieldSource, current: DocumentFieldSource,
  returned: ReviewComments | undefined): ReviewComments | undefined {
  if (!returned) return returned;
  const known = new Set(baseline.reviewComments?.threads.map(thread => thread.id) ?? []);
  const original = (range: SelectedTextRange): SelectedTextRange => {
    const captured = captureTextRange(baseline, range.paragraphId, range.start, range.end);
    if (!captured || captured.context !== range.context || captured.docType !== range.docType) {
      throw new Error('A returned selected-text comment or its anchor history does not match the reviewed baseline. Nothing was imported. Keep the incoming return file for review or recovery.');
    }
    return captured;
  };
  return { ...returned, threads: returned.threads.map(thread => {
    if (known.has(thread.id) || thread.anchor.kind !== 'range') return thread;
    const anchor = original(thread.anchor);
    for (const previous of thread.anchorHistory ?? []) original(previous.anchor);
    return { ...thread, anchor: resolveTextRange(current, anchor).status === 'current' ? anchor : { ...anchor, detached: true as const } };
  }) };
}

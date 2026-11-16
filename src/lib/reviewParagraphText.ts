import type { SerializedSession } from '@/stores/documentStore';
import { transformRangeComments } from './reviewCommentRanges';

/** A whole-paragraph review write must carry the same discussion mapping as an
 * ordinary paragraph edit, including permanent detachment of touched ranges. */
export function replaceReviewParagraphText(session: SerializedSession, paragraphId: string, text: string): void {
  const index = session.paragraphs.findIndex(paragraph => paragraph.id === paragraphId);
  if (index < 0) throw new Error('The accepted paragraph is unavailable.');
  const before = session.paragraphs[index], after = { ...before, text };
  session.paragraphs[index] = after;
  const comments = transformRangeComments(session.reviewComments, before, after);
  if (comments) session.reviewComments = comments;
  else delete session.reviewComments;
}

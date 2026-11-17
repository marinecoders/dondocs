import { captureCommentAnchor } from './reviewCommentTargets';
import { captureTextRange } from './reviewTextRanges';
import { reviewCommentsSchema, reviewCommentsVersion, type CommentThread } from './reviewComments';
import type { SerializedSession } from '@/stores/documentStore';
import type { WordImport } from '@/services/docx/import/readWord';

/** Attach only an exactly mapped native paragraph. Unsupported Word selections
 * remain readable discussions with an explicit quoted, non-precise fallback. */
export function nativeWordComments(imported: WordImport, session: SerializedSession) {
  const threads: CommentThread[] = imported.comments.map(comment => {
    const selection = comment.selection;
    const matching = selection ? imported.blocks.filter(block => block.sourceIndex === selection.sourceIndex && !block.paragraph.figure && !block.paragraph.bodyTable) : [];
    const block = matching.length === 1 ? matching[0] : undefined;
    const offset = block?.nativeTextOffset ?? 0;
    const start = selection ? selection.start - offset : -1, end = selection ? selection.end - offset : -1;
    const quote = selection?.context.slice(selection.start, selection.end);
    const paragraph = block && session.paragraphs.find(item => item.id === block.paragraph.id);
    const range = paragraph && selection && selection.context.slice(offset) === paragraph.text
      ? captureTextRange(session, paragraph.id!, start, end) : null;
    const paragraphAnchor = paragraph ? captureCommentAnchor(session, undefined, paragraph.id) : null;
    const anchor = range ?? paragraphAnchor ?? { kind: 'document' as const };
    const scope = range ? 'Exact selected text in the imported baseline.' : paragraphAnchor
      ? 'Paragraph discussion. The quoted Word selection is not an exact native text anchor.'
      : comment.unresolved ?? 'The Word selection is not mapped to editable native content. This is an unanchored document discussion.';
    const message = [`Imported Word comment; author and date are unverified. ${scope}`,
      ...(quote ? [`Word selection: “${quote.slice(0, 1_000)}”${quote.length > 1_000 ? ' (quote shortened; full selection remains in the original Word file)' : ''}`] : []),
      ...(comment.date ? [`Word date (unverified): ${comment.date}`] : []), comment.text].join('\n\n');
    return { id: crypto.randomUUID(), anchor, resolved: false, messages: [{ id: crypto.randomUUID(),
      author: `${comment.author.trim().slice(0, 75) || 'Unnamed reviewer'} (Word, unverified)`, text: message, createdAt: new Date().toISOString() }] };
  });
  if (!threads.length) return undefined;
  const result = reviewCommentsSchema.safeParse({ version: reviewCommentsVersion(threads), threads });
  if (!result.success) throw new Error('These Word discussions exceed the native review limits. Split the review before importing; the original file and your current draft are unchanged.');
  return result.data;
}

import type { PlainEditorSelection } from '@/lib/editorTextSelection';
import { captureTextRange, type SelectedTextRange } from '@/lib/reviewTextRanges';
import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, isCurrentDocumentScope, useDocumentsStore, type DocumentScope } from '@/stores/documentsStore';
import { paragraphCommentContext, supportsReviewComments } from '@/lib/reviewCommentTargets';
import { COMMENT_LIMITS } from '@/lib/reviewComments';
import { paragraphIdSchema } from '@/lib/paragraphIdentity';
import { CommentsDialog } from './DocumentComments';

export function ParagraphCommentsButton({ paragraphId, index, selection, selectionOwner }: { paragraphId: string | undefined; index: number; selection?: PlainEditorSelection | null; selectionOwner?: DocumentScope | null }) {
  const paragraph = useDocumentStore(state => state.paragraphs[index]);
  const comments = useDocumentStore(state => state.reviewComments);
  const docType = useDocumentStore(state => state.docType);
  const category = useDocumentStore(state => state.documentCategory);
  useDocumentsStore(current => current.currentId);
  useDocumentsStore(current => current.activationEpoch);
  const [range, setRange] = useState<SelectedTextRange | undefined>();
  const [owner, setOwner] = useState<DocumentScope | null>(null);
  if (!supportsReviewComments({ docType, documentCategory: category, formData: {} })) return null;
  const available = !!paragraph && paragraph.id === paragraphId && paragraphIdSchema.safeParse(paragraphId).success
    && paragraphCommentContext(paragraph).length <= COMMENT_LIMITS.context;
  const count = comments?.threads.filter(thread => !thread.resolved && (thread.anchor.kind === 'paragraph' || thread.anchor.kind === 'range') && thread.anchor.paragraphId === paragraphId).length ?? 0;
  return <>
    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1 text-xs" disabled={!available}
      title={!available ? 'Paragraph comments support up to 20,000 characters. Use a whole-document comment for longer paragraphs.' : undefined}
      aria-label={`Comment on paragraph ${index + 1}`} onClick={event => { event.currentTarget.focus();setRange(undefined);setOwner(captureDocumentScope()); }}>
      <MessageSquare className="h-3.5 w-3.5" />Comment{count ? ` (${count})` : ''}
    </Button>
    <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-6 gap-1 px-1 text-xs"
      disabled={!isCurrentDocumentScope(selectionOwner ?? null) || !selection || !paragraph || selection.context !== paragraph.text || !paragraphId || !captureTextRange(useDocumentStore.getState(), paragraphId, selection.start, selection.end)}
      title="Select words or a sentence in one plain paragraph. Formatting, variables, headings and structured blocks are not supported."
      aria-label={`Comment on selection in paragraph ${index + 1}`} onMouseDown={event => event.preventDefault()} onClick={() => {
        if (!isCurrentDocumentScope(selectionOwner ?? null) || !selection || !paragraphId || selection.context !== useDocumentStore.getState().paragraphs[index]?.text) return;
        const anchor = captureTextRange(useDocumentStore.getState(), paragraphId, selection.start, selection.end);
        if (!anchor) return;
        setRange(anchor);setOwner(captureDocumentScope());
      }}>Comment on selection</Button>
    <span className="basis-full text-xs text-muted-foreground">Select words in one plain paragraph to comment on a selection. Formatting, variables and structured blocks need a paragraph comment.</span>
    {paragraphId && isCurrentDocumentScope(owner) && <CommentsDialog initialRange={range} initialParagraphId={paragraphId} onClose={() => setOwner(null)} />}
  </>;
}

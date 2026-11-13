import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, isCurrentDocumentScope, useDocumentsStore, type DocumentScope } from '@/stores/documentsStore';
import { paragraphCommentContext, supportsReviewComments } from '@/lib/reviewCommentTargets';
import { COMMENT_LIMITS } from '@/lib/reviewComments';
import { paragraphIdSchema } from '@/lib/paragraphIdentity';
import { CommentsDialog } from './DocumentComments';

export function ParagraphCommentsButton({ paragraphId, index }: { paragraphId: string | undefined; index: number }) {
  const paragraph = useDocumentStore(state => state.paragraphs[index]);
  const comments = useDocumentStore(state => state.reviewComments);
  const docType = useDocumentStore(state => state.docType);
  const category = useDocumentStore(state => state.documentCategory);
  useDocumentsStore(current => current.currentId);
  useDocumentsStore(current => current.activationEpoch);
  const [owner, setOwner] = useState<DocumentScope | null>(null);
  if (!supportsReviewComments({ docType, documentCategory: category, formData: {} })) return null;
  const available = !!paragraph && paragraph.id === paragraphId && paragraphIdSchema.safeParse(paragraphId).success
    && paragraphCommentContext(paragraph).length <= COMMENT_LIMITS.context;
  const count = comments?.threads.filter(thread => !thread.resolved && thread.anchor.kind === 'paragraph' && thread.anchor.paragraphId === paragraphId).length ?? 0;
  return <>
    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1 text-xs" disabled={!available}
      title={!available ? 'Paragraph comments support up to 20,000 characters of context.' : undefined}
      aria-label={`Comment on paragraph ${index + 1}`} onClick={() => setOwner(captureDocumentScope())}>
      <MessageSquare className="h-3.5 w-3.5" />Comment{count ? ` (${count})` : ''}
    </Button>
    {paragraphId && isCurrentDocumentScope(owner) && <CommentsDialog initialParagraphId={paragraphId} onClose={() => setOwner(null)} />}
  </>;
}

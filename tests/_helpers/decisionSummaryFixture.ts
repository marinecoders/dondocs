import { captureDocumentTarget, useDocumentsStore } from '@/stores/documentsStore';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { createReviewSuggestion, emptyReviewSuggestionState } from '@/lib/reviewSuggestions';
import type { ReviewSuggestionWorkspace } from '@/lib/reviewSuggestionActions';
import type { ReviewRound } from '@/lib/reviewRounds';

export function decisionSummaryFixture(): ReviewSuggestionWorkspace {
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'SYNTHETIC SUBJECT', from: 'Synthetic sender', to: 'Original recipient', classLevel: 'unclassified' },
    paragraphs: [{ id: 'first', text: 'First body.', level: 0 }, { id: 'second', text: 'Second body.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] });
  const target = captureDocumentTarget()!;
  const current = { ...getSerializedSession(), timestamp: 1 };
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 1,
    label: 'Synthetic review round', sourceDocumentId: target.scope.documentId, ownerDocumentId: target.scope.documentId,
    baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session: structuredClone(current) } };
  const proposal = createReviewSuggestion(round, { author: 'Synthetic reviewer', label: 'Recipient correction', category: 'required-correction',
    changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Proposed recipient' }] });
  return { target, round, current, owner: true, state: { ...emptyReviewSuggestionState(round), proposals: [proposal] } };
}

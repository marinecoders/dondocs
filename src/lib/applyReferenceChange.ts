import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget, recordDocumentHistory, type DocumentTarget } from '@/stores/documentsStore';
import { planReferenceChange, planFirstCitationOrder, type ReferenceChange } from './referenceCitations';

export interface ReviewedReferenceChange {
  readonly target: DocumentTarget | null;
  readonly plan: ReferenceChange;
  readonly beforeReferences: ReturnType<typeof useDocumentStore.getState>['references'];
}
const issued = new WeakMap<ReviewedReferenceChange, { order: readonly number[] | undefined; offset: number | undefined }>();

export function reviewReferenceChange(order?: readonly number[], offset?: number): ReviewedReferenceChange {
  const state = useDocumentStore.getState();
  const proposal = Object.freeze({ target: captureDocumentTarget(), beforeReferences: state.references,
    plan: order ? planReferenceChange(state, order, offset) : planFirstCitationOrder(state) });
  issued.set(proposal, { order: order ? [...order] : undefined, offset });
  return proposal;
}

/** Recompute from the current owned revision; no externally supplied patch can
 * be applied, and the before/after capture makes the multi-field edit one Undo. */
export function applyReferenceChange(proposal: ReviewedReferenceChange, markersReviewed = false): boolean {
  const request = issued.get(proposal);
  if (!request || !isCurrentDocumentTarget(proposal.target) || proposal.plan.blockers.length || !proposal.plan.changed) return false;
  const plan = request.order ? planReferenceChange(useDocumentStore.getState(), request.order, request.offset)
    : planFirstCitationOrder(useDocumentStore.getState());
  if (plan.blockers.length || plan.advisories.length > 0 && !markersReviewed || !plan.changed || !recordDocumentHistory(proposal.target.scope)) return false;
  issued.delete(proposal);
  useDocumentStore.setState(plan.patch);
  recordDocumentHistory(proposal.target.scope);
  return true;
}

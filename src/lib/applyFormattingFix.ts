import { formattingFindings, type FormattingFinding } from './formattingFindings';
import { useDocumentStore } from '@/stores/documentStore';
import { isCurrentDocumentScope, recordDocumentHistory, type DocumentScope } from '@/stores/documentsStore';

/** Recheck the proposal and its document owner before creating one Undo step. */
export function applyFormattingFix(finding: FormattingFinding, section: string, scope: DocumentScope | null): boolean {
  if (finding.after === undefined || !isCurrentDocumentScope(scope)) return false;
  const state = useDocumentStore.getState();
  const current = formattingFindings(state, section).find(candidate => candidate.field === finding.field
    && candidate.before === finding.before && candidate.after === finding.after);
  if (!current || !recordDocumentHistory(scope)) return false;
  state.setField(finding.field, finding.after);
  recordDocumentHistory(scope);
  return true;
}

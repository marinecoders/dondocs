import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget, recordDocumentHistory, type DocumentTarget } from '@/stores/documentsStore';
import { mechanicalFindings, type BodyDateAudience, type MechanicalFinding, type MechanicalSection } from './mechanicalCorrections';

export interface ReviewedMechanicalCorrections {
  readonly target: DocumentTarget | null;
  readonly section: MechanicalSection;
  readonly audience: BodyDateAudience | null;
  readonly findings: readonly MechanicalFinding[];
}
const issued = new WeakSet<ReviewedMechanicalCorrections>();

export function reviewMechanicalCorrections(section: MechanicalSection, audience: BodyDateAudience | null): ReviewedMechanicalCorrections {
  const proposal = Object.freeze({ target: captureDocumentTarget(), section, audience,
    findings: mechanicalFindings(useDocumentStore.getState(), section, audience) });
  issued.add(proposal);
  return proposal;
}

/** Every selected span is validated before publishing one state change. */
export function applyMechanicalCorrections(proposal: ReviewedMechanicalCorrections, selectedIds: readonly string[],
  audience: BodyDateAudience | null): boolean {
  if (!issued.has(proposal) || !isCurrentDocumentTarget(proposal.target) || proposal.audience !== audience
    || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length) return false;
  const state = useDocumentStore.getState();
  const current = mechanicalFindings(state, proposal.section, audience);
  const selected: MechanicalFinding[] = [];
  for (const id of selectedIds) {
    const reviewed = proposal.findings.find(item => item.id === id);
    const match = current.find(item => item.id === id && item.after !== undefined && item.before === reviewed?.before
      && item.after === reviewed.after && item.sourceText === reviewed.sourceText);
    if (!match) return false;
    selected.push(match);
  }
  let paragraphs = state.paragraphs;
  let references = state.references;
  for (const item of selected.sort((a, b) => b.target.start - a.target.start)) {
    const { kind, index, start, end } = item.target;
    if (kind === 'paragraph-text') {
      paragraphs = paragraphs.map((paragraph, i) => i === index
        ? { ...paragraph, text: paragraph.text.slice(0, start) + item.after + paragraph.text.slice(end) } : paragraph);
    } else {
      references = references.map((reference, i) => i === index
        ? { ...reference, title: reference.title.slice(0, start) + item.after + reference.title.slice(end) } : reference);
    }
  }
  if (!recordDocumentHistory(proposal.target.scope)) return false;
  issued.delete(proposal);
  useDocumentStore.setState({ paragraphs, references });
  recordDocumentHistory(proposal.target.scope);
  return true;
}

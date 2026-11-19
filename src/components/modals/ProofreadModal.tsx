import { useRef, type MouseEvent, type ReactNode } from 'react';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { useProofreadReview } from '@/hooks/useProofreadFindings';
import { useProofreadManualChecklist } from '@/hooks/useProofreadManualChecklist';
import { ProofreadManualChecklist } from '@/components/ProofreadManualChecklist';
import { supportsCorrespondenceProofread } from '@/lib/correspondenceProofreadChecks';
import { useUIStore } from '@/stores/uiStore';
import { captureDocumentTarget, isCurrentDocumentTarget, useDocumentsStore, type DocumentTarget } from '@/stores/documentsStore';
import { useEditorSections } from '@/components/layout/editorSections';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { getEditorSections, getFormSections } from '@/lib/editorSections';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { useDocumentStore } from '@/stores/documentStore';
import { PROOFREAD_GROUPS, type ProofreadFinding } from '@/lib/proofread';
import { Button } from '@/components/ui/button';
import { openCorrespondenceManual } from '@/stores/correspondenceManualStore';
import type { ManualLocation } from '@/lib/correspondenceManual';
import type { FieldPath } from '@/lib/documentFields';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type PendingAction =
  | { kind: 'editor'; owner: DocumentTarget | null; target: ProofreadFinding['target'] }
  | { kind: 'manual'; owner: DocumentTarget | null; location: ManualLocation };

function paragraphControl(paragraph: HTMLElement | null | undefined, path: FieldPath | undefined): HTMLElement | null {
  if (!paragraph || !path) return null;
  if (path[0] === 'header') return paragraph.querySelector<HTMLElement>('[data-paragraph-field="header"]');
  if (path[0] === 'text') return paragraph.querySelector<HTMLElement>('[data-paragraph-field="text"]');
  if (path[0] === 'figure' && path[1] === 'altText') return paragraph.querySelector<HTMLElement>('[data-paragraph-field="figure-alt"]');
  if (path[0] === 'tableFootnotes' && Number.isInteger(path[1]) && Number(path[1]) >= 0 && path[2] === 'text') {
    return paragraph.querySelector<HTMLElement>(`[data-table-footnote="${path[1]}"]`);
  }
  if (path[0] === 'bodyTable' && path[1] === 'rows'
    && Number.isInteger(path[2]) && Number(path[2]) >= 0 && Number.isInteger(path[3]) && Number(path[3]) >= 0) {
    return paragraph.querySelector<HTMLElement>(`[data-table-row="${path[2]}"][data-table-column="${path[3]}"]`);
  }
  return null;
}

export function ProofreadModal({ children }: { children?: ReactNode }) {
  const open = useUIStore(s => s.proofreadOpen);
  const setOpen = useUIStore(s => s.setProofreadOpen);
  const { source, findings } = useProofreadReview(open);
  const { sections: displayedSections } = useEditorSections();
  const documentId = useDocumentsStore(s => s.currentId);
  const activationEpoch = useDocumentsStore(s => s.activationEpoch);
  const checklist = useProofreadManualChecklist(source, `${documentId ?? 'new'}:${activationEpoch}`);
  // Bind row actions to the revision that produced them, including rapid draft switches.
  const owner = captureDocumentTarget();
  const pending = useRef<PendingAction | null>(null);

  function navigate(event: MouseEvent<HTMLButtonElement>) {
    const finding = findings.find(item => item.id === event.currentTarget.dataset.findingId);
    if (!finding) return;
    pending.current = { kind: 'editor', owner, target: finding.target };
    setOpen(false);
  }

  function navigateSource(event: MouseEvent<HTMLButtonElement>) {
    const finding = findings.find(item => item.id === event.currentTarget.dataset.findingId);
    if (!finding?.source) return;
    pending.current = { kind: 'manual', owner, location: finding.source };
    setOpen(false);
  }

  function viewChecklistSource() {
    pending.current = { kind: 'manual', owner, location: { chapter: 2, paragraph: '19', query: 'Proofreading' } };
    setOpen(false);
  }

  function finishNavigation(event: Event) {
    const next = pending.current;pending.current = null;
    if (!next) return;
    event.preventDefault();
    if (!isCurrentDocumentTarget(next.owner)) return;
    if (next.kind === 'manual') {
      // Give the source reader a stable return target after this dialog unmounts.
      document.querySelector<HTMLElement>('[data-proofread-trigger]')?.focus({ preventScroll: true });
      openCorrespondenceManual(next.location);
      return;
    }
    const state = useDocumentStore.getState();
    const sections = state.documentCategory === 'forms' ? getFormSections(state.formType)
      : getEditorSections(DOC_TYPE_CONFIG[state.docType] ?? DOC_TYPE_CONFIG.naval_letter, state.docType);
    // Configured forms publish their own section ids; the current findings were derived from that outline.
    if (!state.genericForm && !sections.some(section => section.id === next.target.sectionId)) return;
    useEditorOutlineStore.getState().jump(next.target.sectionId);
    const focusOrigin = document.activeElement;
    // Allow the focused editor's section selection and layout effect to commit first.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!isCurrentDocumentTarget(next.owner)) return;
      const section = document.getElementById(`sec-${next.target.sectionId}`);
      if (!section) return;
      const focused = document.activeElement;
      if (focused !== focusOrigin && focused !== document.body && focused !== section) return;
      const field = next.target.field ? document.getElementById(next.target.field) : null;
      const paragraph = next.target.paragraphId
        ? [...section.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(element => element.dataset.paragraphId === next.target.paragraphId)
        : null;
      const destination = field && section.contains(field) ? field : paragraphControl(paragraph, next.target.paragraphPath)
        ?? paragraph?.querySelector<HTMLElement>('[contenteditable="true"]') ?? paragraph?.querySelector<HTMLElement>('textarea,input') ?? section;
      destination.focus({ preventScroll: true });destination.scrollIntoView({ block: 'nearest' });
    }));
  }

  return <Dialog open={open} onOpenChange={value => { if (value) pending.current = null;setOpen(value); }}>
    <DialogContent className="flex max-h-[90dvh] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" onCloseAutoFocus={finishNavigation}>
      <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
        <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" aria-hidden="true" />Proofread</DialogTitle>
        <DialogDescription>Review the current draft. These checks do not certify its content or change existing export requirements.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
        <p role="status" aria-atomic="true" className="mb-4 text-sm font-medium">{findings.length} finding{findings.length === 1 ? '' : 's'} to review</p>
        {findings.length === 0 ? <p className="rounded-lg border bg-muted/30 p-4 text-sm">No findings from the available checks. Review the content, attachments and completed output before sending.</p>
          : Object.entries(PROOFREAD_GROUPS).map(([group, label]) => {
            const items = findings.filter(finding => finding.group === group);
            if (!items.length) return null;
            return <section key={group} aria-labelledby={`proofread-group-${group}`} className="mb-5 last:mb-0">
              <h2 id={`proofread-group-${group}`} className="mb-2 text-sm font-semibold">{label} <span className="font-normal text-muted-foreground">({items.length})</span></h2>
              <ul className="divide-y rounded-lg border">
                {items.map(finding => <li key={finding.id} className="min-w-0 p-3">
                  <p className="break-words text-sm font-medium">{finding.title}</p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">{finding.message}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    {finding.source ? <Button variant="link" size="sm" className="h-auto min-h-10 min-w-0 whitespace-normal px-0 text-left text-xs" data-finding-id={finding.id} onClick={navigateSource}>
                      {`SECNAV M-5216.5 · Ch ${finding.source.chapter}${finding.source.paragraph ? ` ¶${finding.source.paragraph}` : ''}`}
                    </Button> : <span className="text-xs text-muted-foreground">Existing document check</span>}
                    <Button size="sm" variant="outline" data-finding-id={finding.id} onClick={navigate} className="min-h-10 shrink-0">Go to {displayedSections.find(section => section.id === finding.target.sectionId)?.label ?? 'editor section'}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                  </div>
                </li>)}
              </ul>
            </section>;
          })}
        {supportsCorrespondenceProofread(source) && <ProofreadManualChecklist {...checklist} onViewSource={viewChecklistSource} />}
        {children}
        <p className="mt-4 text-xs text-muted-foreground">Sensitive-text checks inspect supported text fields. They do not inspect attached file contents or establish that a document is free of sensitive information. Export performs its own review.</p>
      </div>
      <DialogFooter className="shrink-0 border-t px-5 py-3"><Button variant="outline" onClick={() => setOpen(false)}>Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

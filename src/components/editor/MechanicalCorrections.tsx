import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget, useDocumentsStore, type DocumentTarget } from '@/stores/documentsStore';
import { mechanicalFindings, supportsMechanicalCorrections, type BodyDateAudience } from '@/lib/mechanicalCorrections';
import { applyMechanicalCorrections, reviewMechanicalCorrections, type ReviewedMechanicalCorrections } from '@/lib/applyMechanicalCorrections';

export function MechanicalCorrectionPreview({ proposal, audience, onClose, onApplied }: {
  proposal: ReviewedMechanicalCorrections; audience: BodyDateAudience | null; onClose(): void; onApplied(): void;
}) {
  useDocumentStore();
  useDocumentsStore(s => s.activationEpoch);
  useDocumentsStore(s => s.currentId);
  const [selection, setSelection] = useState<{ proposal: ReviewedMechanicalCorrections; ids: readonly string[] } | null>(null);
  const ids = selection?.proposal === proposal ? selection.ids : proposal.findings.filter(item => item.after !== undefined).map(item => item.id);
  const stale = !isCurrentDocumentTarget(proposal.target) || audience !== proposal.audience;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Review formatting corrections</DialogTitle>
        <DialogDescription>Select the corrections to apply. They update together; one Undo restores the previous revision.</DialogDescription>
      </DialogHeader>
      {stale && <p role="alert" className="text-sm text-destructive">The draft or audience choice changed. Close this preview and review the current text again.</p>}
      {!proposal.findings.length && <p className="text-sm">No corrections are proposed for this selection.</p>}
      {proposal.findings.map(item => <div key={item.id} className="space-y-2 border-t pt-3 text-sm">
        <div className="flex items-start gap-2">
          {item.after !== undefined && <Checkbox id={item.id} checked={ids.includes(item.id)} disabled={stale}
            onCheckedChange={checked => setSelection({ proposal, ids: checked === true ? [...ids, item.id] : ids.filter(id => id !== item.id) })} />}
          {item.after !== undefined ? <Label htmlFor={item.id}>{item.label}</Label> : <p className="font-medium">{item.label}: manual review</p>}
        </div>
        <p className="text-xs text-muted-foreground">{item.message}</p>
        <p className="whitespace-pre-wrap break-words text-xs"><span className="text-muted-foreground">Context: </span>
          {item.sourceText.slice(0, item.target.start)}<strong className="underline">{item.before}</strong>{item.sourceText.slice(item.target.end)}</p>
        <dl className="space-y-1 text-xs">
          <div><dt className="text-muted-foreground">Current</dt><dd className="whitespace-pre-wrap break-words font-mono">“{item.before}”</dd></div>
          {item.after !== undefined && <div><dt className="text-muted-foreground">Proposed</dt><dd className="whitespace-pre-wrap break-words font-mono">“{item.after}”</dd></div>}
        </dl>
      </div>)}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
        {proposal.findings.some(item => item.after !== undefined) && <Button disabled={stale || !ids.length}
          onClick={() => { if (applyMechanicalCorrections(proposal, ids, audience)) onApplied(); }}>Apply {ids.length} {ids.length === 1 ? 'correction' : 'corrections'}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function MechanicalCorrections({ section }: { section: string }) {
  const docType = useDocumentStore(s => s.docType);
  const documentMode = useDocumentStore(s => s.documentMode);
  const documentCategory = useDocumentStore(s => s.documentCategory);
  const paragraphs = useDocumentStore(s => s.paragraphs);
  const references = useDocumentStore(s => s.references);
  const documentId = useDocumentsStore(s => s.currentId);
  const epoch = useDocumentsStore(s => s.activationEpoch);
  const [choice, setChoice] = useState<{ documentId: string | null; epoch: number; audience: BodyDateAudience } | null>(null);
  const [proposal, setProposal] = useState<ReviewedMechanicalCorrections | null>(null);
  const [feedback, setFeedback] = useState<DocumentTarget | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const audience = choice?.documentId === documentId && choice.epoch === epoch ? choice.audience : null;
  const source = { docType, documentMode, documentCategory, paragraphs, references };
  const status = isCurrentDocumentTarget(feedback);
  useLayoutEffect(() => { if (feedback && isCurrentDocumentTarget(feedback)) resultRef.current?.focus({ preventScroll: true }); }, [feedback]);
  if ((section !== 'body' && section !== 'references') || !supportsMechanicalCorrections(source)) return null;
  const available = section === 'body'
    ? [...mechanicalFindings(source, section, 'military'), ...mechanicalFindings(source, section, 'civilian')].length > 0
    : mechanicalFindings(source, section, null).length > 0;
  if (!available && !status && !proposal) return null;
  return <div className="mb-3 space-y-2 rounded-lg border border-border/50 p-3">
    {status && <p ref={resultRef} role="status" tabIndex={-1} className="text-xs text-muted-foreground">Formatting corrections applied. Use Undo to restore the previous revision.</p>}
    {section === 'body' && <div className="space-y-2">
      <Label htmlFor="body-date-audience">Body date audience</Label>
      <Select value={audience ?? ''} onValueChange={value => {
        if (value !== 'military' && value !== 'civilian') return;
        setChoice({ documentId, epoch, audience: value });setProposal(null);setFeedback(null);
      }}>
        <SelectTrigger id="body-date-audience"><SelectValue placeholder="Choose the audience" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="military">Military — 5 November 2026</SelectItem>
          <SelectItem value="civilian">Civilian — November 5, 2026</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Choose who the letter is for before reviewing body dates. Quoted text, links, and placeholders stay unchanged.</p>
    </div>}
    {available && <Button variant="outline" size="sm" disabled={!documentId || section === 'body' && !audience}
      onClick={() => { setFeedback(null);setProposal(reviewMechanicalCorrections(section, section === 'body' ? audience : null)); }}>
      {section === 'body' ? 'Review body date formatting' : 'Review NOTAL formatting'}
    </Button>}
    {proposal && <MechanicalCorrectionPreview proposal={proposal} audience={section === 'body' ? audience : null}
      onClose={() => setProposal(null)} onApplied={() => { setProposal(null);setFeedback(captureDocumentTarget()); }} />}
  </div>;
}

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDocumentStore } from '@/stores/documentStore';
import { isCurrentDocumentTarget, useDocumentsStore } from '@/stores/documentsStore';
import { applyReferenceChange, type ReviewedReferenceChange } from '@/lib/applyReferenceChange';

export function ReferenceChangePreview({ proposal, onClose, onApplied }: {
  proposal: ReviewedReferenceChange; onClose: () => void; onApplied: () => void;
}) {
  // Typing and activation changes immediately invalidate the displayed revision.
  useDocumentStore();
  useDocumentsStore(s => s.activationEpoch);
  const [acknowledgment, setAcknowledgment] = useState<ReviewedReferenceChange | null>(null);
  const markersReviewed = acknowledgment === proposal;
  const stale = !isCurrentDocumentTarget(proposal.target);
  const { plan } = proposal;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Review reference changes</DialogTitle>
        <DialogDescription>Review the list and the proposed text updates. Apply updates explicit ref/reference citations together with the list. One Undo restores the previous revision.</DialogDescription>
      </DialogHeader>
      {stale && <p role="alert" className="text-sm text-destructive">This draft changed after the preview opened. Close this preview and review the current references again.</p>}
      {plan.blockers.length > 0 && <div role="alert" className="space-y-2 text-sm">
        <p className="font-medium">Resolve these citations before applying changes:</p>
        <ul className="list-disc pl-5 space-y-2">{plan.blockers.map(message => <li key={message}>{message}</li>)}</ul>
      </div>}
      {plan.advisories.length > 0 && <div className="space-y-2 text-sm">
        <ul className="list-disc pl-5 space-y-2">{plan.advisories.map(message => <li key={message}>{message}</li>)}</ul>
        <div className="flex gap-2 items-start">
          <Checkbox id="review-reference-markers" checked={markersReviewed} onCheckedChange={checked => setAcknowledgment(checked === true ? proposal : null)} />
          <Label htmlFor="review-reference-markers" className="text-sm font-normal">I reviewed these bare markers and they are not reference citations.</Label>
        </div>
      </div>}
      {plan.notes.map(note => <p key={note} className="text-sm text-muted-foreground">{note}</p>)}
      {!plan.changed && !plan.blockers.length && <p className="text-sm">No reference-order change is proposed.</p>}
      <div className="grid gap-4 sm:grid-cols-2 text-sm">
        <div><p className="font-medium mb-2">Current references</p><ul className="space-y-1">{proposal.beforeReferences.map((ref, index) => <li key={index} className="break-words">({ref.letter}) {ref.title || 'Untitled reference'}</li>)}</ul></div>
        <div><p className="font-medium mb-2">Proposed references</p><ul className="space-y-1">{plan.references.map((ref, index) => <li key={index} className="break-words">({ref.letter}) {ref.title || 'Untitled reference'}</li>)}</ul>{!plan.references.length && <p>No references</p>}</div>
      </div>
      {plan.changes.map((change, index) => <div key={index} className="space-y-1 text-sm border-t pt-3">
        <p className="font-medium">{change.label}</p>
        <dl className="space-y-2 text-xs">
          <div><dt className="text-muted-foreground">Current</dt><dd className="whitespace-pre-wrap break-words">{change.before}</dd></div>
          <div><dt className="text-muted-foreground">Proposed</dt><dd className="whitespace-pre-wrap break-words">{change.after}</dd></div>
        </dl>
      </div>)}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
        {!plan.blockers.length && plan.changed && <Button disabled={stale || plan.advisories.length > 0 && !markersReviewed} onClick={() => {
          if (applyReferenceChange(proposal, markersReviewed)) onApplied();
        }}>Apply changes</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

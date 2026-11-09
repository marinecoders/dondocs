import type { BatchExportReview } from '@/services/exports/batchExecution';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getPIITypeLabel } from '@/services/pii/detector';

export function BatchExportReviewModal({ review, onConfirm, onCancel, cancelLabel = 'Cancel row and pause batch' }: {
  review: BatchExportReview | null;
  onConfirm(): void;
  onCancel(): void;
  cancelLabel?: string;
}) {
  return <Dialog open={!!review} onOpenChange={open => { if (!open) onCancel(); }}>
    <DialogContent className="max-h-[80dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Review batch row</DialogTitle>
        <DialogDescription>{review?.job.filename}</DialogDescription>
      </DialogHeader>
      {review?.stage === 'privacy' && <div>
        <p>Potential personal or sensitive data appears in this row. Confirm that this file is appropriate for its recipient.</p>
        <ul className="mt-3 space-y-2">{review.details.privacy.findings.map((finding, index) => <li key={index}>{getPIITypeLabel(finding.type)} · {finding.field}</li>)}</ul>
      </div>}
      {review?.stage === 'structure' && <div><p>Check paragraph structure before exporting this row.</p><ul className="mt-3 space-y-2">{review.details.structure.map((finding, index) => <li key={index}>{finding.message}</li>)}</ul></div>}
      {review?.stage === 'marking' && <ul>{review.details.notices.map(notice => <li key={notice}>{notice}</li>)}</ul>}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{cancelLabel}</Button>
        <Button onClick={onConfirm}>Continue with this row</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

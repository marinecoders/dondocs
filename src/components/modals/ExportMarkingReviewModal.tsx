import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function ExportMarkingReviewModal({ open, filename, notices, onCancel, onProceed }: {
  open: boolean; filename?: string; notices: string[]; onCancel(): void; onProceed(): void;
}) {
  return <Dialog open={open} onOpenChange={next => { if (!next) onCancel(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Review export markings</DialogTitle><DialogDescription>{filename}</DialogDescription></DialogHeader>
      {notices.map(notice => <p key={notice} className="text-sm">{notice}</p>)}
      <DialogFooter><Button variant="outline" onClick={onCancel}>Go back and fix</Button><Button onClick={onProceed}>Continue export</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

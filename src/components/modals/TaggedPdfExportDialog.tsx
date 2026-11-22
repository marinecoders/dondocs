import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { projectRenderedDocument } from '@/lib/renderedDocument';
import { useDocumentStore } from '@/stores/documentStore';
import { taggedCorrespondenceIssues } from '@/services/pdf/accessibility/preflight';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function TaggedPdfExportDialog({ open, onOpenChange, onExport, disabled }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onExport(): void;
  disabled?: boolean;
}) {
  const source = useDocumentStore();
  // Advisory only: the export controller captures and validates again on Export.
  const projected = copyCapturedDocument(projectRenderedDocument(captureDocumentRevision({ documentId: 'tagged-preflight', epoch: 0, editSequence: 0, capturedAt: 0 }, source.getSnapshot())));
  const issues = projected.kind === 'correspondence' ? taggedCorrespondenceIssues(projected.document) : ['Tagged PDF requires supported native correspondence.'];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Export tagged PDF</DialogTitle>
        <DialogDescription>Experimental output for native unclassified standard, naval and multiple-address letters and plain-paper and letterhead memorandums. The PDF includes document tags and logical reading order; native screen-reader qualification and PDF/UA conformance have not been established.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <p>Language: English (United States). Headings, lists, table column headers and image alternatives come from this draft. Check the exported reading order with your intended reader before distribution.</p>
        <p>Tables need explicit column headers and at least one data row. Body images need separate alternative text. Original PDFs, enclosures, signature images, signing fields and reviewed or signed returns are outside this export.</p>
        {issues.length > 0 && <div role="status"><p className="font-medium">Resolve before export:</p><ul className="list-disc pl-5">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={disabled || issues.length > 0} onClick={() => { onOpenChange(false); onExport(); }}>Export tagged PDF</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

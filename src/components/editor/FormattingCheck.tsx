import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, useDocumentsStore } from '@/stores/documentsStore';
import { formattingFindings, type FormattingFinding } from '@/lib/formattingFindings';
import { applyFormattingFix } from '@/lib/applyFormattingFix';

export function FormattingCheck({ section }: { section: string }) {
  const formData = useDocumentStore(s => s.formData);
  const docType = useDocumentStore(s => s.docType);
  const documentMode = useDocumentStore(s => s.documentMode);
  const documentCategory = useDocumentStore(s => s.documentCategory);
  const documentId = useDocumentsStore(s => s.currentId);
  const epoch = useDocumentsStore(s => s.activationEpoch);
  const scope = useMemo(() => {
    const captured = captureDocumentScope();
    return captured?.documentId === documentId && captured?.epoch === epoch ? captured : null;
  }, [documentId, epoch]);
  const [feedback, setFeedback] = useState<{ message: string; field: FormattingFinding['field']; value: string } | null>(null);
  const status = feedback && formData[feedback.field] === feedback.value ? feedback.message : '';
  const findings = formattingFindings({ formData, docType, documentMode, documentCategory }, section);

  if (findings.length === 0 && !status) return null;

  return <div className="mb-3 space-y-2">
    <p role="status" className={status ? 'text-xs text-muted-foreground' : 'sr-only'}>{status}</p>
    {findings.map(finding => <Notice key={finding.field} variant="warning">
      <div className="space-y-2 min-w-0 text-sm">
        <p className="font-medium">{finding.label}: {finding.after === undefined ? 'review date' : 'formatting suggestion'}</p>
        <p className="text-xs text-muted-foreground">{finding.message}</p>
        <dl className="space-y-1 text-xs">
          <div><dt className="text-muted-foreground">Current</dt><dd className="whitespace-pre-wrap break-words font-mono">“{finding.before}”</dd></div>
          {finding.after !== undefined && <div><dt className="text-muted-foreground">Proposed</dt><dd className="whitespace-pre-wrap break-words font-mono">“{finding.after}”</dd></div>}
        </dl>
        {finding.after !== undefined && <Button type="button" variant="outline" size="sm"
          aria-label={`Apply ${finding.label.toLowerCase()} formatting fix`}
          onClick={() => {
            const applied = applyFormattingFix(finding, section, scope);
            setFeedback({ field: finding.field, value: applied ? finding.after! : finding.before,
              message: applied ? `${finding.label} formatting applied. Use Undo to restore the previous value.` : 'This suggestion has changed. Review the current value.' });
          }}>Apply fix</Button>}
      </div>
    </Notice>)}
  </div>;
}

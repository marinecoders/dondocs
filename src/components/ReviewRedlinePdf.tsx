import { useEffect, useId, useRef, useState } from 'react';
import PdfViewer from '@/components/pdf/PdfViewer';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { getExportDeploymentPolicy } from '@/config/classification';
import { useDocumentsStore } from '@/stores/documentsStore';
import { loadReviewDecisionSummary, prepareReviewDecisionSummary, reviewDecisionSummaryPdfContent,
  validateReviewDecisionSummaryPdf, ownsReviewDecisionSummaryPdf, type PreparedDecisionSummary } from '@/lib/reviewDecisionSummary';
import { triggerDownload } from '@/lib/encoding';
import { getPIITypeLabel } from '@/services/pii/detector';

interface Props { roundId: string; disabled?: boolean; onBusyChange: (busy: boolean, roundId: string) => void }
interface Prepared { report: PreparedDecisionSummary; bytes: Uint8Array; url: string }
export function ReviewRedlinePdf(props: Props) {
  const id = useDocumentsStore(state => state.currentId), epoch = useDocumentsStore(state => state.activationEpoch);
  return <RedlinePdfContent key={`${props.roundId}:${id}:${epoch}`} {...props} />;
}
function RedlinePdfContent({ roundId, disabled, onBusyChange }: Props) {
  const [prepared, setPrepared] = useState<Prepared | null>(null), [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const active = useRef(true), request = useRef(0), running = useRef(false), url = useRef<string | null>(null);
  const checkbox = useId();
  function release() { if (url.current) URL.revokeObjectURL(url.current);url.current = null; }
  useEffect(() => {
    active.current = true;const requestState = request;
    return () => { active.current = false;requestState.current++;if (url.current) URL.revokeObjectURL(url.current);onBusyChange(false, roundId); };
  }, [onBusyChange, roundId]);
  function cancel() { request.current++;running.current = false;release();setPrepared(null);setBusy(false);setChecked(false);setError('');onBusyChange(false, roundId); }
  async function run(download: boolean) {
    if (running.current || disabled || download && (!prepared || !checked)) return;
    running.current = true;const generation = ++request.current;
    const cancelled = () => !active.current || request.current !== generation;
    setBusy(true);setError('');setNotice('');onBusyChange(true, roundId);
    try {
      if (download && prepared) {
        const policy = await getExportDeploymentPolicy(undefined, true);
        if (cancelled()) return;
        await validateReviewDecisionSummaryPdf(prepared.report, policy);
        if (cancelled()) return;
        if (!ownsReviewDecisionSummaryPdf(prepared.report)) throw new Error('The draft changed. Prepare the redline PDF again.');
        triggerDownload(prepared.bytes, `review-redline-${reviewDecisionSummaryPdfContent(prepared.report).capturedAt.replace(/[:.]/g, '-')}.pdf`, 'application/pdf');
        release();setPrepared(null);setChecked(false);setNotice('Redline review PDF sent to browser downloads.');
      } else {
        const capture = await loadReviewDecisionSummary(roundId);
        const policy = await getExportDeploymentPolicy(undefined, true);
        if (cancelled()) return;
        const report = prepareReviewDecisionSummary(capture, policy);
        if (!ownsReviewDecisionSummaryPdf(report)) throw new Error('The draft changed. Prepare the redline PDF again.');
        const { generateReviewRedlinePdf } = await import('@/services/pdf/reviewRedlinePdf');
        const bytes = await generateReviewRedlinePdf(reviewDecisionSummaryPdfContent(report), () => cancelled() || !ownsReviewDecisionSummaryPdf(report));
        if (cancelled()) return;
        await validateReviewDecisionSummaryPdf(report, policy);
        if (cancelled()) return;
        release();url.current = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
        setPrepared({ report, bytes, url: url.current });setChecked(false);
      }
    } catch (cause) {
      if (!cancelled()) setError(cause instanceof Error ? cause.message : 'The redline PDF could not be prepared. Retry with a smaller review.');
    } finally {
      if (!cancelled()) { running.current = false;setBusy(false);onBusyChange(false, roundId); }
    }
  }
  const details = prepared ? reviewDecisionSummaryPdfContent(prepared.report) : null;
  return <div role="group" aria-label="Redline review PDF" className="space-y-3 rounded-md border p-3 text-sm">
    <h3 className="font-medium">Redline review PDF</h3>
    <p>Capture proposed text, paragraph changes, moves, decisions and discussions as a review copy. The clean document PDF remains a separate export.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {prepared && details && <>
      <p>{details.roundLabel} · Captured {details.capturedAt} · {details.marking}</p>
      <p>Accepted: {details.counts.accepted} · Rejected: {details.counts.rejected} · Open: {details.counts.open} · Conflicting: {details.counts.conflicting}</p>
      <p>Includes rejected text and retained comment context. Later changes invalidate this download. Check every page and script for readable characters. Device fonts determine the embedded appearance; this PDF is searchable but is not a tagged PDF.</p>
      {details.privacy.found ? <p>Possible sensitive information: {[...new Set(details.privacy.findings.map(finding => getPIITypeLabel(finding.type)))].join(', ')}.</p> : <p>The scan found no recognized sensitive patterns. Inspect the retained text before sharing.</p>}
      {details.customMarkings.map((text, i) => <p key={i} className="whitespace-pre-wrap break-words">{text}</p>)}
      {details.notices.map((text, i) => <p key={i}>{text}</p>)}
      <div className="h-[28rem] min-w-0 overflow-hidden rounded-md border" aria-label="Captured redline PDF preview"><PdfViewer pdfUrl={prepared.url} showFullscreen={false} allowOpenInTab={false} /></div>
      <div className="flex items-start gap-2"><Checkbox id={checkbox} checked={checked} disabled={busy} onCheckedChange={value => setChecked(value === true)} /><Label htmlFor={checkbox}>I reviewed this captured review copy and its retained text.</Label></div>
      <Button disabled={disabled || busy || !checked} onClick={() => void run(true)}>Download reviewed redline (.pdf)</Button>
    </>}
    {busy || prepared ? <Button variant="outline" onClick={cancel}>Cancel redline PDF</Button> : <Button variant="outline" disabled={disabled} onClick={() => void run(false)}>Prepare redline PDF</Button>}
    {busy && <p role="status">Preparing captured review PDF…</p>}
  </div>;
}

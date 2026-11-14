import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getExportDeploymentPolicy } from '@/config/classification';
import { captureChangeReport, downloadChangeReport, prepareChangeReport, type ChangeReport, type ReportVersion } from '@/lib/changeReport';
import { getPIITypeLabel } from '@/services/pii/detector';

export function ChangeReportDownload({ before, after, capturedAt, ownsDocument }: {
  before: ReportVersion; after: ReportVersion; capturedAt: string; ownsDocument: () => boolean;
}) {
  const [report, setReport] = useState<ChangeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true;return () => { active.current = false; }; }, []);

  async function review() {
    if (busy) return;
    setError(null);setDownloaded(false);
    if (!ownsDocument()) { setError('The active document changed. Reopen History before preparing a report.');return; }
    const captured = captureChangeReport(before, after, capturedAt);
    setBusy(true);
    try {
      const policy = await getExportDeploymentPolicy(undefined, true);
      if (!active.current) return;
      if (!ownsDocument()) throw new Error('The active document changed. Reopen History before preparing a report.');
      setReport(prepareChangeReport(captured, policy));
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : 'The change report could not be prepared. Try again.');
    } finally { if (active.current) setBusy(false); }
  }

  function download() {
    if (!report) return;
    try {
      if (!ownsDocument()) throw new Error('The active document changed. Reopen History before downloading a report.');
      downloadChangeReport(report);setReport(null);setDownloaded(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The report download failed. Try again.'); }
  }

  return <section aria-label="Download change report" className="space-y-3 rounded-md border border-border p-3">
    <h3 className="text-sm font-medium">Change report</h3>
    <p className="text-xs text-muted-foreground">Printable HTML with full compared values and discussions from the saved version and the current draft captured when History opened. Later edits are excluded. This review derivative is separate from your clean letter exports.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {downloaded && <p role="status" className="text-sm">Change report sent to your browser downloads.</p>}
    {report ? <div className="space-y-3">
      <h4 className="text-sm font-medium">Review report contents before downloading</h4>
      <p className="text-sm">{report.marking} · Includes removed values, retained comment context, reviewer names, and open and resolved discussions from both versions. Check whether everyone receiving the report may see this content.</p>
      <p className="text-xs text-muted-foreground">Paragraph and row comparisons use position. Attachment contents and full configured form template definitions are excluded. No approval or audit status is implied.</p>
      {report.privacy.found ? <p role="status" className="text-sm text-warning">Possible sensitive information in the captured report: {[...new Set(report.privacy.findings.map(finding => getPIITypeLabel(finding.type)))].join(', ')}. Check both versions and discussions before sharing.</p>
        : <p className="text-xs text-muted-foreground">The automatic privacy scan found no recognized patterns. Review all contents, including removed text, before sharing.</p>}
      {report.notices.map(notice => <p key={notice} className="text-sm text-warning">{notice}</p>)}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => { setReport(null);setError(null); }}>Cancel report</Button>
        <Button type="button" onClick={download}><Download className="mr-2 h-4 w-4" />Download reviewed report (.html)</Button>
      </div>
    </div> : <Button type="button" variant="outline" disabled={busy} onClick={() => void review()}>{busy ? 'Checking report contents…' : 'Prepare change report'}</Button>}
  </section>;
}

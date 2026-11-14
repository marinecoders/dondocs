import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionPackage } from '@/lib/actionPackages';
import { getExportDeploymentPolicy } from '@/config/classification';
import { triggerDownload } from '@/lib/encoding';
import { prepareWordPackage, acknowledgeWordPackage, renderWordPackage, type PreparedWordPackage } from '@/services/exports/wordPackage';
import type { CorrespondenceRendererPorts } from '@/services/exports/correspondence';

export function WordPackageDownload({ record, revisionId, ports }: { record: ActionPackage; revisionId: string; ports: CorrespondenceRendererPorts }) {
  const [prepared, setPrepared] = useState<PreparedWordPackage | null>(null), [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => { operation.current?.abort();operation.current = null; }, []);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const owner = new AbortController();operation.current = owner;
    setBusy(true);setError('');setMessage('');
    try { await action(owner.signal); }
    catch (cause) { if (!owner.signal.aborted) setError(cause instanceof Error ? cause.message : 'The Word package could not be delivered.'); }
    finally { if (operation.current === owner) { operation.current = null;setBusy(false); } }
  }
  function cancel() {
    operation.current?.abort();operation.current = null;
    setBusy(false);setPrepared(null);setApproved(false);setMessage('Word package cancelled.');
  }
  return <section className="min-w-0 space-y-3 rounded border p-3" aria-label="Word package delivery" aria-busy={busy}>
    <h3 className="font-medium">Word package</h3>
    <p className="text-sm text-muted-foreground">Download the main document and supported native correspondence as editable DOCX files, together with unchanged original supporting files from this saved revision. Every listed enclosure needs its captured file.</p>
    <Button variant="outline" disabled={busy} onClick={() => {
      const captured = structuredClone(record), selectedRevision = revisionId;
      setPrepared(null);setApproved(false);
      void run(async signal => {
        const policy = await getExportDeploymentPolicy();signal.throwIfAborted();
        const result = await prepareWordPackage(captured, selectedRevision, policy, signal);
        signal.throwIfAborted();setPrepared(result);
      });
    }}>Review Word package</Button>
    {busy && <Button variant="ghost" onClick={cancel}>Cancel Word package</Button>}
    {busy && <p role="status" className="text-sm">Preparing captured Word package…</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="break-words text-sm">{message}</p>}
    {prepared && <div className="space-y-3">
      <p className="break-all text-xs">Captured package: {prepared.packageName} · Revision: {prepared.revisionId}</p>
      {prepared.privacy.findings.map((finding, index) => <p className="break-words text-sm" key={index}>{finding.field}: {finding.type} · {finding.value}</p>)}
      {prepared.reviews.map((entry, index) => <div key={index} className="space-y-1 text-sm"><p className="font-medium">{entry.member}</p>{entry.review.structure.map((finding, index) => <p key={index}>{finding.message}</p>)}{entry.review.notices.map((notice, index) => <p key={index}>{notice}</p>)}{entry.review.markingReview && <p>Review classification markings.</p>}</div>)}
      {prepared.limitations.map((limitation, index) => <p key={index} className="text-xs text-muted-foreground">{limitation}</p>)}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={approved} onChange={event => setApproved(event.target.checked)} />I reviewed this captured revision, the privacy and marking findings, and every original file’s contents and signing status for Word package delivery.</label>
      <Button disabled={busy || !approved} onClick={() => void run(async signal => {
        acknowledgeWordPackage(prepared);
        const result = await renderWordPackage(prepared, ports, signal);
        const bytes = new Uint8Array(await result.blob.arrayBuffer());signal.throwIfAborted();
        triggerDownload(bytes, result.filename, 'application/zip');
        setPrepared(null);setApproved(false);setMessage(`Complete Word package downloaded from revision ${result.manifest.revisionId}: ${result.manifest.measured.fileCount} files. See README.txt and manifest.json for the main document, separate originals and SHA-256 digests.`);
      })}>Download reviewed Word package</Button>
    </div>}
  </section>;
}

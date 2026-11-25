import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PackageFormValues } from '@/lib/packageFormEditing';
import type { PackageMember } from '@/lib/actionPackages';
import { readPackageAsset } from '@/lib/actionPackageAssets';
import { renderPackageRecipientMember } from '@/lib/packageNativeDelivery';
import { reviewPackageOriginal } from '@/lib/actionPackageDisclosure';
import { reviewPackageAttachment } from '@/lib/packageAttachmentCapabilities';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import type { CorrespondenceRendererPorts } from '@/services/exports/correspondence';
import type { ExportGate } from '@/lib/exportController';
import { Button } from './ui/button';

const PdfViewer = lazy(() => import('./pdf/PdfViewer'));
type Ports = CorrespondenceRendererPorts & { waitForReady(timeoutMs: number): Promise<boolean> };

/** Read and render the selected captured member; never activate a library document. */
export function PackageDocumentPreview({ packageId, revisionId, positionId, formPreview, originalOnly, member, active, ports, exportGate }: {
  packageId: string; revisionId: string; originalOnly?: boolean; positionId?: string; formPreview?: PackageFormValues; member: PackageMember; active: boolean; ports: Ports; exportGate: ExportGate;
}) {
  const copy = member.kind === 'original' && !originalOnly ? member.printableCopy?.asset : undefined;
  const [showOriginalOf, setShowOriginalOf] = useState('');
  const printable = copy && showOriginalOf !== member.revisionId ? copy : undefined;
  const owner = `${packageId}:${revisionId}:${member.id}:${member.revisionId}:${printable?.sha256 ?? 'original'}`;
  const [result, setResult] = useState<{ owner: string; slow?: boolean; url?: string; image?: boolean; text?: string; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const latestPorts = useRef(ports);
  useLayoutEffect(() => { latestPorts.current = ports; });
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let current = true, url: string | undefined;
    const timer = window.setTimeout(() => {
      if (current) setResult({ owner, slow: true });
    }, 8000);
    void Promise.resolve().then(async () => {
      controller.signal.throwIfAborted();
      setResult({ owner });
      const policy = await getExportDeploymentPolicy();
      controller.signal.throwIfAborted();
      if (policy.status !== 'ready') throw new Error(policy.message);
      let bytes: ArrayBuffer, type: string, text: string | undefined;
      if (member.kind === 'native') {
        const release = await exportGate.acquireWhenAvailable(controller.signal);
        // The viewer paints native AcroForm appearances. XFA needs its printable rendition.
        const mode = formPreview?.kind === 'configured' ? 'editable' : 'printable';
        try { ({ bytes } = await renderPackageRecipientMember(member, policy, latestPorts.current, readPackageAsset, controller.signal, undefined, mode, formPreview)); }
        finally { release(); }
        type = 'application/pdf';
      } else {
        bytes = await readPackageAsset(printable ?? member.original);
        controller.signal.throwIfAborted();
        type = member.original.type;
        if (member.kind === 'original') await reviewPackageOriginal(bytes, member.label, policy);
        else {
          const inspected = await reviewPackageAttachment(member.original, bytes, policy, controller.signal);
          if (!type.startsWith('image/') && type !== 'application/pdf') {
            text = inspected.inspection.text || 'This file has no supported text preview.';
          }
        }
      }
      controller.signal.throwIfAborted();
      const sync = getExportDeploymentPolicySync();
      if (sync.status !== 'ready' || JSON.stringify(sync.policy) !== JSON.stringify(policy.policy)) throw new Error('The preview policy changed. Retry the preview.');
      if (!current) return;
      if (text !== undefined) { setResult({ owner, text }); return; }
      url = URL.createObjectURL(new Blob([bytes], { type }));
      setResult({ owner, url, image: type.startsWith('image/') });
    }).catch(cause => { if (current && !controller.signal.aborted) setResult({ owner, error: cause instanceof Error && cause.message.trim() ? cause.message : 'The document preview could not be prepared.' }); }).finally(() => window.clearTimeout(timer));
    return () => { current = false; window.clearTimeout(timer); controller.abort(); if (url) URL.revokeObjectURL(url); setResult(value => value?.owner === owner ? undefined : value); };
  }, [active, member, printable, owner, attempt, exportGate, formPreview]);
  const shown = result?.owner === owner ? result : undefined;
  return <section aria-label={`Preview of ${member.label}`} className="min-w-0">
    {active && copy && <label className="mb-2 block text-sm">Preview file <select className="rounded border bg-background px-2 py-1"
      value={printable ? 'print' : 'original'} onChange={event => setShowOriginalOf(event.target.value === 'original' ? member.revisionId : '')}>
      <option value="print">Printable copy · {copy.name}</option><option value="original">Original · {member.kind === 'original' && member.original.name}</option>
    </select></label>}
    {/* Keep document controls in place when the asynchronous preview arrives. */}
    {active && <div className="h-[68dvh] min-h-80 overflow-hidden rounded-md border">
      {shown?.error ? <div className="h-full space-y-3 overflow-auto bg-muted p-5"><p role="alert" className="break-words text-sm">{shown.error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry preview</Button></div>
        : shown?.url ? shown.image ? <img src={shown.url} alt={member.label} className="h-full w-full object-contain" />
          : <Suspense fallback={<p role="status" className="p-5 text-sm">Opening PDF…</p>}><PdfViewer pdfUrl={shown.url} documentId={`package-member:${positionId ?? owner}`} showFullscreen={false} toolbarLabel={formPreview ? "Form preview" : "Saved document preview"} /></Suspense>
          : shown?.text !== undefined ? <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-muted p-5 font-sans text-sm">{shown.text.slice(0,20000)}</pre>
            : shown?.slow ? <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
              <p role="status" className="text-sm text-muted-foreground">Still preparing {member.label}…</p>
              <Button type="button" size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry preview</Button>
            </div>
            : <p role="status" className="flex h-full items-center justify-center p-5 text-center text-sm text-muted-foreground">Preparing document preview…</p>}
    </div>}
  </section>;
}

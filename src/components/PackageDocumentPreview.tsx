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
export function PackageDocumentPreview({ packageId, revisionId, positionId, formPreview, member, active, ports, exportGate }: {
  packageId: string; revisionId: string; positionId?: string; formPreview?: PackageFormValues; member: PackageMember; active: boolean; ports: Ports; exportGate: ExportGate;
}) {
  const owner = `${packageId}:${revisionId}:${member.id}:${member.revisionId}`;
  const [result, setResult] = useState<{ owner: string; url?: string; image?: boolean; text?: string; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const latestPorts = useRef(ports);
  useLayoutEffect(() => { latestPorts.current = ports; });
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let current = true, url: string | undefined;
    void Promise.resolve().then(async () => {
      setResult({ owner });
      const policy = await getExportDeploymentPolicy();
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
        bytes = await readPackageAsset(member.original); type = member.original.type;
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
    }).catch(cause => { if (current && !controller.signal.aborted) setResult({ owner, error: cause instanceof Error ? cause.message : 'The document preview could not be prepared.' }); });
    return () => { current = false; controller.abort(); if (url) URL.revokeObjectURL(url); setResult(value => value?.owner === owner ? undefined : value); };
  }, [active, member, owner, attempt, exportGate, formPreview]);
  const shown = result?.owner === owner ? result : undefined;
  return <section aria-label={`Preview of ${member.label}`} className="min-w-0">
    {/* Keep document controls in place when the asynchronous preview arrives. */}
    {active && <div className="h-[68dvh] min-h-80 overflow-hidden rounded-md border">
      {shown?.error ? <div className="h-full space-y-3 overflow-auto bg-muted p-5"><p role="alert" className="break-words text-sm">{shown.error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry preview</Button></div>
        : shown?.url ? shown.image ? <img src={shown.url} alt={member.label} className="h-full w-full object-contain" />
          : <Suspense fallback={<p role="status" className="p-5 text-sm">Opening PDF…</p>}><PdfViewer pdfUrl={shown.url} documentId={`package-member:${positionId ?? owner}`} showFullscreen={false} toolbarLabel={formPreview ? "Form preview" : "Saved document preview"} /></Suspense>
          : shown?.text !== undefined ? <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-muted p-5 font-sans text-sm">{shown.text.slice(0,20000)}</pre>
            : <p role="status" className="flex h-full items-center justify-center p-5 text-center text-sm text-muted-foreground">Preparing document preview…</p>}
    </div>}
  </section>;
}

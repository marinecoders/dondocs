import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
export function PackageDocumentPreview({ packageId, revisionId, member, active, ports, exportGate }: {
  packageId: string; revisionId: string; member: PackageMember; active: boolean; ports: Ports; exportGate: ExportGate;
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
        try { bytes = await renderPackageRecipientMember(member, policy, latestPorts.current, readPackageAsset, controller.signal); }
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
  }, [active, member, owner, attempt, exportGate]);
  const shown = result?.owner === owner ? result : undefined;
  return <section aria-label={`Preview of ${member.label}`} className="min-w-0 space-y-3">
    {shown?.error ? <div className="space-y-3 rounded-md bg-muted p-5"><p role="alert" className="break-words text-sm">{shown.error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry preview</Button></div>
      : shown?.url ? shown.image ? <img src={shown.url} alt={member.label} className="mx-auto max-h-[65dvh] max-w-full object-contain" />
        : <div className="h-[68dvh] min-h-80 overflow-hidden rounded-md border"><Suspense fallback={<p role="status" className="p-5 text-sm">Opening PDF…</p>}><PdfViewer pdfUrl={shown.url} documentId={`package-member:${owner}`} showFullscreen={false} toolbarLabel="Saved document preview" /></Suspense></div>
        : shown?.text ? <pre className="max-h-[65dvh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-5 font-sans text-sm">{shown.text.slice(0,20000)}</pre>
          : active && <p role="status" className="py-12 text-center text-sm text-muted-foreground">Preparing document preview…</p>}
  </section>;
}

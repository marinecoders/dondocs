import { lazy, Suspense, useEffect, useState } from 'react';
const PdfViewer = lazy(() => import('./pdf/PdfViewer'));

/** A read-only view owns its URL so changing records cannot show a prior file. */
export function PackageSigningPdfPreview({ bytes, label }: { bytes: Uint8Array; label: string }) {
  const [preview, setPreview] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  useEffect(() => {
    let active = true;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
    queueMicrotask(() => { if (active) setPreview({ bytes, url }); });
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [bytes]);
  return <div className="h-96 min-w-0 overflow-hidden rounded border" aria-label={label}>
    {preview?.bytes === bytes ? <Suspense fallback={<p role="status">Opening exact PDF…</p>}><PdfViewer key={preview.url} pdfUrl={preview.url}
      showFullscreen={false} allowOpenInTab={false} toolbarLabel={label} /></Suspense> : <p role="status">Opening exact PDF…</p>}
  </div>;
}

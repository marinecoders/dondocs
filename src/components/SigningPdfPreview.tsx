import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Document, Page } from 'react-pdf';
import { HARDENED_PDF_OPTIONS } from '@/components/pdf/pdfConfig';
import { base64ToUint8Array } from '@/lib/encoding';

type RenderStatus = 'loading' | 'ready' | 'error';

/** A page owns its render result; callbacks from an unmounted page stay local. */
function RenderedSigningPage({ page, width, onStatus }: { page: number; width: number; onStatus(status: RenderStatus): void }) {
  const [status, setStatus] = useState<RenderStatus>('loading');
  const rendered = useCallback(() => setStatus('ready'), []);
  const failed = useCallback(() => setStatus('error'), []);
  useLayoutEffect(() => { onStatus(status);return () => onStatus('loading'); }, [onStatus, status]);
  return <Page pageNumber={page + 1} width={width} devicePixelRatio={Math.min(window.devicePixelRatio || 1, 1.5)}
    renderTextLayer={false} renderAnnotationLayer={false} onRenderSuccess={rendered} onRenderError={failed} onLoadError={failed} />;
}

export function SigningPdfPreview({ data, page, width, height, onReadiness, children }: {
  data: string; page: number; width: number; height: number; onReadiness(ready: boolean): void; children?: ReactNode;
}) {
  const [source, setSource] = useState<{ data: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [renderedPage, setRenderedPage] = useState<{ key: string; status: RenderStatus } | null>(null);
  const pageKey = `${page}:${width}:${height}`;
  const pageStatus = useCallback((status: RenderStatus) => setRenderedPage(current => current?.key === pageKey && current.status === status ? current : { key: pageKey, status }), [pageKey]);
  const documentFailed = useCallback(() => setFailed(true), []);
  const url = source?.data === data ? source.url : '';
  const ready = Boolean(url) && !failed && renderedPage?.key === pageKey && renderedPage.status === 'ready';
  useEffect(() => {
    let active = true;
    const url = URL.createObjectURL(new Blob([new Uint8Array(base64ToUint8Array(data))], { type: 'application/pdf' }));
    queueMicrotask(() => { if (active) setSource({ data, url }); });
    return () => { active = false;URL.revokeObjectURL(url); };
  }, [data]);
  useLayoutEffect(() => { onReadiness(ready);return () => onReadiness(false); }, [onReadiness, ready]);
  return <div className="relative" style={{ width, height }} aria-busy={!ready} data-signing-preview-page>
    {url ? <Document file={url} options={HARDENED_PDF_OPTIONS} loading="Opening saved PDF…" error="The saved PDF preview could not be rendered. Reopen the signing workspace to retry."
      onLoadError={documentFailed} onSourceError={documentFailed}>
      <RenderedSigningPage key={pageKey} page={page} width={width} onStatus={pageStatus} />
    </Document> : <p>Opening saved PDF…</p>}
    {!failed && renderedPage?.key === pageKey && renderedPage.status === 'error' && <p role="alert">The saved PDF page could not be rendered. Reopen the signing workspace to retry.</p>}
    {children}
  </div>;
}

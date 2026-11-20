import { useEffect, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import { Button } from '@/components/ui/button';
import { CORRESPONDENCE_MANUAL as source } from '@/lib/correspondenceManual';
import '@/components/pdf/pdfConfig';

export default function ManualSourcePage({ bytes, page, onPage }: { bytes: Uint8Array; page: number; onPage(page: number): void }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(260);
  const [error, setError] = useState(false);
  // react-pdf requires stable options: a fresh wrapper would repeatedly reload.
  const [file] = useState(() => ({ data: new Uint8Array(bytes) }));
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(160, Math.floor(element.clientWidth)));
    measure();const observer = new ResizeObserver(measure);observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous PDF page</Button>
      <span className="text-xs text-muted-foreground">PDF page {page} of {source.pages}</span>
      <Button size="sm" variant="outline" disabled={page >= source.pages} onClick={() => onPage(page + 1)}>Next PDF page</Button>
    </div>
    <p className="text-xs text-muted-foreground">Original source page. Use the extracted-text view for text search and reading.</p>
    {error && <p role="alert" className="text-sm text-destructive">This source page could not be rendered. Return to the extracted text or download the original PDF.</p>}
    <div ref={container} role="region" className="min-w-0 overflow-hidden rounded border bg-white" aria-label={`Original manual PDF page ${page}`}>
      <Document file={file} loading={<p role="status" className="p-4 text-sm text-black">Loading source PDF…</p>} onLoadError={() => setError(true)}>
        <Page pageNumber={page} width={width} devicePixelRatio={Math.min(devicePixelRatio || 1, 2)} renderTextLayer={false} renderAnnotationLayer={false} onRenderError={() => setError(true)} onRenderSuccess={() => setError(false)} />
      </Document>
    </div>
  </div>;
}

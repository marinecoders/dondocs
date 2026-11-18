import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { assertPackageDeliveryCurrent, readPreparedPackageDeliveryAsset, type PreparedPackageDelivery, type PackageDeliveryFile } from '@/lib/packageDelivery';
import { getExportDeploymentPolicy } from '@/config/classification';
import { inspectPackageAttachment } from '@/lib/packageAttachmentCapabilities';
import { documentTextFields } from '@/lib/documentFields';

const PdfViewer = lazy(() => import('./pdf/PdfViewer'));
interface Props {
  prepared: PreparedPackageDelivery; disabled: boolean;
  run(action: () => Promise<void>): Promise<void>;
  signal(): AbortSignal | undefined; isCurrent(): boolean;
}
/** Preview only files already owned by this exact delivery, with no source or editor fallback. */
export function PackageDeliveryPreview({ prepared, disabled, run, signal, isCurrent }: Props) {
  const [preview, setPreview] = useState<{ file: PackageDeliveryFile; url?: string; image?: boolean; evidence?: boolean; notice?: string; values?: Array<{ label: string; text: string }> }>(), [pending, setPending] = useState(false), [error, setError] = useState(''), [count, setCount] = useState(25);
  const mounted = useRef(false), running = useRef(false);
  const [imageZoom, setImageZoom] = useState(1);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  async function open(file: PackageDeliveryFile) {
    if (disabled || pending || running.current) return;
    running.current = true; setPending(true); setError('');
    try { await run(async () => {
      const operationSignal = signal(), current = () => mounted.current && isCurrent() && signal() === operationSignal && !operationSignal?.aborted;
      try {
        await assertPackageDeliveryCurrent(prepared, await getExportDeploymentPolicy(), operationSignal, current);
        const bytes = await readPreparedPackageDeliveryAsset(prepared, file);
        if (!current()) return;
        setImageZoom(1);
        if (file.type === 'application/pdf') setPreview({ file, url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })) });
        else if (file.type === 'application/json') {
          const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          const values = documentTextFields(raw, 'share').map(field => ({ label: field.label, text: field.text }));
          setCount(25); setPreview({ file, values });
        } else {
          const inspection = await inspectPackageAttachment({ name: file.name, type: file.type, data: bytes }, operationSignal);
          if (!current()) return;
          if (file.type.startsWith('image/')) setPreview({ file, image: true, evidence: true, notice: inspection.notice, url: URL.createObjectURL(new Blob([bytes], { type: file.type })) });
          else { setCount(25); setPreview({ file, evidence: true, notice: `${inspection.notice} Text preview shows up to 4,000 characters; disclosure checks include the full supported text inventory.`, values: inspection.text ? [{ label: 'Retained supporting-file text', text: inspection.text.slice(0, 4000) }] : [] }); }
        }
      } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The captured file could not be previewed.'); }
    }); } catch (cause) { if (mounted.current && isCurrent()) setError(cause instanceof Error ? cause.message : 'The preview could not start.'); }
    finally { running.current = false; if (mounted.current) setPending(false); }
  }
  return <section aria-label="Preview delivery files" className="min-w-0 space-y-2">
    <div className="flex min-w-0 flex-wrap gap-2">{prepared.files.map(file => <Button key={file.id} className="h-auto min-h-9 max-w-full whitespace-normal break-all" variant="outline" size="sm" disabled={disabled || pending} onClick={() => void open(file)}>Preview {file.name}</Button>)}</div>
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    {preview && <section aria-label="Captured delivery file preview" className="min-w-0 space-y-2 rounded border p-2">
      <p className="break-words font-medium">{preview.file.name}</p>
      <Button variant="outline" size="sm" disabled={disabled || pending} onClick={() => setPreview(undefined)}>Close delivery preview</Button>
      {preview.notice && <p className="break-words text-xs text-muted-foreground">{preview.notice}</p>}
      {preview.url && preview.image && <div className="min-w-0 space-y-2">
        <label className="block text-sm">Image zoom<select aria-label="Captured image zoom" className="ml-2 rounded border bg-background p-1" value={imageZoom} onChange={event => setImageZoom(Number(event.target.value))}><option value={1}>Fit width</option><option value={2}>200%</option><option value={4}>400%</option></select></label>
        <div className="max-h-96 min-w-0 overflow-auto rounded border"><img src={preview.url} alt={`Captured delivery source: ${preview.file.name}`} className="h-auto max-w-none" style={{ width: `${imageZoom * 100}%` }} /></div>
      </div>}
      {preview.url && !preview.image && <div className="h-[28rem] min-w-0 overflow-hidden rounded border"><Suspense fallback={<p role="status">Loading PDF preview…</p>}><PdfViewer pdfUrl={preview.url} documentId={`delivery:${prepared.revisionId}:${preview.file.id}`} showFullscreen={false} allowOpenInTab={false} toolbarLabel="Captured delivery PDF" /></Suspense></div>}
      {preview.values && <><p className="text-xs text-muted-foreground">{preview.evidence ? "This text inventory belongs to the exact captured supporting file; it does not reproduce its Office layout." : "Retained editable values include inactive fields and template declarations."}</p>
        <dl className="min-w-0 space-y-2">{preview.values.slice(0, count).map((field, index) => <div key={index} className="rounded border p-2 text-xs"><dt className="break-words font-medium">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{field.text}</dd></div>)}</dl>
        {preview.values.length > count && <Button variant="outline" disabled={disabled || pending} onClick={() => setCount(value => value + 25)}>Show more editable values</Button>}
      </>}
    </section>}
  </section>;
}

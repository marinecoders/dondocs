import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { assertPackageDeliveryCurrent, readPreparedPackageDeliveryAsset, type PreparedPackageDelivery, type PackageDeliveryFile } from '@/lib/packageDelivery';
import { getExportDeploymentPolicy } from '@/config/classification';
import { documentTextFields } from '@/lib/documentFields';

const PdfViewer = lazy(() => import('./pdf/PdfViewer'));
interface Props {
  prepared: PreparedPackageDelivery; disabled: boolean;
  run(action: () => Promise<void>): Promise<void>;
  signal(): AbortSignal | undefined; isCurrent(): boolean;
}
/** Preview only files already owned by this exact delivery, with no source or editor fallback. */
export function PackageDeliveryPreview({ prepared, disabled, run, signal, isCurrent }: Props) {
  const [preview, setPreview] = useState<{ file: PackageDeliveryFile; url?: string; values?: Array<{ label: string; text: string }> }>(), [pending, setPending] = useState(false), [error, setError] = useState(''), [count, setCount] = useState(25);
  const mounted = useRef(false), running = useRef(false);
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
        if (file.type === 'application/pdf') setPreview({ file, url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })) });
        else if (file.type === 'application/json') {
          const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          const values = documentTextFields(raw, 'share').map(field => ({ label: field.label, text: field.text }));
          setCount(25); setPreview({ file, values });
        }
      } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The captured file could not be previewed.'); }
    }); } catch (cause) { if (mounted.current && isCurrent()) setError(cause instanceof Error ? cause.message : 'The preview could not start.'); }
    finally { running.current = false; if (mounted.current) setPending(false); }
  }
  return <section aria-label="Preview delivery files" className="min-w-0 space-y-2">
    <div className="flex min-w-0 flex-wrap gap-2">{prepared.files.filter(file => ['application/pdf', 'application/json'].includes(file.type)).map(file => <Button key={file.id} className="h-auto min-h-9 max-w-full whitespace-normal break-all" variant="outline" size="sm" disabled={disabled || pending} onClick={() => void open(file)}>Preview {file.name}</Button>)}</div>
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    {preview && <section aria-label="Captured delivery file preview" className="min-w-0 space-y-2 rounded border p-2">
      <p className="break-words font-medium">{preview.file.name}</p>
      <Button variant="outline" size="sm" disabled={disabled || pending} onClick={() => setPreview(undefined)}>Close delivery preview</Button>
      {preview.url && <div className="h-[28rem] min-w-0 overflow-hidden rounded border"><Suspense fallback={<p role="status">Loading PDF preview…</p>}><PdfViewer pdfUrl={preview.url} documentId={`delivery:${prepared.revisionId}:${preview.file.id}`} showFullscreen={false} allowOpenInTab={false} toolbarLabel="Captured delivery PDF" /></Suspense></div>}
      {preview.values && <><p className="text-xs text-muted-foreground">Retained editable values include inactive fields and template declarations.</p>
        <dl className="min-w-0 space-y-2">{preview.values.slice(0, count).map((field, index) => <div key={index} className="rounded border p-2 text-xs"><dt className="break-words font-medium">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{field.text}</dd></div>)}</dl>
        {preview.values.length > count && <Button variant="outline" disabled={disabled || pending} onClick={() => setCount(value => value + 25)}>Show more editable values</Button>}
      </>}
    </section>}
  </section>;
}

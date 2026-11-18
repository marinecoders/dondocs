import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { documentTextFields, type DocumentFieldSource } from '@/lib/documentFields';
import { validatePackageTemplate } from '@/lib/packageTemplateLibrary';
import { base64ToUint8Array } from '@/lib/encoding';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';
const PdfViewer = lazy(() => import('./pdf/PdfViewer'));
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
function starterText(value: Record<string, unknown>): string {
  try { return documentTextFields(value as unknown as DocumentFieldSource, 'share').filter(field => field.text.trim()).map(field => `${field.label}: ${field.text}`).join('\n'); }
  catch { return 'Validate the starter declarations before inspecting their retained text.'; }
}
/** Show one explicitly selected preserved asset at a time, with owned URLs and the normal PDF viewer. */
export function PackageTemplateContentsPreview({ template, disabled = false }: { template: PackageTemplateV2; disabled?: boolean }) {
  const [selected, setSelected] = useState<{ template: PackageTemplateV2; label: string; type: string; bytes: Uint8Array } | null>(null);
  const [preview, setPreview] = useState<{ selected: typeof selected; url: string } | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false), [count, setCount] = useState(25);
  const source = useRef(template), alive = useRef(false), generation = useRef(0), running = useRef(false), enabled = useRef(!disabled);
  useLayoutEffect(() => { source.current = template; generation.current++; }, [template]);
  useLayoutEffect(() => { enabled.current = !disabled; }, [disabled]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!selected) return;
    let active = true; const url = URL.createObjectURL(new Blob([new Uint8Array(selected.bytes)], { type: selected.type }));
    queueMicrotask(() => { if (active) setPreview({ selected, url }); });
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [selected]);
  async function open(label: string, type: string, encoded: string) {
    if (disabled || pending || running.current) return; running.current = true;
    const captured = template, version = generation.current; setPending(true); setError('');
    try {
      await validatePackageTemplate(structuredClone(captured));
      if (alive.current && enabled.current && source.current === captured && generation.current === version) setSelected({ template: captured, label, type, bytes: base64ToUint8Array(encoded.replace(/^data:image\/(?:png|jpeg);base64,/, '')) });
    } catch (cause) { if (alive.current && source.current === captured) setError(cause instanceof Error ? cause.message : 'The template asset could not be opened.'); }
    finally { running.current = false; if (alive.current) setPending(false); }
  }
  return <details className="min-w-0 rounded border p-3 text-sm"><summary className="cursor-pointer font-medium">Inspect retained starter text and assets</summary><div className="min-w-0 space-y-3 pt-3">
    {template.members.slice(0, count).map(member => <div key={member.key} className="min-w-0 space-y-2 border-t pt-2"><h4 className="break-words font-medium">{member.label}</h4>
      {member.kind === 'native' ? <>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs">{starterText(member.draft)}</pre>
        <div className="flex flex-wrap gap-2">{Object.entries(member.pages).map(([key, page]) => <Button key={key} className={buttonClass} variant="outline" disabled={disabled || pending} onClick={() => void open(`${member.label}: ${key}`, 'application/pdf', page.data)}>Inspect {member.label} background {key}</Button>)}</div>
        {Array.isArray(member.draft.paragraphs) && member.draft.paragraphs.map((paragraph: unknown, index) => {
          const figure = paragraph && typeof paragraph === 'object' && 'figure' in paragraph ? paragraph.figure : undefined;
          if (!figure || typeof figure !== 'object' || !('data' in figure) || typeof figure.data !== 'string' || !('type' in figure) || typeof figure.type !== 'string' || !['application/pdf', 'image/png', 'image/jpeg'].includes(figure.type)) return null;
          const { data, type } = figure;
          return <Button key={index} className={buttonClass} variant="outline" disabled={disabled || pending} onClick={() => void open(`${member.label}: figure ${index + 1}`, type, data)}>Inspect {member.label} figure {index + 1}</Button>;
        })}
      </> : <p className="text-xs text-muted-foreground">Fresh PDF evidence slot; a previous person's original file is never retained in the starter.</p>}
    </div>)}
    {template.members.length > count && <Button className={buttonClass} variant="outline" onClick={() => setCount(value => value + 25)}>Inspect more starter members</Button>}
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    {selected?.template === template && preview?.selected === selected && <div className="min-w-0 space-y-2"><h4 className="break-words font-medium">{selected.label}</h4>
      {selected.type === 'application/pdf' ? <div aria-label="Exact template PDF asset" className="h-96 min-w-0 overflow-hidden rounded border"><Suspense fallback={<p role="status">Opening retained PDF…</p>}><PdfViewer key={preview.url} pdfUrl={preview.url} showFullscreen={false} allowOpenInTab={false} toolbarLabel="Exact template PDF asset" /></Suspense></div>
        : <img alt={selected.label} src={preview.url} className="max-h-96 max-w-full object-contain" />}
      <Button className={buttonClass} variant="outline" onClick={() => setSelected(null)}>Close template asset preview</Button>
    </div>}
  </div></details>;
}

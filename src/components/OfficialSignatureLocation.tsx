import { useEffect, useState } from 'react';
import { pdfjs } from 'react-pdf';
import { HARDENED_PDF_OPTIONS } from './pdf/pdfConfig';
import { SigningPdfPreview } from './SigningPdfPreview';
import { Button } from './ui/button';
import { identifyOfficialOriginal, officialEdition } from '@/services/forms/nativeCatalog';
import { officialRevisionBytes, type OfficialSigningRecord } from '@/lib/officialSigning';

interface Slot { name: string; label: string; page: number; box: number[] }
async function readLayout(record: OfficialSigningRecord, signal: AbortSignal) {
  const bytes = await officialRevisionBytes(record);
  const id = await identifyOfficialOriginal(bytes.buffer);
  const profile = id && officialEdition(id);
  if (!profile || profile.format !== 'acroform') return;
  signal.throwIfAborted();
  const task = pdfjs.getDocument({ ...HARDENED_PDF_OPTIONS, data: bytes });
  try {
    const pdf = await task.promise;
    const slots: Slot[] = [];
    const sizes: number[][] = [];
    for (let index = 0; index < pdf.numPages; index++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(index + 1);
      const view = page.getViewport({ scale: 1 });
      sizes.push([view.width, view.height]);
      for (const widget of await page.getAnnotations()) {
        if (widget.fieldType !== 'Sig' || !widget.fieldName || !Array.isArray(widget.rect)) continue;
        const [x1, y1, x2, y2] = view.convertToViewportRectangle(widget.rect);
        slots.push({ name: widget.fieldName, label: widget.alternativeText || widget.fieldName, page: index,
          box: [Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1)] });
      }
    }
    return { sizes, slots };
  } finally { await task.destroy(); }
}

/** Reads only the saved bytes. Certificate trust and signing permission come from the bridge. */
interface LocationProps { initiallyOpen?: boolean; record: OfficialSigningRecord; choice: string; onChoice(value: string): void; paired: boolean }

export function OfficialSignatureLocation(props: LocationProps) {
  const [open, setOpen] = useState(props.initiallyOpen ?? false);
  return <div className="space-y-2">
    <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>Review signature location</Button>
    {open && <SignatureLocations {...props} />}
  </div>;
}

function SignatureLocations({ record, choice, onChoice, paired }: LocationProps) {
  const [layout, setLayout] = useState<Awaited<ReturnType<typeof readLayout>>>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void readLayout(record, signal).then(value => {
      if (signal.aborted) return;
      if (value?.slots.length) setLayout(value);
      else setError('This PDF has no signature location available for preview.');
    }).catch(() => {
      if (!signal.aborted) setError('The signature locations could not be read from this revision.');
    });
    return () => controller.abort();
  }, [record]);
  const first = layout?.slots[0]?.name;
  useEffect(() => {
    if (first && !choice && !paired) onChoice(first);
  }, [first, choice, paired, onChoice]);
  if (error) return <p role="alert">{error}</p>;
  if (!layout?.slots.length) return <p role="status">Reading signature locations…</p>;
  const slot = layout.slots.find(item => item.name === choice) ?? layout.slots[0];
  return <><label className="grid gap-1 text-sm">PDF signature location<select value={slot.name} disabled={paired}
      className="rounded border bg-background p-2" onChange={event => onChoice(event.target.value)}>
      {layout.slots.map(item => <option key={item.name} value={item.name}>{item.label}</option>)}</select></label>
    <SignaturePages key={slot.name} data={record.data} slot={slot} sizes={layout.sizes} />
  </>;
}

function SignaturePages({ data, slot, sizes }: { data: string; slot: Slot; sizes: number[][] }) {
  const [page, setPage] = useState(slot.page);
  const [ready, setReady] = useState(false);
  const [left, top, width, height] = slot.box;
  return <>
      <div className="flex items-center gap-3 text-sm">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous page</Button>
        <span>Page {page + 1} of {sizes.length}</span>
        <Button size="sm" variant="outline" disabled={page + 1 === sizes.length} onClick={() => setPage(page + 1)}>Next page</Button>
      </div>
      <div className="max-h-[55dvh] overflow-auto rounded border"><SigningPdfPreview data={data} page={page}
        width={sizes[page][0]} height={sizes[page][1]} onReadiness={setReady}>
        {ready && page === slot.page && <span aria-hidden className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={{left, top, width, height}} />}
      </SigningPdfPreview></div></>;
}

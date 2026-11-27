import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readSignatureLayout, type Slot } from '@/services/forms/signatureLayout';
import type { OfficialInspection } from '@/services/forms/signingBridge';
import { SigningPdfPreview } from './SigningPdfPreview';
import { Button } from './ui/button';
import { identifyOfficialOriginal, officialEdition } from '@/services/forms/nativeCatalog';
import { officialRevisionBytes, type OfficialSigningRecord } from '@/lib/officialSigning';

async function readLayout(record: OfficialSigningRecord, signal: AbortSignal) {
  const bytes = await officialRevisionBytes(record);
  const id = await identifyOfficialOriginal(bytes.buffer);
  const profile = id ? officialEdition(id) : undefined;
  if (profile && profile.format === 'xfa') return null;
  const layout = await readSignatureLayout(bytes, signal);
  const { officialSignatureLabels } = await import('@/lib/packageSignatureFieldLabel');
  const labels = profile?.definitionSha256 ? await officialSignatureLabels({ id: profile.formId, edition: profile.edition }).catch(() => undefined) : undefined;
  const slots = layout.slots
    .map(slot => ({ ...slot, label: labels?.get(slot.name) || slot.label }))
    .sort((a, b) => a.page - b.page || a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  return { ...layout, slots };
}

/** Reads only the saved bytes. Certificate trust and signing permission come from the bridge. */
interface LocationProps {
  signatureLabels?: ReadonlyMap<string, string>;
  requireChoice?: boolean;
  initiallyOpen?: boolean;
  record: OfficialSigningRecord;
  choice: string;
  onChoice(value: string): void;
  inspectedFields?: OfficialInspection['fields'];
  connected?: boolean;
}

export function OfficialSignatureLocation(props: LocationProps) {
  const [open, setOpen] = useState(props.initiallyOpen ?? false);
  return <div className="min-w-0 space-y-2">
    {!props.initiallyOpen && <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>Review signature location</Button>}
    {open && <SignatureLocations {...props} />}
  </div>;
}

function SignatureLocations({ record, choice, onChoice, inspectedFields, requireChoice, connected, signatureLabels }: LocationProps) {
  const [layout, setLayout] = useState<Awaited<ReturnType<typeof readLayout>>>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void readLayout(record, signal).then(value => {
      if (!signal.aborted) setLayout(value);
    }).catch(() => {
      if (!signal.aborted) setError('The signature locations could not be read from this revision.');
    });
    return () => controller.abort();
  }, [record]);

  const first = !requireChoice && !inspectedFields && layout?.slots[0];
  useEffect(() => {
    if (first && !choice) onChoice(first.name);
  }, [first, choice, onChoice]);
  const positions = new Map(layout?.slots.map((slot, index) => [slot.name, index]));
  const fields = inspectedFields
    ? [...inspectedFields].sort((a, b) => (positions.get(a.name) ?? Infinity) - (positions.get(b.name) ?? Infinity))
    : layout?.slots;
  const slot = layout?.slots.find(item => item.name === (choice || (first && first.name)));
  return <>
    {!!fields?.length && <label className="grid gap-1 text-sm">Signature field
      <select className="min-w-0 rounded border bg-background p-2" value={choice || (first && first.name) || ''}
        onChange={event => onChoice(event.target.value)}>
        <option value="" disabled>Select a signature field</option>
        {fields.map(item => {
          const status = 'signed' in item ? item.signed ? 'Signed' : item.locked ? 'Locked' : '' : '';
          return <option key={item.name} value={item.name} disabled={!!status}>{signatureLabels?.get(item.name) || item.label}{status && ` · ${status}`}</option>;
        })}
      </select>
    </label>}
    {error ? <p role="alert">{error}</p> : layout === null
      ? <p className="text-sm">Download the PDF to review its filled fields before signing.
          {!connected && ' Connect your CAC to see the available signature fields.'}</p>
      : !layout ? <p role="status">Reading signature locations…</p>
      : slot ? <SignaturePages key={slot.name} data={record.data} slot={slot} sizes={layout.sizes} />
      : choice ? <p role="status">This field has no location available in the preview.</p>
      : !layout.slots.length && <p className="text-sm">This PDF has no signature location available for preview.</p>}
  </>;
}

function SignaturePages({ data, slot, sizes }: { data: string; slot: Slot; sizes: number[][] }) {
  const [page, setPage] = useState(slot.page);
  const [ready, setReady] = useState(false);
  const pane = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const [left, top, width, height] = slot.box;
  useLayoutEffect(() => {
    if (!ready || !pane.current || !highlight.current) return;
    const viewport = pane.current;
    const frame = viewport.getBoundingClientRect(), mark = highlight.current.getBoundingClientRect();
    // Scroll just the PDF pane. Selecting a field keeps keyboard focus and the dialog in place.
    if (mark.top < frame.top || mark.bottom > frame.bottom)
      viewport.scrollTop += (mark.top + mark.bottom - frame.top - frame.bottom) / 2;
    if (mark.left < frame.left || mark.right > frame.right)
      viewport.scrollLeft += (mark.left + mark.right - frame.left - frame.right) / 2;
  }, [ready, page]);
  return <>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous page</Button>
      <span>Page {page + 1} of {sizes.length}</span>
      <Button size="sm" variant="outline" disabled={page + 1 === sizes.length} onClick={() => setPage(page + 1)}>Next page</Button>
    </div>
    <div ref={pane} role="region" tabIndex={0} aria-label="Signature location preview" className="max-h-[45dvh] overflow-auto rounded border md:max-h-[55dvh]">
      <SigningPdfPreview data={data} page={page} width={sizes[page][0]} height={sizes[page][1]} onReadiness={setReady}>
        {ready && page === slot.page && <span aria-hidden ref={highlight} className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={{ left, top, width, height }} />}
      </SigningPdfPreview>
    </div>
  </>;
}

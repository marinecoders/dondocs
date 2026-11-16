import { useEffect, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import { HARDENED_PDF_OPTIONS } from '@/components/pdf/pdfConfig';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { base64ToUint8Array, triggerDownload } from '@/lib/encoding';
import { placeManualSignatureFields, type ManualSignature } from '@/lib/manualSignatureFields';
import { createSigningRecord, listSigningRecords, updateSigningFields, type SigningRecord } from '@/lib/signingWorkspace';

export default function SigningWorkspace({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[95dvh] max-w-5xl flex-col overflow-hidden">
    <DialogHeader><DialogTitle>Signing workspace</DialogTitle><DialogDescription>Place signature fields on an exact unsigned PDF. Existing fields remain in the file. Sign the prepared PDF in your signing application.</DialogDescription></DialogHeader>
    {open && <SigningEditor />}
  </DialogContent></Dialog>;
}

function SigningEditor() {
  const [records, setRecords] = useState<SigningRecord[]>([]);
  const [record, setRecord] = useState<SigningRecord | null>(null);
  const [fields, setFields] = useState<ManualSignature[]>([]);
  const [page, setPage] = useState(0), [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState(''), [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const request = useRef(0);
  const working = useRef(false);
  const field = fields.find(value => value.id === selected);
  const update = (next: ManualSignature[]) => { setFields(next);setReviewed(false);setNotice(''); };
  const selectRecord = (next: SigningRecord) => {
    setRecord(next);setFields(structuredClone(next.fields));setPage(0);setSelected(next.fields[0]?.id ?? '');setReviewed(false);setError('');setNotice('');
  };
  useEffect(() => {
    const token = ++request.current;
    void listSigningRecords().then(saved => { if (token === request.current) { setRecords(saved);if (saved[0]) selectRecord(saved[0]); } })
      .catch(cause => { if (token === request.current) setError(cause instanceof Error ? cause.message : 'Saved signing drafts could not be opened.'); });
    return () => { request.current++; };
  }, []);
  const sourceData = record?.source.data, sourceId = record?.id;
  useEffect(() => {
    if (!sourceData) return;
    let active = true;
    const next = URL.createObjectURL(new Blob([new Uint8Array(base64ToUint8Array(sourceData))], { type: 'application/pdf' }));
    queueMicrotask(() => { if (active) setUrl(next); });
    return () => { active = false;URL.revokeObjectURL(next); };
  }, [sourceData, sourceId]);

  async function run(operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    const token = ++request.current;setBusy(true);setError('');setNotice('');
    try { await operation(); }
    catch (cause) { if (token === request.current) setError(cause instanceof Error ? cause.message : 'The signing operation failed.'); }
    finally { working.current = false;if (token === request.current) setBusy(false); }
  }
  async function save() {
    if (!record) return null;
    const token = request.current, saved = await updateSigningFields(record, fields, () => token === request.current);
    if (token !== request.current) return null;
    setRecord(saved);setRecords(all => [saved, ...all.filter(value => value.id !== saved.id)]);
    setNotice('Signature placement saved in this browser.');return saved;
  }
  function changeField(values: Partial<ManualSignature>) {
    update(fields.map(value => value.id === selected ? { ...value, ...values } : value));
  }
  const geometry = record?.source.pages[page];
  const rotated = geometry && geometry.rotation % 180 !== 0;
  const previewWidth = 480 * zoom;
  const previewHeight = geometry ? previewWidth * (rotated ? geometry.width / geometry.height : geometry.height / geometry.width) : 0;

  return <div className="min-h-0 space-y-4 overflow-y-auto pr-1" aria-busy={busy}>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <label className="block text-sm">Unsigned PDF for signing<input className="mt-1 block w-full" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={event => {
      const file = event.target.files?.[0];event.target.value = '';
      if (!file) return;
      void run(async () => {
        const token = request.current, created = await createSigningRecord(new Uint8Array(await file.arrayBuffer()), file.name, () => token === request.current);
        if (token !== request.current) return;
        setRecords(all => [created, ...all]);selectRecord(created);setNotice('Exact source PDF saved. Add the fields you need.');
      });
    }} /></label>
    <p className="text-xs text-muted-foreground">Up to 20 MB and 100 pages. Signing drafts are stored in this browser; download the files you need to keep.</p>
    {!!records.length && <label className="block text-sm">Saved signing draft<select className="ml-2 max-w-full rounded border p-2" value={record?.id ?? ''} disabled={busy} onChange={event => {
      const next = records.find(value => value.id === event.target.value);if (next) selectRecord(next);
    }}>{records.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}</select></label>}
    {record && <>
      <p className="break-all text-xs">Source SHA-256: {record.source.sha256}</p>
      {!!record.source.existingFieldNames.length && <p className="text-sm">Existing fields are preserved: {record.source.existingFieldNames.join(', ')}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">Signing page<select className="ml-2 rounded border p-2" value={page} onChange={event => setPage(Number(event.target.value))}>{record.source.pages.map((_, index) => <option key={index} value={index}>Page {index + 1}</option>)}</select></label>
        <label className="text-sm">Signing preview zoom<select className="ml-2 rounded border p-2" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{value * 100}%</option>)}</select></label>
        <Button disabled={busy || fields.length >= 30} onClick={() => {
          const added: ManualSignature = { id: crypto.randomUUID(), signer: `Signer ${fields.length + 1}`, page, x: 0.5, y: 0.65, width: 0.3, height: 0.06 };
          update([...fields, added]);setSelected(added.id);
        }}>Add signature box</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="overflow-auto rounded border bg-muted p-2" aria-label="Signing PDF preview">
          {url && <Document file={url} options={HARDENED_PDF_OPTIONS} loading="Opening saved PDF…" error="The saved PDF preview could not be rendered."><div className="relative" style={{ width: previewWidth, height: previewHeight }}>
            <Page pageNumber={page + 1} width={previewWidth} devicePixelRatio={Math.min(window.devicePixelRatio || 1, 1.5)} renderTextLayer={false} renderAnnotationLayer={false} />
            {fields.filter(value => value.page === page).map(value => <button key={value.id} type="button" aria-label={`Select signature box for ${value.signer}`} aria-pressed={value.id === selected} onClick={() => setSelected(value.id)}
              className={`absolute overflow-hidden border-2 px-1 text-left text-xs ${value.id === selected ? 'border-blue-700 bg-blue-100/80 text-blue-950' : 'border-slate-700 bg-white/80 text-slate-950'}`}
              style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.width * 100}%`, height: `${value.height * 100}%` }}>{value.signer}</button>)}
          </div></Document>}
        </div>
        <div className="space-y-3">
          {!!fields.length && <label className="block text-sm">Signature box<select className="mt-1 w-full rounded border p-2" value={selected} onChange={event => { setSelected(event.target.value);const next = fields.find(value => value.id === event.target.value);if (next) setPage(next.page); }}>{fields.map((value, index) => <option key={value.id} value={value.id}>{index + 1}. {value.signer} · page {value.page + 1}</option>)}</select></label>}
          {field && <fieldset disabled={busy} className="space-y-3"><legend className="text-sm font-medium">Selected signature placement</legend>
            <label className="block text-sm">Signer name<input className="mt-1 w-full rounded border p-2" maxLength={120} value={field.signer} onChange={event => changeField({ signer: event.target.value })} /></label>
            {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key} className="block text-sm">{({ x: 'Left (%)', y: 'Top (%)', width: 'Width (%)', height: 'Height (%)' })[key]}<input className="mt-1 w-full rounded border p-2" type="number" step="0.1" min={key === 'width' || key === 'height' ? 1 : 0} max={100} value={Math.round(field[key] * 1000) / 10} onChange={event => changeField({ [key]: Number(event.target.value) / 100 })} /></label>)}
            <Button variant="outline" onClick={() => { update(fields.filter(value => value.id !== selected));setSelected(fields.find(value => value.id !== selected)?.id ?? ''); }}>Remove selected box</Button>
          </fieldset>}
          <p className="text-xs text-muted-foreground">Positions use percentages from the displayed page’s top-left corner. Change Left/Top to move a box and Width/Height to resize it.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run(async () => { await save(); })}>Save signature placement</Button></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed every page, the signer assignments, and the placement of every signature box.</label>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !reviewed || !fields.length} onClick={() => void run(async () => {
        const saved = await save();if (!saved) return;
        const token = request.current, bytes = await placeManualSignatureFields(base64ToUint8Array(saved.source.data), saved.fields);
        if (token !== request.current) return;
        triggerDownload(bytes, `signing-${saved.source.filename}`, 'application/pdf');setNotice('Prepared PDF downloaded. Complete signing in your signing application.');
      })}>Download PDF with signature boxes</Button>
        <Button variant="outline" disabled={busy || !reviewed} onClick={() => triggerDownload(base64ToUint8Array(record.source.data), record.source.filename, 'application/pdf')}>Download unchanged source PDF</Button>
      </div>
    </>}
  </div>;
}

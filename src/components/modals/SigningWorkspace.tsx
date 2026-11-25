import type { OfficialInspection } from '@/services/forms/signingBridge';
import { identifyOfficialOriginal } from '@/services/forms/nativeCatalog';
import { idbDeleteSigningRecord } from '@/lib/documentsDb';
import { OfficialFormSigning } from '@/components/OfficialFormSigning';
import { saveOfficialRevision, officialSigningRecords, type OfficialSigningRecord } from '@/lib/officialSigning';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SigningPdfPreview } from '@/components/SigningPdfPreview';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { base64ToUint8Array, triggerDownload } from '@/lib/encoding';
import { MAX_SIGNING_PDF_BYTES, placeManualSignatureFields, type ManualSignature } from '@/lib/manualSignatureFields';
import { createSigningRecord, createSigningHandoff, downloadSigningHandoff, exportSigningRecord, importSigningRecord, loadSigningInventory, removeSigningRecord, removeUnreadableSigningRecord, signingErrorMessage, updateSigningFields, type SigningRecord, type UnreadableSigningRecord } from '@/lib/signingWorkspace';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';
import { showAppConfirm } from '@/stores/alertStore';
import { SigningReturnReview } from '@/components/SigningReturnReview';
import { confirmSigningDisclosure } from '@/components/signingDisclosure';
import { signingRecordDisclosure } from '@/lib/signingDisclosure';

export default function SigningWorkspace({ open, onOpenChange, initialRecordId, initialField, onAttach }: { open: boolean; onOpenChange(open: boolean): void; initialRecordId?: string; initialField?: string; onAttach?(record: OfficialSigningRecord, inspection: OfficialInspection): Promise<void> }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[95dvh] max-w-5xl flex-col overflow-hidden sm:max-w-5xl">
    <DialogHeader><DialogTitle>Signing workspace</DialogTitle><DialogDescription>Review the PDF revision, select a signature field, and save the signed original.</DialogDescription></DialogHeader>
    {open && <SigningRecords key={initialRecordId} initialRecordId={initialRecordId} initialField={initialField} onAttach={onAttach} />}
  </DialogContent></Dialog>;
}

function SigningRecords({ initialRecordId, initialField, onAttach }: { initialRecordId?: string; initialField?: string; onAttach?(record: OfficialSigningRecord, inspection: OfficialInspection): Promise<void> }) {
  const [records, setRecords] = useState<OfficialSigningRecord[]>([]);
  const [selected, setSelected] = useState(initialRecordId ?? '');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void officialSigningRecords().then(rows => { if (active) setRecords(rows); })
      .catch(cause => { if (active) setError(signingErrorMessage(cause)); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  const record = records.find(item => item.id === selected);
  return <div className="min-h-0 space-y-3 overflow-y-auto">
    {error && <p role="alert">{error}</p>}
    {!onAttach && <label className="block text-sm">Open an official form PDF
      <input type="file" accept="application/pdf,.pdf" className="mt-1 block" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        try {
          if (file.size > MAX_SIGNING_PDF_BYTES) throw new Error('Choose a PDF up to 20 MB.');
          const data = await file.arrayBuffer();
          if (!await identifyOfficialOriginal(data)) throw new Error('Choose an original PDF from a supported official edition.');
          const next = await saveOfficialRevision(file.name, new Uint8Array(data), () => true);
          setRecords(rows => [next, ...rows]); setSelected(next.id); setError('');
        } catch (cause) { setError(signingErrorMessage(cause)); }
      }} /></label>}
    {records.length > 0 && !onAttach && <label className="block text-sm">Signing file
      <select className="ml-2 rounded border bg-background p-2" value={record?.id ?? ''} onChange={e => setSelected(e.target.value)}>
        <option value="">PDF handoffs and placement</option>
        {records.map(item => <option key={item.id} value={item.id}>{item.filename} · Revision {item.revisions.length}</option>)}
      </select></label>}
    {record ? <OfficialFormSigning key={record.id} record={record} initialField={record.id === initialRecordId ? initialField : undefined} onAttach={onAttach}
      onSave={saved => setRecords(rows => rows.map(item => item.id === saved.id ? saved : item))} />
      : loaded && !onAttach ? <SigningEditor initialRecordId={selected || undefined} /> : <p role="status">{loaded ? 'This signing file is unavailable.' : 'Opening signing records…'}</p>}
    {record && !onAttach && <Button variant="ghost" size="sm" onClick={async () => {
      if (!await showAppConfirm({ title: 'Remove this signing file?', message: 'Download any revisions you need before removing the local signing file.', confirmLabel: 'Remove file' })) return;
      try {
        if (!await idbDeleteSigningRecord(record)) throw new Error('The file changed. Reopen the workspace and try again.');
        setRecords(rows => rows.filter(item => item.id !== record.id)); setSelected('');
      } catch (cause) { setError(signingErrorMessage(cause)); }
    }}>Remove signing file</Button>}
  </div>;
}

function SigningEditor({ initialRecordId }: { initialRecordId?: string }) {
  const [records, setRecords] = useState<SigningRecord[]>([]);
  const [unreadable, setUnreadable] = useState<UnreadableSigningRecord[]>([]);
  const [record, setRecord] = useState<SigningRecord | null>(null);
  const [fields, setFields] = useState<ManualSignature[]>([]);
  const [page, setPage] = useState(0), [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<{ key: string; ready: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const request = useRef(0);
  const working = useRef(false);
  const field = fields.find(value => value.id === selected);
  const hasSignatureFields = fields.length > 0 || (record?.source.existingSignatureNames?.length ?? 0) > 0;
  const update = (next: ManualSignature[]) => { setFields(next);setReviewed(false);setNotice(''); };
  const selectRecord = (next: SigningRecord) => {
    setRecord(next);setFields(structuredClone(next.fields));setPage(0);setSelected(next.fields[0]?.id ?? '');setReviewed(false);setError('');setNotice('');
  };
  useEffect(() => {
    const owner = request, generation = ++owner.current;
    void loadSigningInventory().then(inventory => { if (generation === owner.current) { setRecords(inventory.records);setUnreadable(inventory.unreadable);const selected = inventory.records.find(value => value.id === initialRecordId) ?? inventory.records[0];if (selected) selectRecord(selected); } })
      .catch(cause => { if (generation === owner.current) setError(cause instanceof Error ? cause.message : 'Saved signing drafts could not be opened.'); });
    return () => { owner.current++; };
  }, [initialRecordId]);
  const sourceKey = record ? `${record.id}:${record.source.sha256}` : '';
  const previewKey = `${sourceKey}:${page}:${zoom}`;
  const previewReady = preview?.key === previewKey && preview.ready;
  const previewReadiness = useCallback((ready: boolean) => {
    setPreview(current => current?.key === previewKey && current.ready === ready ? current : { key: previewKey, ready });
    if (!ready) setReviewed(false);
  }, [previewKey]);

  async function run(operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    const generation = ++request.current;setBusy(true);setError('');setNotice('');
    try { await operation(); }
    catch (cause) { if (generation === request.current) setError(signingErrorMessage(cause)); }
    finally { working.current = false;if (generation === request.current) setBusy(false); }
  }
  async function save() {
    if (!record) return null;
    const generation = request.current, saved = await updateSigningFields(record, fields, () => generation === request.current);
    if (generation !== request.current) return null;
    setRecord(saved);setRecords(all => [saved, ...all.filter(value => value.id !== saved.id)]);
    setNotice('Signature placement saved in this browser.');return saved;
  }
  function runPdf(operation: () => Promise<{ bytes: Uint8Array; filename: string; metadata?: unknown } | null>) {
    if (working.current || !reviewed || !previewReady) return;
    let lease = reserveSigningPdfDownload();
    void run(async () => {
      const generation = request.current;
      try {
        const result = await operation();if (!result || generation !== request.current) return;
        await confirmSigningDisclosure({ pdfs: [{ bytes: result.bytes, label: result.filename }], metadata: result.metadata }, () => generation === request.current,
          { onPrivacyReview: () => lease.release(), onPrivacyApproved: () => { lease = reserveSigningPdfDownload(); } });
        if (generation !== request.current) return;
        if (!await lease.deliver(result.bytes, result.filename, () => generation === request.current)) throw new Error('The PDF could not be delivered. Retry in a supported browser.');
        if (generation === request.current) setNotice('PDF delivered to your browser. Complete signing in your signing application.');
      } finally { lease.release(); }
    });
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
    {!!unreadable.length && <section aria-label="Unreadable signing records" className="space-y-3 rounded border p-3">
      <h3 className="font-medium">Unreadable signing records</h3>
      <p className="text-sm">Readable records remain available below. These entries need recovery; they have not been changed. A recovery download contains their raw saved data and may include original PDFs. It is unencrypted.</p>
      {unreadable.map((problem, index) => <div className="space-y-2" key={problem.id ?? index}>
        <p className="text-sm">Record {index + 1}: {problem.message}</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          const generation = request.current;
          await confirmSigningDisclosure(signingRecordDisclosure(problem.data), () => generation === request.current);
          if (generation !== request.current) return;
          triggerDownload(new TextEncoder().encode(JSON.stringify(problem.data)), `unreadable-signing-${problem.id ?? index + 1}.json`, 'application/json');
        })}>Download recovery data {index + 1}</Button>
          <Button variant="outline" disabled={busy || !problem.id} onClick={() => void run(async () => {
            const generation = request.current;
            if (!await showAppConfirm({ title: 'Remove unreadable signing record?', message: 'Download its recovery data first if you need to retain the original PDFs. Removal permanently releases this entry from this browser.', confirmLabel: 'Remove unreadable record' }) || generation !== request.current) return;
            await removeUnreadableSigningRecord(problem, () => generation === request.current);
            if (generation === request.current) setUnreadable(all => all.filter(value => value !== problem));
          })}>Remove unreadable record {index + 1}</Button></div>
      </div>)}
    </section>}
    <label className="block text-sm">Unsigned PDF for signing<input className="mt-1 block w-full" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={event => {
      const file = event.target.files?.[0];event.target.value = '';
      if (!file) return;
      void run(async () => {
        if (file.size > MAX_SIGNING_PDF_BYTES) throw new Error('Choose a PDF no larger than 20 MB.');
        const generation = request.current, created = await createSigningRecord(new Uint8Array(await file.arrayBuffer()), file.name, () => generation === request.current);
        if (generation !== request.current) return;
        setRecords(all => [created, ...all]);selectRecord(created);setNotice('Exact source PDF saved. Add the fields you need.');
      });
    }} /></label>
    <p className="text-xs text-muted-foreground">Up to 20 MB and 100 pages per PDF, 20 saved records and 96 MB of encoded record data in this browser. Download a signing record to retain or transfer its originals, placements and handoffs. Signing records are separate from workspace backups.</p>
    <label className="block text-sm">Import signing record<input className="mt-1 block w-full" type="file" accept="application/json,.json" disabled={busy} onChange={event => {
      const file = event.target.files?.[0];event.target.value = '';if (!file) return;
      void run(async () => {
        if (file.size > 96 * 1024 * 1024) throw new Error('The signing record exceeds 96 MB.');
        const generation = request.current, imported = await importSigningRecord(JSON.parse(await file.text()), () => generation === request.current);
        if (generation !== request.current) return;
        setRecords(all => [imported, ...all.filter(value => value.id !== imported.id)]);selectRecord(imported);setNotice('Signing record imported with its exact saved PDFs.');
      });
    }} /></label>
    {!!records.length && <label className="block text-sm">Saved signing draft<select className="ml-2 max-w-full rounded border p-2" value={record?.id ?? ''} disabled={busy} onChange={event => {
      const next = records.find(value => value.id === event.target.value);if (next) selectRecord(next);
    }}>{records.map(value => <option key={value.id} value={value.id}>{value.title} · {new Date(value.createdAt).toLocaleString()}{value.sourceRevision ? ` · edit ${value.sourceRevision.editSequence}` : ''}</option>)}</select></label>}
    {record && <>
      <p className="break-all text-xs">Source SHA-256: {record.source.sha256}</p>
      {record.sourceRevision && <p className="break-all text-xs">Captured draft: {record.sourceRevision.documentId} · edit {record.sourceRevision.editSequence} · {new Date(record.sourceRevision.capturedAt).toLocaleString()}. Later draft changes do not update this PDF.</p>}
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
        <div className="overflow-auto rounded border bg-muted p-2" role="region" tabIndex={0} aria-label="Signing PDF preview">
          <SigningPdfPreview key={sourceKey} data={record.source.data} page={page} width={previewWidth} height={previewHeight} onReadiness={previewReadiness}>
            {fields.filter(value => value.page === page).map(value => <button key={value.id} type="button" aria-label={`Select signature box for ${value.signer}`} aria-pressed={value.id === selected} onClick={() => setSelected(value.id)}
              className={`absolute overflow-hidden border-2 px-1 text-left text-xs ${value.id === selected ? 'border-blue-700 bg-blue-100/80 text-blue-950' : 'border-slate-700 bg-white/80 text-slate-950'}`}
              style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.width * 100}%`, height: `${value.height * 100}%` }}>{value.signer}</button>)}
          </SigningPdfPreview>
        </div>
        <div className="space-y-3">
          {!!fields.length && <label className="block text-sm">Signature box<select className="mt-1 w-full rounded border p-2" value={selected} onChange={event => { setSelected(event.target.value);const next = fields.find(value => value.id === event.target.value);if (next) setPage(next.page); }}>{fields.map((value, index) => <option key={value.id} value={value.id}>{index + 1}. {value.signer} · page {value.page + 1}</option>)}</select></label>}
          {field && <fieldset disabled={busy} className="space-y-3"><legend className="text-sm font-medium">Selected signature placement</legend>
            <label className="block text-sm">Signer name<input className="mt-1 w-full rounded border p-2" maxLength={120} value={field.signer} onChange={event => changeField({ signer: event.target.value })} /></label>
            <label className="block text-sm">Signature box page<select className="mt-1 w-full rounded border p-2" value={field.page} onChange={event => { const nextPage = Number(event.target.value);changeField({ page: nextPage });setPage(nextPage); }}>{record.source.pages.map((_, index) => <option key={index} value={index}>Page {index + 1}</option>)}</select></label>
            {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key} className="block text-sm">{({ x: 'Left (%)', y: 'Top (%)', width: 'Width (%)', height: 'Height (%)' })[key]}<input className="mt-1 w-full rounded border p-2" type="number" step="0.1" min={key === 'width' || key === 'height' ? 1 : 0} max={100} value={Math.round(field[key] * 1000) / 10} onChange={event => changeField({ [key]: Number(event.target.value) / 100 })} /></label>)}
            <Button variant="outline" onClick={() => { update(fields.filter(value => value.id !== selected));setSelected(fields.find(value => value.id !== selected)?.id ?? ''); }}>Remove selected box</Button>
          </fieldset>}
          <p className="text-xs text-muted-foreground">Positions use percentages from the displayed page’s top-left corner. Change Left/Top to move a box and Width/Height to resize it.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run(async () => { await save(); })}>Save signature placement</Button></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || !previewReady} onChange={event => setReviewed(event.target.checked)} />I reviewed every page, signer assignments, signature placement, personal information and document markings, including text inside images.</label>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !reviewed || !previewReady || !hasSignatureFields} onClick={() => runPdf(async () => {
        const saved = await save();if (!saved) return null;
        const generation = request.current, bytes = await placeManualSignatureFields(base64ToUint8Array(saved.source.data), saved.fields);
        if (generation !== request.current) return null;
        return { bytes, filename: `signing-${saved.source.filename}`, metadata: { fields: saved.fields, existingFieldNames: saved.source.existingFieldNames } };
      })}>Download PDF with signature boxes</Button>
        <Button variant="outline" disabled={busy || !reviewed || !previewReady} onClick={() => runPdf(async () => ({ bytes: base64ToUint8Array(record.source.data), filename: record.source.filename, metadata: { existingFieldNames: record.source.existingFieldNames } }))}>Download unchanged source PDF</Button>
      </div>
      <section aria-label="Saved signing handoffs" className="space-y-3 rounded border p-3">
        <h3 className="font-medium">Signing handoffs</h3>
        <p className="text-sm">Save a handoff to freeze its PDF and signer assignments. The ZIP contains that exact PDF, its manifest and signing instructions. Downloads are unencrypted.</p>
        <Button disabled={busy || !reviewed || !previewReady || !hasSignatureFields || (record.handoffs?.length ?? 0) >= 10} onClick={() => void run(async () => {
          const saved = await save();if (!saved) return;
          const generation = request.current, next = await createSigningHandoff(saved, () => generation === request.current);
          if (generation !== request.current) return;
          setRecord(next);setRecords(all => [next, ...all.filter(value => value.id !== next.id)]);setNotice('Exact signing handoff saved. Download it when you are ready to share.');
        })}>Save exact signing handoff</Button>
        {(record.handoffs ?? []).map((handoff, index) => <div key={handoff.id} className="space-y-1 rounded border p-2">
          <p className="text-sm">Handoff {index + 1} · {new Date(handoff.createdAt).toLocaleString()}</p>
          <p className="break-all text-xs">PDF SHA-256: {handoff.pdf.sha256}</p>
          <p className="text-xs">Signers: {[...(record.source.existingSignatureNames ?? []), ...handoff.fields.map(value => value.signer)].join(', ')}</p>
          <Button variant="outline" disabled={busy || !reviewed || !previewReady} onClick={() => void run(async () => {
            const generation = request.current;
            await confirmSigningDisclosure(signingRecordDisclosure({ sourceRevision: record.sourceRevision, handoff }), () => generation === request.current);
            const bytes = await downloadSigningHandoff(record, handoff.id);
            if (generation === request.current) triggerDownload(bytes, `signing-handoff-${handoff.id}.zip`, 'application/zip');
          })}>Download handoff {index + 1}</Button>
        </div>)}
        <p className="text-xs">A signing record download includes the source PDF, every saved handoff, and every associated return, even when their content differs from the current editor. Review all retained versions before transferring the file.</p>
        <Button variant="outline" disabled={busy || !reviewed || !previewReady} onClick={() => void run(async () => {
          const generation = request.current;
          await confirmSigningDisclosure(signingRecordDisclosure(record), () => generation === request.current);
          const bytes = await exportSigningRecord(record);
          if (generation === request.current) triggerDownload(bytes, `signing-record-${record.id}.dondocs-signing.json`, 'application/json');
        })}>Download signing record</Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          const generation = request.current;
          if (!await showAppConfirm({ title: 'Remove signing record?', message: 'This removes its original PDF, placements and all saved handoffs and returns from this browser. Download the signing record first if you need to retain or transfer it.', confirmLabel: 'Remove signing record' }) || generation !== request.current) return;
          await removeSigningRecord(record, () => generation === request.current);
          if (generation !== request.current) return;
          const remaining = records.filter(value => value.id !== record.id);setRecords(remaining);
          if (remaining[0]) selectRecord(remaining[0]);else { setRecord(null);setFields([]);setSelected(''); }
          setNotice('Signing record removed from this browser.');
        })}>Remove saved signing record</Button>
      </section>
      <SigningReturnReview key={record.revision} record={record} onSaved={next => {
        setRecord(next);setRecords(all => [next, ...all.filter(value => value.id !== next.id)]);setReviewed(false);
        setNotice('Returned PDF associated with the saved handoff. Signer authenticity and approval remain unverified.');
      }} />
    </>}
  </div>;
}

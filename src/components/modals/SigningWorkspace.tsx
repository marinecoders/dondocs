import { HandwrittenSigning, type AttachHandwritten } from '@/components/HandwrittenSigning';
import type { BeforeOfficialSignature, SigningCorrection } from '../OfficialFormSigning';
import type { OfficialInspection } from '@/services/forms/signingBridge';
import { identifyOfficialOriginal, supportsOfficialSigning } from '@/services/forms/nativeCatalog';
import { idbDeleteSigningRecord } from '@/lib/documentsDb';
import { OfficialFormSigning } from '@/components/OfficialFormSigning';
import { saveOfficialRevision, officialSigningRecords, type OfficialSigningRecord } from '@/lib/officialSigning';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SigningPdfPreview } from '@/components/SigningPdfPreview';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { base64ToUint8Array, triggerDownload } from '@/lib/encoding';
import { MAX_SIGNING_PDF_BYTES, placeManualSignatureFields, type ManualSignature } from '@/lib/manualSignatureFields';
import { MAX_SIGNING_RECORD_BYTES, createSigningRecord, createSigningHandoff, downloadSigningHandoff, exportSigningRecord, importSigningRecord, loadSigningInventory, removeSigningRecord, removeUnreadableSigningRecord, signingErrorMessage, updateSigningFields, type SigningRecord, type UnreadableSigningRecord } from '@/lib/signingWorkspace';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';
import { showAppConfirm } from '@/stores/alertStore';
import { SigningReturnReview } from '@/components/SigningReturnReview';
import { confirmSigningDisclosure } from '@/components/signingDisclosure';
import { signingRecordDisclosure } from '@/lib/signingDisclosure';

import { SigningNavigationContext, useSigningLeavePrompt, useSigningNavigation } from './useSigningNavigation';

export default function SigningWorkspace({ open, onOpenChange, initialRecordId, initialField, initialReturnFile, initialHandoffId, beforeSign, onCorrect, onAttach, onAttachHandwritten, packageScoped = false }: { open: boolean; onOpenChange(open: boolean): void; initialRecordId?: string; initialField?: string; initialReturnFile?: File; initialHandoffId?: string; beforeSign?: BeforeOfficialSignature; onCorrect?: SigningCorrection; onAttachHandwritten?: AttachHandwritten; packageScoped?: boolean; onAttach?(record: OfficialSigningRecord, inspection: OfficialInspection): Promise<void> }) {
  const navigation = useSigningLeavePrompt();
  return <SigningNavigationContext.Provider value={navigation}><Dialog open={open} onOpenChange={next => {
    if (next) onOpenChange(true);
    else navigation.navigate(() => onOpenChange(false));
  }}><DialogContent className="flex max-h-[95dvh] max-w-5xl flex-col overflow-hidden sm:max-w-5xl">
    <DialogHeader><DialogTitle>Signing workspace</DialogTitle><DialogDescription>Review the PDF revision, select a signature field, and save the signed original.</DialogDescription></DialogHeader>
    {open && <SigningRecords packageScoped={packageScoped} initialHandoffId={initialHandoffId} initialReturnFile={initialReturnFile} key={initialRecordId} initialRecordId={initialRecordId} initialField={initialField} beforeSign={beforeSign} onCorrect={onCorrect} onAttach={onAttach} onAttachHandwritten={onAttachHandwritten} />}
  </DialogContent></Dialog>{navigation.prompt}</SigningNavigationContext.Provider>;
}

function SigningRecords({ initialRecordId, initialField, initialReturnFile, initialHandoffId, beforeSign, onCorrect, onAttach, onAttachHandwritten, packageScoped = false }: { initialRecordId?: string; initialField?: string; initialReturnFile?: File; initialHandoffId?: string; beforeSign?: BeforeOfficialSignature; onCorrect?: SigningCorrection; onAttachHandwritten?: AttachHandwritten; packageScoped?: boolean; onAttach?(record: OfficialSigningRecord, inspection: OfficialInspection): Promise<void> }) {
  const { navigate } = useSigningNavigation();
  const [records, setRecords] = useState<OfficialSigningRecord[]>([]);
  const [selected, setSelected] = useState(initialRecordId ?? '');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openedNotice, setOpenedNotice] = useState('');
  const upload = useRef<AbortController | null>(null);
  useEffect(() => () => upload.current?.abort(), []);
  useEffect(() => {
    let active = true;
    void officialSigningRecords().then(rows => { if (active) setRecords(rows); })
      .catch(cause => { if (active) setError(signingErrorMessage(cause)); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  async function openFile(file: File, kind: 'pdf' | 'record') {
    if (upload.current) return;
    const controller = new AbortController();
    upload.current = controller;
    const current = () => !controller.signal.aborted;
    setOpening(true);
    setError('');
    try {
      if (kind === 'record') {
        if (file.size > MAX_SIGNING_RECORD_BYTES) throw new Error('The signing record exceeds 96 MB.');
        const imported = await importSigningRecord(JSON.parse(await file.text()), current);
        if (current()) {
          setOpenedNotice('Signing record imported with its exact saved PDFs.');
          setSelected(imported.id);
        }
      } else {
        if (file.size > MAX_SIGNING_PDF_BYTES) throw new Error('Choose a PDF up to 20 MB.');
        const data = await file.arrayBuffer();
        const official = await identifyOfficialOriginal(data);
        controller.signal.throwIfAborted();
        const bytes = new Uint8Array(data);
        if (official) {
          if (!supportsOfficialSigning(official)) throw new Error('This official PDF has no supported CAC signature fields.');
          const next = await saveOfficialRevision(file.name, bytes, current);
          if (current()) {
            setRecords(rows => [next, ...rows]);
            setOpenedNotice('');
            setSelected(next.id);
          }
        } else {
          const next = await createSigningRecord(bytes, file.name, current);
          if (current()) {
            setOpenedNotice('Exact source PDF saved. Add the fields you need.');
            setSelected(next.id);
          }
        }
      }
    } catch (cause) {
      if (current()) setError(signingErrorMessage(cause));
    } finally {
      upload.current = null;
      if (current()) setOpening(false);
    }
  }
  const record = records.find(item => item.id === selected);
  return <div className="min-h-0 space-y-3 overflow-y-auto">
    {error && <p role="alert">{error}</p>}
    {!onAttach && !packageScoped && <div className="flex flex-wrap items-center gap-2">
      {(['pdf', 'record'] as const).map(kind => <label key={kind} className={cn(buttonVariants({ variant: kind === 'pdf' ? 'default' : 'ghost', size: 'sm' }), 'relative cursor-pointer focus-within:ring-2')}>
        {kind === 'pdf' ? 'Open PDF' : 'Import signing record'}
        <input type="file" accept={kind === 'pdf' ? 'application/pdf,.pdf' : 'application/json,.json'}
          disabled={!loaded || opening} className="sr-only" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file) navigate(() => void openFile(file, kind));
          }} />
      </label>)}
    </div>}
    <fieldset className="min-w-0 space-y-3" disabled={opening}>
    {records.length > 0 && !onAttach && !packageScoped && <label className="block text-sm">Signing file
      <select className="ml-2 rounded border bg-background p-2" value={record?.id ?? ''} onChange={e => { const id = e.target.value; navigate(() => { setOpenedNotice(''); setSelected(id); }); }}>
        <option value="">PDF handoffs and placement</option>
        {records.map(item => <option key={item.id} value={item.id}>{item.filename} · Revision {item.revisions.length}</option>)}
      </select></label>}
    {record ? <OfficialFormSigning initialReturnFile={initialRecordId === record.id ? initialReturnFile : undefined} key={record.id} record={record} beforeSign={beforeSign} onCorrect={onCorrect} initialField={record.id === initialRecordId ? initialField : undefined} onAttach={onAttach}
      onSave={saved => setRecords(rows => rows.map(item => item.id === saved.id ? saved : item))} />
      : loaded && !onAttach ? <SigningEditor packageScoped={packageScoped} onAttachHandwritten={selected === initialRecordId ? onAttachHandwritten : undefined} key={selected} openedNotice={openedNotice} initialHandoffId={selected === initialRecordId ? initialHandoffId : undefined} initialReturnFile={selected === initialRecordId ? initialReturnFile : undefined} initialRecordId={selected || undefined} /> : <p role="status">{loaded ? 'This signing file is unavailable.' : 'Opening signing records…'}</p>}
    {record && !onAttach && !packageScoped && <Button variant="ghost" size="sm" onClick={async () => {
      if (!await showAppConfirm({ title: 'Remove this signing file?', message: 'Download any revisions you need before removing the local signing file.', confirmLabel: 'Remove file' })) return;
      try {
        if (!await idbDeleteSigningRecord(record)) throw new Error('The file changed. Reopen the workspace and try again.');
        setRecords(rows => rows.filter(item => item.id !== record.id)); setSelected('');
      } catch (cause) { setError(signingErrorMessage(cause)); }
    }}>Remove signing file</Button>}
    </fieldset>
  </div>;
}

function SigningEditor({ initialRecordId, initialHandoffId, initialReturnFile, openedNotice, onAttachHandwritten, packageScoped }: { openedNotice: string; packageScoped: boolean; onAttachHandwritten?: AttachHandwritten; initialRecordId?: string; initialHandoffId?: string; initialReturnFile?: File }) {
  const { navigate, registerSave } = useSigningNavigation();
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
    void loadSigningInventory().then(inventory => {
      if (generation !== owner.current) return;
      setRecords(inventory.records);
      setUnreadable(inventory.unreadable);
      const next = initialRecordId ? inventory.records.find(value => value.id === initialRecordId) : inventory.records[0];
      if (next) { selectRecord(next); setNotice(openedNotice); }
      else if (initialRecordId) setError('This signing file is unavailable. Close the workspace to return to your document.');
    })
      .catch(cause => { if (generation === owner.current) setError(cause instanceof Error ? cause.message : 'Saved signing drafts could not be opened.'); });
    return () => { owner.current++; };
  }, [initialRecordId, openedNotice]);
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
    setRecord(saved);
    setFields(saved.fields);
    setRecords(all => [saved, ...all.filter(value => value.id !== saved.id)]);
    setNotice('Signature placement saved in this browser.');return saved;
  }
  useLayoutEffect(() => {
    if (!record || JSON.stringify(fields) === JSON.stringify(record.fields)) return;
    return registerSave(async () => {
      if (working.current || !await save()) throw new Error('The placement could not be saved. Try again.');
    });
  });
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
    {!packageScoped && !!unreadable.length && <section aria-label="Unreadable signing records" className="space-y-3 rounded border p-3">
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
    {!record && <p className="text-xs text-muted-foreground">Open a PDF up to 20 MB or import a saved signing record.</p>}
    {!packageScoped && !!records.length && <label className="block text-sm">Saved signing draft<select className="ml-2 max-w-full rounded border p-2" value={record?.id ?? ''} disabled={busy} onChange={event => {
      const next = records.find(value => value.id === event.target.value);if (next) navigate(() => selectRecord(next));
    }}>{!record && <option value="" disabled>Choose a saved signing draft</option>}{records.map(value => <option key={value.id} value={value.id}>{value.title} · {new Date(value.createdAt).toLocaleString()}{value.sourceRevision ? ` · edit ${value.sourceRevision.editSequence}` : ''}</option>)}</select></label>}
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
      })}>{record.handwritten?.length ? 'Download original PDF with signature boxes' : 'Download PDF with signature boxes'}</Button>
        <Button variant="outline" disabled={busy || !reviewed || !previewReady} onClick={() => runPdf(async () => ({ bytes: base64ToUint8Array(record.source.data), filename: record.source.filename, metadata: { existingFieldNames: record.source.existingFieldNames } }))}>Download unchanged source PDF</Button>
      </div>
      <HandwrittenSigning key={JSON.stringify([record.revision, fields, selected])} record={record} field={field} fields={fields} disabled={busy} onAttach={onAttachHandwritten} onSaved={next => {
        setRecord(next); setRecords(all => [next, ...all.filter(value => value.id !== next.id)]); setReviewed(false);
        setFields(next.fields);
        setNotice('Handwritten revision saved in this browser.');
      }} />
      <section aria-label="Saved signing handoffs" className="space-y-3 rounded border p-3">
        <h3 className="font-medium">Signing handoffs</h3>
        <p className="text-sm">Save a handoff to freeze its PDF and signer assignments. The ZIP contains that exact PDF, its manifest and signing instructions. Downloads are unencrypted.</p>
        {!!record.handwritten?.length && <p className="text-sm">For a copy with handwriting, choose Download handwritten PDF above.</p>}
        <Button disabled={busy || !reviewed || !previewReady || !hasSignatureFields || (record.handoffs?.length ?? 0) >= 10} onClick={() => void run(async () => {
          const saved = await save();if (!saved) return;
          const generation = request.current, next = await createSigningHandoff(saved, () => generation === request.current);
          if (generation !== request.current) return;
          setRecord(next);setRecords(all => [next, ...all.filter(value => value.id !== next.id)]);setNotice('Exact signing handoff saved. Download it when you are ready to share.');
        })}>{record.handwritten?.length ? 'Save handoff of original PDF' : 'Save exact signing handoff'}</Button>
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
        <p className="text-xs">A signing record download includes the source PDF, any handwritten signature images and revisions, every saved handoff, and every associated return, even when their content differs from the current editor. Review all retained versions before transferring the file.</p>
        <Button variant="outline" disabled={busy || !reviewed || !previewReady} onClick={() => void run(async () => {
          const generation = request.current;
          await confirmSigningDisclosure(signingRecordDisclosure(record, true), () => generation === request.current);
          const bytes = await exportSigningRecord(record);
          if (generation === request.current) triggerDownload(bytes, `signing-record-${record.id}.dondocs-signing.json`, 'application/json');
        })}>Download signing record</Button>
        {!packageScoped && <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          const generation = request.current;
          if (!await showAppConfirm({ title: 'Remove signing record?', message: 'This removes its original PDF, placements and all saved handoffs and returns from this browser. Download the signing record first if you need to retain or transfer it.', confirmLabel: 'Remove signing record' }) || generation !== request.current) return;
          await removeSigningRecord(record, () => generation === request.current);
          if (generation !== request.current) return;
          const remaining = records.filter(value => value.id !== record.id);setRecords(remaining);
          if (remaining[0]) selectRecord(remaining[0]);else { setRecord(null);setFields([]);setSelected(''); }
          setNotice('Signing record removed from this browser.');
        })}>Remove saved signing record</Button>}
      </section>
      <SigningReturnReview initialFile={initialRecordId === record.id ? initialReturnFile : undefined}
        initialHandoffId={initialRecordId === record.id ? initialHandoffId : undefined} key={record.revision} record={record} onSaved={next => {
        setRecord(next);setRecords(all => [next, ...all.filter(value => value.id !== next.id)]);setReviewed(false);
        setNotice('Returned PDF associated with the saved handoff. Signer authenticity and approval remain unverified.');
      }} />
    </>}
  </div>;
}

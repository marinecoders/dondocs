import { OfficialSignatureLocation } from './OfficialSignatureLocation';
import { officialEdition } from '@/services/forms/nativeCatalog';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { confirmSigningDisclosure } from './signingDisclosure';
import { officialRevisionBytes, saveOfficialRevision, type OfficialSigningRecord } from '@/lib/officialSigning';
import { inspectOfficialPdf, signOfficialPdf, signingIdentities, type OfficialInspection } from '@/services/forms/signingBridge';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';
import { MAX_SIGNING_PDF_BYTES } from '@/lib/manualSignatureFields';

type Props = { record: OfficialSigningRecord; onSave(record: OfficialSigningRecord): void;
  onAttach?(record: OfficialSigningRecord, inspection: OfficialInspection): Promise<void> };

export function OfficialFormSigning({ record, onSave, onAttach }: Props) {
  const [code, setCode] = useState('');
  const [inspection, setInspection] = useState<OfficialInspection>();
  const [identities, setIdentities] = useState<Awaited<ReturnType<typeof signingIdentities>>>([]);
  const [certificate, setCertificate] = useState('');
  const [field, setField] = useState('');
  const [finalize, setFinalize] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const selected = inspection?.fields.find(item => item.name === field);
  const latest = record.revisions.at(-1)!;
  const profile = inspection && officialEdition(inspection.formId, inspection.edition);
  const inspected = Boolean(profile && inspection?.sha256 === latest.sha256);
  const selectInspection = (value: OfficialInspection) => {
    const available = value.fields.filter(item => !item.locked && !item.signed);
    setInspection(value);
    setField(previous => available.some(item => item.name === previous) ? previous : available[0]?.name ?? '');
    setReviewed(false); setFinalize(false);
  };

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setError(''); setMessage('');
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The operation failed.'); }
    finally { active.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  async function pair(signal: AbortSignal) {
    const bytes = await officialRevisionBytes(record);
    await confirmSigningDisclosure({ pdfs: [{ bytes, label: record.filename }] }, () => !signal.aborted);
    const info = await inspectOfficialPdf(bytes, code.trim(), signal);
    selectInspection(info);
    setIdentities([]); setCertificate('');
    const cards = await signingIdentities(code.trim(), signal);
    signal.throwIfAborted();
    setIdentities(cards); setCertificate(cards[0]?.fingerprint ?? '');
    setMessage(cards.length ? 'CAC bridge connected.' : 'Bridge connected. Insert your signing card and reconnect to sign.');
  }
  async function sign(signal: AbortSignal) {
    if (!inspected || !selected || selected.signed || selected.locked || !reviewed) return;
    const bytes = await officialRevisionBytes(record);
    const signed = await signOfficialPdf(bytes, field, certificate, finalize, code.trim(), signal);
    const result = await inspectOfficialPdf(signed, code.trim(), signal);
    if (!result.fields.some(item => item.name === field && item.signed && item.trusted)) throw new Error('The selected signature could not be verified.');
    const next = await saveOfficialRevision(record.filename, signed, () => !signal.aborted, record);
    signal.throwIfAborted(); onSave(next); selectInspection(result); setMessage('Signed revision saved.');
  }
  function download(index: number) {
    const lease = reserveSigningPdfDownload();
    void run(async signal => {
      try {
        const bytes = await officialRevisionBytes(record, index);
        await confirmSigningDisclosure({ pdfs: [{ bytes, label: record.filename }] }, () => !signal.aborted);
        if (!await lease.deliver(bytes, record.filename, () => !signal.aborted)) throw new Error('The download was interrupted.');
      } finally { lease.release(); }
    });
  }

  return <section aria-label="Official form signatures" className="space-y-4">
    <header><h3 className="font-medium">{record.filename}</h3><p className="text-sm text-muted-foreground">Official PDF · Revision {record.revisions.length}</p></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <fieldset disabled={busy} className="space-y-3">
      <OfficialSignatureLocation key={latest.sha256} record={record} choice={field} onChoice={setField} paired={inspected} />
      <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-sm">Local bridge pairing code
        <input type="password" autoComplete="off" className="rounded border bg-background px-2 py-1" value={code}
          onChange={e => { setCode(e.target.value); setInspection(undefined); setIdentities([]); setReviewed(false); }} /></label>
        <Button variant="outline" disabled={!code.trim()} onClick={() => void run(pair)}>{inspected ? 'Reconnect' : 'Connect CAC'}</Button>
      </div>
      {inspected && inspection && profile && <div className="space-y-3">
        {profile.format === 'xfa' && <p className="text-sm text-muted-foreground">Download the official PDF and review its filled fields in Acrobat before signing.
            {!inspection.fields.some(item => item.signed) && ' If someone will also sign in Acrobat, have them sign first, then open their signed PDF here.'}</p>}
        <ul className="divide-y rounded border px-3 text-sm">{inspection.fields.map(item => <li key={item.name} className="flex justify-between gap-3 py-2">
          <span>{item.label}</span><span>{item.signed ? item.trusted ? 'Signed · trusted chain' : 'Signed · trust unconfirmed' : item.locked ? 'Locked' : 'Available'}</span>
        </li>)}</ul>
        {!inspection.fields.some(item => item.signed) && <p className="text-sm text-muted-foreground">If a signer will use Acrobat, have them sign there first. Open their signed PDF in the signing workspace to countersign in DonDocs.</p>}
        {inspection.fields.some(item => item.signed) && <p className="text-sm text-muted-foreground">Certificate chains are checked offline. Current revocation status may be unavailable.</p>}
        {selected && <><label className="grid gap-1 text-sm">Signature field<select className="rounded border bg-background p-2" value={field}
          onChange={e => { setField(e.target.value); setReviewed(false); }}>{inspection.fields.filter(item => !item.locked && !item.signed)
            .map(item => <option key={item.name} value={item.name}>{item.label}</option>)}</select></label>
          {selected.lockAction && <details className="text-sm"><summary>Fields locked by this signature</summary>
            <p>{selected.lockAction === 'All' ? 'All fields' : selected.lockAction === 'Exclude' ? 'All fields except the following' : 'The following fields'}</p>
            <ul>{selected.lockFields.map(name => <li key={name}>{name}</li>)}</ul></details>}
          {identities.length > 0 && <label className="grid gap-1 text-sm">Signing certificate<select className="rounded border bg-background p-2" value={certificate} onChange={e => { setCertificate(e.target.value); setReviewed(false); }}>
            {identities.map(item => <option key={item.fingerprint} value={item.fingerprint}>{item.label}</option>)}</select></label>}
          {profile.format === 'xfa' && !inspection.fields.some(item => item.signed) &&
            <label className="block text-sm"><input type="checkbox" checked={finalize} onChange={e => { setFinalize(e.target.checked); setReviewed(false); }} /> Lock the entire PDF after signing (prevents further signatures)</label>}
          <label className="block text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> I reviewed the exact PDF and selected signature field.</label>
          <Button disabled={!reviewed || !certificate} onClick={() => void run(sign)}>Sign with CAC</Button></>}
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => download(record.revisions.length - 1)}>Download official PDF</Button>
        {inspected && <label className="cursor-pointer rounded border px-3 py-2 text-sm">Return signed PDF
          <input className="sr-only" type="file" accept="application/pdf,.pdf" onChange={e => {
            const file = e.target.files?.[0]; e.target.value = '';
            if (file) void run(async signal => {
              if (file.size > MAX_SIGNING_PDF_BYTES) throw new Error('Choose a PDF up to 20 MB.');
              const bytes = new Uint8Array(await file.arrayBuffer());
              await confirmSigningDisclosure({ pdfs: [{ bytes, label: file.name }] }, () => !signal.aborted);
              const result = await inspectOfficialPdf(bytes, code.trim(), signal, latest);
              const next = await saveOfficialRevision(record.filename, bytes, () => !signal.aborted, record);
              signal.throwIfAborted(); onSave(next); selectInspection(result); setMessage('Returned signature verified and saved.');
            });
          }} /></label>}
        {onAttach && record.revisions.length > 1 && inspected && inspection?.fields.some(item => item.signed) && <Button onClick={() => void run(async signal => {
          // Local signing checks the changes made by its own writer; imported returns
          // pass the stricter /return comparison before they can enter this record.
          const bytes = await officialRevisionBytes(record);
          const checked = await inspectOfficialPdf(bytes, code.trim(), signal);
          signal.throwIfAborted();
          await onAttach(record, checked);
        })}>Save signed original to package</Button>}
      </div>
      {record.revisions.length > 1 && <details className="text-sm"><summary>Previous revisions</summary>
        {record.revisions.slice(0,-1).map((rev, index) => <Button key={rev.sha256} variant="ghost" onClick={() => download(index)}>Download revision {index + 1}</Button>)}</details>}
    </fieldset>
  </section>;
}

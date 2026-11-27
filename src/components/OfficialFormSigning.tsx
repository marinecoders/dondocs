import { PackageSigningRequirementError, type PackageDestination } from '@/lib/packageDestinations';
import { OfficialSignatureLocation } from './OfficialSignatureLocation';
import { officialEdition } from '@/services/forms/nativeCatalog';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { confirmSigningDisclosure } from './signingDisclosure';
import { officialRevisionBytes, saveOfficialRevision, type OfficialSigningRecord } from '@/lib/officialSigning';
import { connectSigningCompanion, currentSigningSession, disconnectSigningCompanion, isDisconnectPending, subscribeSigningSession, inspectOfficialPdf, signOfficialPdf, signingIdentities, type OfficialInspection } from '@/services/forms/signingBridge';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';
import { MAX_SIGNING_PDF_BYTES } from '@/lib/manualSignatureFields';

export type BeforeOfficialSignature = (field: string, bytes: ArrayBuffer) => Promise<void>;
export type SigningCorrection = (target: PackageDestination, signatureField: string) => void;
type Props = { initialReturnFile?: File; onCorrect?: SigningCorrection; initialField?: string; beforeSign?: BeforeOfficialSignature; record: OfficialSigningRecord; onSave(record: OfficialSigningRecord): void;
  onAttach?(record: OfficialSigningRecord, inspection: OfficialInspection): Promise<void> };

interface PendingSignature { bytes: Uint8Array; field: string; sourceSha256: string }

export function OfficialFormSigning({ record, initialField, initialReturnFile, beforeSign, onCorrect, onSave, onAttach }: Props) {
  const [pendingReturn, setPendingReturn] = useState(initialReturnFile);
  const session = useSyncExternalStore(subscribeSigningSession, currentSigningSession);
  const disconnectPending = useSyncExternalStore(subscribeSigningSession, isDisconnectPending);
  const [inspectedSession, setInspectedSession] = useState<string>();
  const [inspection, setInspection] = useState<OfficialInspection>();
  const [identities, setIdentities] = useState<Awaited<ReturnType<typeof signingIdentities>>>([]);
  const [certificate, setCertificate] = useState('');
  const [field, setField] = useState(initialField ?? '');
  const [unavailable, setUnavailable] = useState('');
  const [finalize, setFinalize] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fieldLabels = useRef<Map<string, string> | undefined>(undefined);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const selected = inspection?.fields.find(item => item.name === field);
  const latest = record.revisions.at(-1)!;
  const [pending, setPending] = useState<PendingSignature>();
  const pendingSignature = pending?.sourceSha256 === latest.sha256 ? pending : undefined;
  const profile = inspection && officialEdition(inspection.formId, inspection.edition);
  const inspected = Boolean(session && inspectedSession === session && profile && inspection?.sha256 === latest.sha256);
  const [check, setCheck] = useState<{ field: string; digest: string; message?: string; target?: PackageDestination }>();
  useEffect(() => {
    if (!beforeSign || !field) return;
    let live = true;
    void officialRevisionBytes(record).then(bytes => beforeSign(field, bytes.buffer)).then(() => {
      if (live) setCheck({ field, digest: latest.sha256 });
    }).catch(cause => {
      if (live) setCheck({ field, digest: latest.sha256, message: cause instanceof Error ? cause.message : 'Could not check signing requirements.',
        target: cause instanceof PackageSigningRequirementError ? cause.target : undefined });
    });
    return () => { live = false; };
  }, [beforeSign, field, latest.sha256, record]);
  const checked = check?.field === field && check.digest === latest.sha256 ? check : undefined;
  const chooseField = !initialField;
  const selectInspection = (value: OfficialInspection) => {
    const available = value.fields.filter(item => !item.locked && !item.signed);
    setInspection({ ...value, fields: value.fields.map(item => ({ ...item, label: fieldLabels.current?.get(item.name) || item.label })) });
    setField(previous => {
      if (previous) return available.some(item => item.name === previous) ? previous : '';
      return chooseField && !beforeSign && available.length === 1 ? available[0].name : '';
    });
    setReviewed(false); setFinalize(false);
  };

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setError(''); setMessage('');
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) { setMessage(''); setError(cause instanceof Error ? cause.message : 'The operation failed.'); } }
    finally { active.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  function importReturn(file: File) {
    if (!session || !inspected) return;
    return run(async signal => {
      if (file.size > MAX_SIGNING_PDF_BYTES) throw new Error('Choose a PDF up to 20 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      await confirmSigningDisclosure({ pdfs: [{ bytes, label: file.name }] }, () => !signal.aborted, { action: 'inspect' });
      const result = await inspectOfficialPdf(bytes, session, signal, latest);
      const next = await saveOfficialRevision(record.filename, bytes, () => !signal.aborted, record);
      signal.throwIfAborted(); onSave(next); selectInspection(result); setPendingReturn(undefined); setMessage('Returned signature verified. Signed PDF ready.');
    });
  }
  async function prepareSigning(signal: AbortSignal) {
    const bytes = await officialRevisionBytes(record);
    if (field) await beforeSign?.(field, bytes.buffer);
    signal.throwIfAborted();
    setInspection(undefined); setReviewed(false); setCertificate(''); setIdentities([]);
    if (!currentSigningSession()) setMessage('Approve the connection in the signing companion.');
    const token = await connectSigningCompanion(signal);
    setMessage('');
    await confirmSigningDisclosure({ pdfs: [{ bytes, label: record.filename }] }, () => !signal.aborted, { action: 'inspect' });
    const info = await inspectOfficialPdf(bytes, token, signal);
    const { officialSignatureLabels } = await import('@/lib/packageSignatureFieldLabel');
    const labels = await officialSignatureLabels({ id: info.formId, edition: info.edition }).catch(() => undefined);
    signal.throwIfAborted();
    fieldLabels.current = labels;
    const requested = info.fields.find(item => item.name === field);
    setUnavailable(field && (!requested || requested.locked || requested.signed)
      ? `The selected field is ${requested?.signed ? 'already signed' : requested?.locked ? 'locked' : 'unavailable'} on this revision.` : '');
    setInspectedSession(token);
    selectInspection(info);
    await refreshCard(token, signal);
  }
  async function refreshCard(token: string, signal: AbortSignal) {
    setReviewed(false); setIdentities([]); setCertificate('');
    const cards = await signingIdentities(token, signal);
    signal.throwIfAborted();
    setIdentities(cards); setCertificate(cards[0]?.fingerprint ?? '');
    setMessage(cards.length ? '' : 'Insert your CAC, then retry.');
  }
  async function sign(signal: AbortSignal) {
    if (!session || !inspected || !selected || selected.signed || selected.locked || !reviewed) return;
    const bytes = await officialRevisionBytes(record);
    await beforeSign?.(field, bytes.buffer);
    signal.throwIfAborted();
    const signed = await signOfficialPdf(bytes, field, certificate, finalize, session, signal);
    signal.throwIfAborted();
    const candidate = { bytes: signed, field, sourceSha256: latest.sha256 };
    setPending(candidate);
    await verifyAndSave(candidate, session, signal);
  }
  async function verifyAndSave(candidate: PendingSignature, token: string, signal: AbortSignal) {
    const result = await inspectOfficialPdf(candidate.bytes, token, signal);
    if (!result.fields.some(item => item.name === candidate.field && item.signed && item.trusted)) {
      throw new Error('The selected signature could not be verified.');
    }
    const next = await saveOfficialRevision(record.filename, candidate.bytes, () => !signal.aborted, record);
    signal.throwIfAborted();
    setPending(undefined); onSave(next); selectInspection(result); setMessage('Signed PDF ready.');
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

  const signed = inspected && inspection?.fields.some(item => item.signed);
  const canAttach = signed && record.revisions.length > 1 && onAttach;
  return <section aria-label="Official form signatures" className="space-y-4">
    <header><h3 className="font-medium">{record.filename}</h3><p className="text-sm text-muted-foreground">Official PDF · Revision {record.revisions.length}</p></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <fieldset disabled={busy} className="space-y-3">
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(15rem,20rem)]">
        <OfficialSignatureLocation requireChoice={chooseField} key={latest.sha256} initiallyOpen record={record} choice={field}
          connected={!!session} inspectedFields={inspected ? inspection?.fields : undefined}
          onChoice={value => { setField(value); setUnavailable(''); setReviewed(false); setFinalize(false); }} />
        <div className="min-w-0 space-y-3">
          {inspected && unavailable && <p role="status" className="text-sm">{unavailable}</p>}
          {canAttach && !pendingSignature && <Button onClick={() => void run(async signal => {
            // Imported returns pass the stricter comparison before they can enter this record.
            const bytes = await officialRevisionBytes(record);
            if (!session) return;
            const checked = await inspectOfficialPdf(bytes, session, signal);
            signal.throwIfAborted();
            await onAttach(record, checked);
          })}>Save to package</Button>}
          {checked?.message && <div role="status" className="space-y-1 text-sm"><p>{checked.message}</p>
            {onCorrect && checked.target && record.revisions.length === 1 && <Button size="sm" variant="outline" onClick={() => onCorrect(checked.target!, field)}>
              {checked.target.correction?.label || 'Open package details'}</Button>}</div>}
          <div className="flex flex-wrap items-center gap-2">
            {session && <span className="text-sm">Companion connected</span>}
            {!pendingSignature && !disconnectPending && (inspected && session
              ? <Button variant="outline" onClick={() => void run(signal => refreshCard(session, signal))}>
                {identities.length ? 'Refresh card' : 'Retry card'}
              </Button>
              : <Button onClick={() => void run(prepareSigning)}>{session ? 'Review for signing' : 'Connect CAC'}</Button>)}
            {disconnectPending && <span role="status" className="text-sm">Waiting for disconnect confirmation</span>}
            {(session || disconnectPending) && <Button variant="ghost" onClick={() => void run(async signal => {
              setInspectedSession(undefined); setInspection(undefined); setIdentities([]); setCertificate(''); setReviewed(false);
              await disconnectSigningCompanion(signal);
              if (!signal.aborted) setMessage('Disconnected.');
            })}>{disconnectPending ? 'Retry disconnect' : 'Disconnect'}</Button>}
          </div>
          {pendingSignature && <div className="space-y-2">
            <p className="text-sm">Your signed copy is still here. Keep this workspace open until it saves.</p>
            <Button disabled={disconnectPending} onClick={() => void run(async signal => {
              const token = await connectSigningCompanion(signal);
              await verifyAndSave(pendingSignature, token, signal);
            })}>Retry verification and save</Button>
          </div>}
          {!pendingSignature && inspected && inspection && profile && <div className="space-y-3">
            {selected && <>{selected.lockAction && <details className="text-sm"><summary>Fields locked by this signature</summary>
                <p>{selected.lockAction === 'All' ? 'All fields' : selected.lockAction === 'Exclude' ? 'All fields except the following' : 'The following fields'}</p>
                <ul>{selected.lockFields.map(name => <li key={name}>{name}</li>)}</ul></details>}
              {identities.length > 0 && <label className="grid gap-1 text-sm">Signing certificate<select className="rounded border bg-background p-2" value={certificate} onChange={e => { setCertificate(e.target.value); setReviewed(false); }}>
                {identities.map(item => <option key={item.fingerprint} value={item.fingerprint}>{item.label}</option>)}</select></label>}
              {profile.format === 'xfa' && !inspection.fields.some(item => item.signed) &&
                <label className="block text-sm"><input type="checkbox" checked={finalize} onChange={e => { setFinalize(e.target.checked); setReviewed(false); }} /> Lock the entire PDF after signing (prevents further signatures)</label>}
              <label className="block text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> I reviewed the exact PDF and selected signature field.</label>
              <Button disabled={!reviewed || !certificate || !!beforeSign && (!checked || !!checked.message)} onClick={() => void run(sign)}>Sign with CAC</Button></>}
          </div>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={signed && !onAttach ? 'default' : 'outline'} onClick={() => download(record.revisions.length - 1)}>
              {signed ? 'Download signed PDF' : 'Download PDF to review'}
            </Button>
            {!pendingSignature && pendingReturn && <Button disabled={!inspected || busy} onClick={() => void importReturn(pendingReturn)}>Verify returned PDF · {pendingReturn.name}</Button>}
            {!pendingSignature && inspected && !pendingReturn && <label className="cursor-pointer rounded border px-3 py-2 text-sm">Return signed PDF
              <input className="sr-only" type="file" accept="application/pdf,.pdf" onChange={e => {
                const file = e.target.files?.[0]; e.target.value = '';
                if (file) void importReturn(file);
              }} /></label>}
          </div>
        </div>
      </div>
      {inspected && inspection && <>
        {signed
          ? <p className="text-sm text-muted-foreground">Certificate chains are checked offline. Current revocation status may be unavailable.</p>
          : <p className="text-sm text-muted-foreground">If a signer uses a desktop PDF application, have them sign first. Open their signed PDF here to countersign.</p>}
        <details className="text-sm">
          <summary>Signature status ({inspection.fields.length})</summary>
          <ul className="divide-y">{inspection.fields.map(item => <li key={item.name} className="flex justify-between gap-3 py-2">
            <span>{item.label}</span><span>{item.signed ? item.trusted ? 'Signed · trusted chain' : 'Signed · trust unconfirmed' : item.locked ? 'Locked' : 'Available'}</span>
          </li>)}</ul>
        </details>
      </>}
      {record.revisions.length > 1 && <details className="text-sm"><summary>Previous revisions</summary>
        {record.revisions.slice(0,-1).map((rev, index) => <Button key={rev.sha256} variant="ghost" onClick={() => download(index)}>Download revision {index + 1}</Button>)}</details>}
    </fieldset>
  </section>;
}

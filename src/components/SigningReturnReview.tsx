import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import PdfViewer from '@/components/pdf/PdfViewer';
import { base64ToUint8Array } from '@/lib/encoding';
import { MAX_SIGNING_PDF_BYTES } from '@/lib/manualSignatureFields';
import { associateSigningReturn, prepareSigningReturn, signingErrorMessage, type SigningRecord, type SigningReturnCandidate } from '@/lib/signingWorkspace';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';
import { SignatureVerificationReport } from '@/components/SignatureVerificationReport';
import { confirmSigningDisclosure } from '@/components/signingDisclosure';

function RetainedSigningPreview({ data, label }: { data: string; label: string }) {
  const [preview, setPreview] = useState<{ data: string; url: string } | null>(null);
  useEffect(() => {
    let active = true;
    const url = URL.createObjectURL(new Blob([new Uint8Array(base64ToUint8Array(data))], { type: 'application/pdf' }));
    queueMicrotask(() => { if (active) setPreview({ data, url }); });
    return () => { active = false;URL.revokeObjectURL(url); };
  }, [data]);
  return <div className="h-96 overflow-hidden rounded border" aria-label={label}>
    {preview?.data === data ? <PdfViewer key={preview.url} pdfUrl={preview.url} showFullscreen={false} allowOpenInTab={false} toolbarLabel={label} /> : <p role="status">Opening retained PDF…</p>}
  </div>;
}

const assessmentText = {
  unchanged: 'This is the unchanged handoff PDF. A returned copy alone does not establish that signing occurred.',
  'checks-agree': 'Page geometry, content streams, page resources and the handoff marker agree. Compare the visible pages before associating the return.',
  different: 'The returned file differs in page geometry, content streams or page resources. It may belong to another document or contain changes.',
  inconclusive: 'The file could not be matched conclusively to this handoff. Review both documents and confirm the association yourself.',
};

export function SigningReturnReview({ record, onSaved, initialHandoffId, initialFile }: { initialHandoffId?: string; initialFile?: File; record: SigningRecord; onSaved(record: SigningRecord): void }) {
  const [handoffId, setHandoffId] = useState(initialHandoffId ?? record.handoffs?.at(-1)?.id ?? '');
  const [candidate, setCandidate] = useState<SigningReturnCandidate | null>(null);
  const [preview, setPreview] = useState<'handoff' | 'return'>('return');
  const [reviewed, setReviewed] = useState(false), [acceptMismatch, setAcceptMismatch] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [retainedId, setRetainedId] = useState(''), [retainedReviewed, setRetainedReviewed] = useState(false);
  const request = useRef(0), working = useRef(false);
  useEffect(() => { const owner = request;return () => { owner.current++; }; }, []);
  const handoff = record.handoffs?.find(value => value.id === handoffId);
  const retained = record.returns?.find(value => value.id === retainedId);
  async function run(operation: (isCurrent: () => boolean) => Promise<void>) {
    if (working.current) return;
    working.current = true;const generation = ++request.current;setBusy(true);setError('');
    const isCurrent = () => generation === request.current;
    try { await operation(isCurrent); }
    catch (cause) { if (isCurrent()) setError(signingErrorMessage(cause)); }
    finally { working.current = false;if (isCurrent()) setBusy(false); }
  }
  function inspectFile(file: File) {
    if (!handoff || working.current || (record.returns?.length ?? 0) >= 10) return;
    setCandidate(null);setReviewed(false);setAcceptMismatch(false);setRetainedId('');
    void run(async isCurrent => {
      if (file.size > MAX_SIGNING_PDF_BYTES) throw new Error('Choose a returned PDF no larger than 20 MB.');
      const prepared = await prepareSigningReturn(record, handoffId, new Uint8Array(await file.arrayBuffer()), file.name);
      if (isCurrent()) { setCandidate(prepared);setPreview('return'); }
    });
  }
  function downloadRetained() {
    if (!retained || !retainedReviewed || working.current) return;
    let lease = reserveSigningPdfDownload();
    void run(async isCurrent => {
      try {
        if (!isCurrent()) return;
        const bytes = base64ToUint8Array(retained.pdf.data);
        await confirmSigningDisclosure({ pdfs: [{ bytes, label: retained.pdf.filename }], metadata: { existingFieldNames: retained.pdf.existingFieldNames } }, isCurrent,
          { onPrivacyReview: () => lease.release(), onPrivacyApproved: () => { lease = reserveSigningPdfDownload(); } });
        if (!isCurrent()) return;
        if (!await lease.deliver(bytes, retained.pdf.filename, isCurrent)) throw new Error('The returned PDF could not be delivered. Retry in a supported browser.');
      } finally { lease.release(); }
    });
  }

  return <section aria-label="Returned signing documents" className="space-y-3 rounded border p-3" aria-busy={busy}>
    <h3 className="font-medium">Returned signing documents</h3>
    <p className="text-sm">Select the handoff that was shared, inspect the returned PDF beside that exact handoff, and confirm its association. Original and returned files retain their exact bytes.</p>
    <p className="text-xs text-muted-foreground">These bounded checks compare page structure, content streams and page resources. They do not establish visual equivalence, verify certificates, authenticate a signer, or establish approval. Review annotations and every visible page yourself. Confirm signatures in your signing application.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <label className="block text-sm">Return belongs to handoff<select className="ml-2 max-w-full rounded border p-2" disabled={busy} value={handoffId} onChange={event => {
      setHandoffId(event.target.value);setCandidate(null);setReviewed(false);setAcceptMismatch(false);setError('');
    }}>{(record.handoffs ?? []).map((value, index) => <option key={value.id} value={value.id}>Handoff {index + 1} · {new Date(value.createdAt).toLocaleString()}</option>)}</select></label>
    {initialFile && initialHandoffId === handoffId && !candidate && <Button disabled={busy || !handoff || (record.returns?.length ?? 0) >= 10}
      onClick={() => inspectFile(initialFile)}>Compare returned PDF · {initialFile.name}</Button>}
    <label className="block text-sm">Returned PDF<input className="mt-1 block w-full" type="file" accept="application/pdf,.pdf" disabled={busy || !handoff || (record.returns?.length ?? 0) >= 10} onChange={event => {
      const file = event.target.files?.[0];event.target.value = '';if (!file) return;
      inspectFile(file);
    }} /></label>
    {candidate && handoff && <div className="space-y-3">
      <p role="status" className="text-sm">{assessmentText[candidate.evidence.assessment]}</p>
      <ul className="list-inside list-disc text-xs">
        <li>Page geometry: {candidate.evidence.checks.samePageGeometry ? 'agrees' : 'differs'}</li>
        <li>Content streams: {!candidate.evidence.checks.contentComparisonAvailable ? 'comparison unavailable' : candidate.evidence.checks.sameContentStreams ? 'agree' : 'differ'}</li>
        <li>Page resources: {!candidate.evidence.checks.resourceComparisonAvailable ? 'comparison unavailable' : candidate.evidence.checks.samePageResources ? 'agree' : 'differ'}</li>
        <li>Original handoff bytes retained as prefix: {candidate.evidence.checks.originalPrefix ? 'yes' : 'no'}</li>
        <li>Handoff marker: {candidate.evidence.checks.matchingHandoffMarker ? 'present' : 'absent'}</li>
        <li>Signature field values found: {candidate.evidence.checks.signatureValuesPresent} (validity unverified)</li>
      </ul>
      <div className="flex flex-wrap gap-2"><Button variant="outline" aria-pressed={preview === 'handoff'} onClick={() => setPreview('handoff')}>View exact handoff</Button><Button variant="outline" aria-pressed={preview === 'return'} onClick={() => setPreview('return')}>View returned file</Button></div>
      <RetainedSigningPreview data={preview === 'handoff' ? handoff.pdf.data : candidate.pdf.data} label={preview === 'handoff' ? 'Exact handoff PDF' : 'Candidate returned PDF'} />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I compared every page and the signer assignments, and reviewed the signatures in my signing application.</label>
      {candidate.evidence.assessment !== 'checks-agree' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acceptMismatch} onChange={event => setAcceptMismatch(event.target.checked)} />I understand this file is unchanged, differs, or has inconclusive matching evidence. Associate it with this handoff without marking signing complete.</label>}
      <Button disabled={busy || !reviewed || candidate.evidence.assessment !== 'checks-agree' && !acceptMismatch} onClick={() => void run(async isCurrent => {
        const saved = await associateSigningReturn(record, candidate, { reviewed, acceptedMismatch: acceptMismatch }, isCurrent);
        if (isCurrent()) onSaved(saved);
      })}>Associate returned PDF</Button>
    </div>}
    {(record.returns ?? []).map((value, index) => <div className="space-y-1 rounded border p-2" key={value.id}>
      <p className="text-sm">Return {index + 1}: {value.pdf.filename} · associated, signer authenticity unverified</p>
      <p className="text-xs">{assessmentText[value.evidence.assessment]}</p>
      <p className="break-all text-xs">Returned PDF SHA-256: {value.pdf.sha256}</p>
      <Button variant="outline" disabled={busy} onClick={() => { setRetainedId(value.id);setRetainedReviewed(false); }}>Preview saved return {index + 1}</Button>
    </div>)}
    {retained && <div className="space-y-3">
      <RetainedSigningPreview data={retained.pdf.data} label="Retained returned PDF" />
      <SignatureVerificationReport key={retained.id} readPdf={() => base64ToUint8Array(retained.pdf.data)} />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={retainedReviewed} onChange={event => setRetainedReviewed(event.target.checked)} />I reviewed this retained returned PDF before downloading its unchanged bytes.</label>
      <Button disabled={busy || !retainedReviewed} onClick={downloadRetained}>Download unchanged returned PDF</Button>
    </div>}
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { SignatureGraphicPicker } from './SignatureGraphicPicker';
import { SigningPdfPreview } from './SigningPdfPreview';
import { confirmSigningDisclosure } from './signingDisclosure';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';
import { base64ToUint8Array } from '@/lib/encoding';
import { prepareHandwrittenRevision, saveHandwrittenRevision, type HandwrittenRevision } from '@/lib/handwrittenSigning';
import type { ManualSignature } from '@/lib/manualSignatureFields';
import type { SigningRecord } from '@/lib/signingWorkspace';

export type AttachHandwritten = (record: SigningRecord, mark: HandwrittenRevision, current: () => boolean) => Promise<void>;
interface Props {
  onAttach?: AttachHandwritten;
  record: SigningRecord;
  fields: readonly ManualSignature[];
  field?: ManualSignature;
  disabled: boolean;
  onSaved(record: SigningRecord): void;
}
export function HandwrittenSigning({ record, fields, field, disabled, onSaved, onAttach }: Props) {
  const [open, setOpen] = useState(false);
  const [graphic, setGraphic] = useState<string>();
  const [imageBusy, setImageBusy] = useState(false);
  const [candidate, setCandidate] = useState<HandwrittenRevision>();
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);

  async function perform(task: (current: () => boolean) => Promise<void>) {
    const id = ++generation.current;
    const current = () => id === generation.current;
    setError(''); setPending(true);
    try { await task(current); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The handwritten revision could not be saved.'); }
    finally { if (current()) setPending(false); }
  }
  function download(revision: HandwrittenRevision) {
    const lease = reserveSigningPdfDownload();
    void perform(async current => {
      try {
        const bytes = base64ToUint8Array(revision.pdf.data);
        await confirmSigningDisclosure({ pdfs: [{ bytes, label: revision.pdf.filename }], metadata: revision.field }, current);
        if (!await lease.deliver(bytes, 'Handwritten-' + revision.pdf.filename, current)) throw new Error('The PDF download was interrupted.');
      } finally { lease.release(); }
    });
  }
  const existing = record.handwritten ?? [];
  const allowed = !record.source.existingSignatureNames?.length && field && !existing.some(item => item.field.id === field.id);
  const page = candidate?.pdf.pages[candidate.field.page];
  const landscape = page?.rotation === 90 || page?.rotation === 270;
  return <section aria-label="Handwritten signatures" className="space-y-2">
    {allowed && !open && <Button variant="outline" disabled={disabled || pending || existing.length >= 10} onClick={() => setOpen(true)}>Add handwritten signature</Button>}
    {allowed && open && <fieldset disabled={pending || disabled} className="space-y-3 rounded border p-3">
      <legend className="px-1 text-sm font-medium">Handwritten signature · {field.signer}</legend>
      <SignatureGraphicPicker value={graphic} onBusyChange={setImageBusy} onChange={png => {
        setGraphic(png); setCandidate(undefined); setReady(false); setError('');
      }} />
      <div className="flex flex-wrap gap-2">
        {graphic && !candidate && <Button variant="outline" disabled={imageBusy} onClick={() => void perform(async current => {
          const next = await prepareHandwrittenRevision(record, field, graphic); if (current()) setCandidate(next);
        })}>Preview handwritten signature</Button>}
        <Button variant="ghost" disabled={imageBusy} onClick={() => {
          generation.current++; setOpen(false); setCandidate(undefined); setGraphic(undefined); setReady(false); setError('');
        }}>Cancel</Button>
      </div>
      {candidate && page && <><p className="text-sm">Page {candidate.field.page + 1} · {candidate.field.signer}</p>
        <div className="max-h-[55dvh] overflow-auto rounded border" aria-label="Handwritten PDF preview">
          <SigningPdfPreview data={candidate.pdf.data} page={candidate.field.page} width={landscape ? page.height : page.width}
            height={landscape ? page.width : page.height} onReadiness={setReady} />
        </div>
        <Button disabled={!ready || imageBusy} onClick={() => void perform(async current => {
          const next = await saveHandwrittenRevision(record, fields, candidate, current);
          if (current()) onSaved(next);
        })}>Save handwritten revision</Button>
      </>}
    </fieldset>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {existing.map((revision, index) => <div key={revision.id} className="flex flex-wrap items-center gap-2 text-sm">
      <span>Handwritten · {revision.field.signer} · revision {index + 1}</span>
      {onAttach && index === existing.length - 1 && <Button disabled={disabled || pending} onClick={() => void perform(async current => {
        await confirmSigningDisclosure({ pdfs: [{ bytes: base64ToUint8Array(revision.pdf.data), label: revision.pdf.filename }], metadata: revision.field }, current, { action: 'sign' });
        await onAttach(record, revision, current);
      })}>Save handwritten revision to package</Button>}
      <Button variant="outline" size="sm" disabled={disabled || pending} onClick={() => download(revision)}>Download handwritten PDF {index + 1}</Button>
    </div>)}
  </section>;
}

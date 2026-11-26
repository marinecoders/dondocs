import { useEffect, useRef, useState } from 'react';
import type { PackageMember, PackageRevision } from '@/lib/actionPackages';
import { packageNavigationNames } from '@/lib/packageNavigationNames';
import { MAX_SIGNING_PDF_BYTES } from '@/lib/manualSignatureFields';
import { packageFormSigningAction } from '@/lib/packageOfficialForms';
import { officialSigningRecords } from '@/lib/officialSigning';
import { capturedReturnHandoffs, packageReturnCandidates } from '@/lib/packageReturnCandidates';
import { Button } from './ui/button';

export function PackageSignedReturnPicker({ packageId, revision, disabled, onOpen, onHandoff }: {
  packageId: string; revision: PackageRevision; disabled: boolean;
  onHandoff(id: string, file: File): void;
  onOpen(member: PackageMember, recordId: string, file: File): void;
}) {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<{ file: File; handoffs: Awaited<ReturnType<typeof capturedReturnHandoffs>>; matches: Awaited<ReturnType<typeof packageReturnCandidates>> }>();
  const job = useRef<AbortController | null>(null);
  useEffect(() => () => job.current?.abort(), []);
  async function match(file: File) {
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    setPending(true); setResult(undefined); setError('');
    try {
      if (!file.size || file.size > MAX_SIGNING_PDF_BYTES) throw new Error('Choose a PDF up to 20 MB.');
      const bytes = await file.arrayBuffer();
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Choose a PDF file.');
      const handoffs = await capturedReturnHandoffs(revision, bytes, controller.signal);
      let matches: Awaited<ReturnType<typeof packageReturnCandidates>> = [];
      if (revision.members.some(packageFormSigningAction)) {
        try {
          matches = await packageReturnCandidates(packageId, revision, bytes, await officialSigningRecords(), controller.signal);
        } catch (cause) {
          if (controller.signal.aborted || !handoffs.length) throw cause;
          setError('Saved form signing records could not be checked. Captured package handoffs are shown below.');
        }
      }
      controller.signal.throwIfAborted();
      setResult({ file, matches, handoffs });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The return could not be matched.');
    } finally { if (!controller.signal.aborted) setPending(false); }
  }
  const count = result ? result.matches.length + result.handoffs.length : 0;
  const names = result?.matches.length ? packageNavigationNames(revision) : undefined;
  return <section aria-label="Returned signed PDF" className="mt-3 space-y-2">
    <label className="block text-sm font-medium">Match returned signed PDF
      <input type="file" accept=".pdf,application/pdf" disabled={disabled} className="mt-2 block" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (file) void match(file);
      }} />
    </label>
    {pending && <p role="status">Checking saved signing revisions…</p>}
    {error && <p role="alert">{error}</p>}
    {result && <><p role="status" className="text-sm">{count === 0
      ? 'No current signing revision matches this PDF. Check the case and the revision sent for signature.'
      : count === 1 ? 'Saved revision matched. Inspect the signatures before attaching this file.' : 'Several saved revisions match. Choose the intended document.'}</p>
      {result.handoffs.map(handoff => <Button key={handoff.id} size="sm" variant="outline" disabled={disabled}
        onClick={() => onHandoff(handoff.id, result.file)}>Inspect handoff · {handoff.pdfs.handoff.name} · {handoff.id.slice(-8)}</Button>)}
      {result.matches.map(({member, recordId}) => <Button key={recordId} size="sm" variant="outline" disabled={disabled}
        onClick={() => onOpen(member, recordId, result.file)}>Inspect {names?.get(member.id)}{result.matches.length > 1 && ' · ' + recordId.slice(-8)}</Button>)}
    </>}
  </section>;
}

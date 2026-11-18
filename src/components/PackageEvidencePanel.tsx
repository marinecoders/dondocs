import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { preparePackageAttachment, applyPreparedPackageAttachment, copyPreparedPackageAttachmentImage, type PreparedPackageAttachment } from '@/lib/packageAttachments';
import { PACKAGE_ATTACHMENT_ACCEPT } from '@/lib/packageAttachmentCapabilities';
import { getExportDeploymentPolicy } from '@/config/classification';

interface Props {
  record: ActionPackage; revision: PackageRevision; disabled: boolean; busy: boolean;
  run(action: () => Promise<void>): Promise<void>; signal(): AbortSignal | undefined; isCurrent(): boolean;
  onApply(record: ActionPackage): void; onDirtyChange?(dirty: boolean): void;
}
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
export function PackageEvidencePanel({ record, revision, disabled, busy, run, signal, isCurrent, onApply, onDirtyChange }: Props) {
  const heading = useId(), owner = `${record.id}:${record.sequence}:${revision.id}`;
  const [prepared, setPrepared] = useState<PreparedPackageAttachment | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const lifetime = useRef(false), ownerRef = useRef(owner), previous = useRef(owner), generation = useRef(0), running = useRef(false), dirtyCallback = useRef(onDirtyChange);
  const editable = !disabled && !record.archived && record.currentRevisionId === revision.id && !record.reviewRounds?.some(round => round.ownerPackageId === undefined);
  const locked = !editable || busy || pending;
  useLayoutEffect(() => { ownerRef.current = owner; dirtyCallback.current = onDirtyChange; });
  useEffect(() => { lifetime.current = true; return () => { lifetime.current = false; dirtyCallback.current?.(false); }; }, []);
  useLayoutEffect(() => {
    if (previous.current === owner) return;
    previous.current = owner; generation.current++; setPrepared(null); setAcknowledged(false); setError('');
  }, [owner]);
  useEffect(() => { onDirtyChange?.(prepared !== null); }, [prepared, onDirtyChange]);
  async function perform(action: (current: () => boolean) => Promise<void>) {
    if (locked || running.current) return;
    const capturedOwner = owner, capturedGeneration = generation.current;
    const current = () => lifetime.current && ownerRef.current === capturedOwner && generation.current === capturedGeneration && isCurrent() && !signal()?.aborted;
    running.current = true; setPending(true); setError('');
    try { await run(async () => { if (current()) await action(current); }); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The supporting file could not be processed.'); }
    finally { running.current = false; if (lifetime.current) setPending(false); }
  }
  return <section aria-labelledby={heading} aria-busy={pending} className="min-w-0 space-y-3 rounded border bg-background p-2 sm:p-4">
    <h3 id={heading} className="font-medium">Supporting evidence files</h3>
    <p className="text-sm text-muted-foreground">Keep images, text, CSV and Office files with the action. Original bytes travel with editable handoffs. PDF assembly supports images and qualified text; other files need a separately reviewed PDF.</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {!editable && <p className="text-xs text-muted-foreground">Add files from the current owning revision.</p>}
    <label className="block min-w-0 text-sm">Choose supporting evidence<input aria-label="Choose supporting evidence" type="file" accept={PACKAGE_ATTACHMENT_ACCEPT} disabled={locked || !!prepared} className="mt-1 block w-full min-w-0 max-w-full text-sm"
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        void perform(async current => { if (file.size > 20 * 1024 * 1024) throw new Error('Supporting files are limited to 20 MB.');
          const bytes = await file.arrayBuffer(); if (!current()) return;
          const value = await preparePackageAttachment(record, { name: file.name, type: file.type, data: bytes }, await getExportDeploymentPolicy(), signal());
          if (current()) { setPrepared(value); setAcknowledged(false); }
        });
      }} /></label>
    {prepared && <div className="min-w-0 space-y-3 rounded border p-2 text-sm sm:p-3">
      <p className="break-words font-medium">{prepared.name} · {prepared.size.toLocaleString()} bytes</p>
      <p className="break-words">{prepared.notice}</p>
      {prepared.type.startsWith('image/') && <EvidenceImage prepared={prepared} />}
      {prepared.previewText && <details className="min-w-0 rounded border p-2"><summary className="cursor-pointer">Retained text preview</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words pt-2 font-sans">{prepared.previewText}</pre><p className="text-xs text-muted-foreground">Preview shows up to 4,000 characters. Privacy and deployment checks include the full supported text inventory.</p></details>}
      {prepared.review.privacy.findings.map((finding, index) => <p key={index} className="break-words text-xs">{finding.type}: {finding.value}</p>)}
      <label className="flex items-start gap-2"><input type="checkbox" disabled={locked} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed this original file, its retained content and privacy findings.</label>
      <div className="flex flex-wrap gap-2"><Button className={buttonClass} disabled={locked || !acknowledged} onClick={() => void perform(async current => {
        const value = await applyPreparedPackageAttachment(prepared, await getExportDeploymentPolicy(), acknowledged, signal(), current);
        if (current()) { dirtyCallback.current?.(false); setPrepared(null); setAcknowledged(false); onApply(value); }
      })}>Add reviewed evidence file</Button>
        <Button className={buttonClass} variant="outline" disabled={locked} onClick={() => { generation.current++; setPrepared(null); setAcknowledged(false); setError(''); }}>Discard evidence file</Button></div>
    </div>}
  </section>;
}

function EvidenceImage({ prepared }: { prepared: PreparedPackageAttachment }) {
  const image = useRef<HTMLImageElement>(null), fullSize = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const blob = copyPreparedPackageAttachmentImage(prepared);
    if (!blob || !image.current) return;
    const url = URL.createObjectURL(blob); image.current.src = url; if (fullSize.current) fullSize.current.href = url;
    return () => URL.revokeObjectURL(url);
  }, [prepared]);
  return <div className="min-w-0 space-y-2"><img ref={image} alt={`Original supporting evidence: ${prepared.name}`} className="max-h-96 max-w-full rounded border object-contain" /><a ref={fullSize} target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline underline-offset-2">Open original image at full size</a></div>;
}

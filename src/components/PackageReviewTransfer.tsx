import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { ActionPackage, PackageReviewRound } from '@/lib/actionPackages';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { buildPackageReviewerCopy, buildPackageReviewReturn, importPackageReviewerCopy, packageReviewTransferFile,
  preparePackageReviewerImport, type PreparedPackageReviewTransfer } from '@/lib/packageReviewTransfer';
import { triggerDownload } from '@/lib/encoding';
import { MAX_PACKAGE_FILE_BYTES } from '@/lib/actionPackageTransfer';
import { packageReviewRoundStatus } from '@/lib/packageReviewRounds';
import { PackageContentFindings } from './PackageExportFindings';

interface Props {
  record?: ActionPackage; round: PackageReviewRound | null; busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  onImport(record: ActionPackage): void; isCurrent(): boolean; signal(): AbortSignal | undefined;
  directDownload?: boolean;
  autoPrepareRoundId?: string | null;
}
export function PackageReviewTransfer(props: Props) {
  return <PackageReviewTransferView key={`${props.record?.id ?? ''}:${props.record?.sequence ?? 0}:${props.round?.id ?? ''}`} {...props} />;
}
function PackageReviewTransferView({ record, round, busy, run, onImport, isCurrent, signal, directDownload = false, autoPrepareRoundId }: Props) {
  const scope = useRef({ alive: true });
  useEffect(() => { const lifetime = scope.current; lifetime.alive = true; return () => { lifetime.alive = false; }; }, []);
  const current = () => scope.current.alive && isCurrent();
  const [prepared, setPrepared] = useState<PreparedPackageReviewTransfer | null>(null), [approved, setApproved] = useState(false);
  const preparedResult = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!prepared || !directDownload) return;
    preparedResult.current?.scrollIntoView?.({ block: 'start' }); preparedResult.current?.focus({ preventScroll: true });
  }, [prepared, directDownload]);
  const autoPrepared = useRef<string | null>(null), callbacks = useRef({ run, isCurrent });
  useLayoutEffect(() => { callbacks.current = { run, isCurrent }; });
  useEffect(() => {
    if (busy || !autoPrepareRoundId || round?.id !== autoPrepareRoundId || !record || round.ownerPackageId !== record.id || autoPrepared.current === round.id) return;
    autoPrepared.current = round.id;
    queueMicrotask(() => {
      if (!scope.current.alive || !callbacks.current.isCurrent()) return;
      void callbacks.current.run(async () => {
        const value = await buildPackageReviewerCopy(record, round.id, await getExportDeploymentPolicy());
        if (scope.current.alive && callbacks.current.isCurrent()) { setPrepared(value); setApproved(false); }
      });
    });
  }, [autoPrepareRoundId, busy, record, round]);
  if (directDownload && record && !round) return null;
  return <section aria-label="Portable package reviews" className="space-y-3 rounded border p-3">
    <h3 className="font-medium">{directDownload ? round && record && round.ownerPackageId === record.id ? 'Review copy' : round ? 'Return feedback' : 'Import a review copy' : 'Package reviewer files'}</h3>
    {!directDownload && <p className="text-xs text-muted-foreground">Reviewer copies include the exact captured package, originals, retained files and review discussion. Open them in an independent browser to collect feedback. Returns identify this exact round and member; reviewer names are self-entered.</p>}
    <label hidden={directDownload && !!record} className="block text-sm">Import package reviewer copy<input aria-label="Import package reviewer copy" type="file" accept=".json" disabled={busy} className="block max-w-full"
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => {
        setPrepared(null); setApproved(false);
        if (file.size > MAX_PACKAGE_FILE_BYTES) throw new Error('Package review files are limited to 100 MB.');
        const json = await file.text(); if (!current()) return;
        const result = await preparePackageReviewerImport(json, await getExportDeploymentPolicy());
        if (current()) setPrepared(result);
      }); }} /></label>
    {record && round && packageReviewRoundStatus(round) === 'active' && (!directDownload || !prepared) && <div className="flex flex-wrap gap-2">
      {round.ownerPackageId === record.id && <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => void run(async () => {
        setPrepared(null); setApproved(false); const value = await buildPackageReviewerCopy(record, round.id, await getExportDeploymentPolicy());
        if (current()) setPrepared(value);
      })}>Prepare package reviewer copy</Button>}
      {(!directDownload || round.ownerPackageId !== record.id) && <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => void run(async () => {
        setPrepared(null); setApproved(false); const value = await buildPackageReviewReturn(record, round.id, await getExportDeploymentPolicy());
        if (current()) setPrepared(value);
      })}>Prepare package feedback return</Button>}
    </div>}
    {prepared && <div ref={preparedResult} tabIndex={-1} className="space-y-3 outline-none">
      <p className="font-medium break-words">{directDownload ? 'Included content' : `Review transfer contents: ${prepared.packageName}`}</p>
      {directDownload && <><p className="text-sm text-muted-foreground">{prepared.packageName}</p><ul className="divide-y text-sm">{prepared.contents.map((item, index) => <li key={index} className="py-3">{item.label}{item.retainedPdf && <span className="ml-2 text-xs text-muted-foreground">Retained PDF</span>}</li>)}</ul></>}
      {directDownload ? <PackageContentFindings reviews={prepared.reviews.map(review => ({ member: '', review }))} /> : prepared.reviews.map((review, index) => <div key={index} className="space-y-1 text-sm">
        {review.notices.map((notice, index) => <p key={index} className="whitespace-pre-wrap break-words">{notice}</p>)}
        {review.privacy.findings.map((finding, index) => <p key={index} className="whitespace-pre-wrap break-words">{finding.type}: {finding.value}</p>)}
      </div>)}
      {!directDownload && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />I reviewed all captured members, original PDF pages, retained content, discussion and privacy findings for this transfer.</label>}
      <div className="flex flex-wrap gap-2"><Button className="h-auto min-h-9 max-w-full whitespace-normal" disabled={busy || !directDownload && !approved} onClick={() => void run(async () => {
        const policy = await getExportDeploymentPolicy(); if (!current()) return;
        if (prepared.mode === 'import') {
          const imported = await importPackageReviewerCopy(prepared, policy, signal(), () => {
            const currentPolicy = getExportDeploymentPolicySync();
            return current() && currentPolicy.status === 'ready' && policy.status === 'ready'
              && JSON.stringify(currentPolicy.policy) === JSON.stringify(policy.policy);
          });
          if (current()) onImport(imported);
        } else {
          const json = await packageReviewTransferFile(prepared, policy);
          if (!current()) return;
          // Check synchronous deployment state again at the actual download boundary.
          const sync = getExportDeploymentPolicySync();
          if (sync.status !== 'ready' || policy.status !== 'ready' || JSON.stringify(sync.policy) !== JSON.stringify(policy.policy)) throw new Error('The deployment policy changed. Review this transfer again.');
          triggerDownload(new TextEncoder().encode(json), `dondocs-package-review-${prepared.mode}.json`, 'application/json');
        }
        setPrepared(null); setApproved(false);
      })}>{directDownload ? prepared.mode === 'import' ? 'Import review copy' : prepared.mode === 'copy' ? 'Download review copy' : 'Download feedback' : prepared.mode === 'import' ? 'Import reviewed package reviewer copy' : prepared.mode === 'copy' ? 'Download package reviewer copy' : 'Download package feedback return'}</Button>
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => { setPrepared(null); setApproved(false); }}>{directDownload ? 'Cancel' : 'Cancel package review transfer'}</Button></div>
    </div>}
  </section>;
}

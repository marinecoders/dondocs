import { Button } from '@/components/ui/button';
import type { ActionPackage, PackageReviewRound } from '@/lib/actionPackages';
import { packageReviewRoundStatus } from '@/lib/packageReviewRounds';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';

/** Parent callbacks participate in the package dialog's cancellation and CAS boundary. */
export function PackageReviewControls({ record, disabled, opened, onStart, onOpen, onTransition, onExit, workspace = false }: {
  record: ActionPackage; disabled: boolean; opened: PackageReviewRound | null;
  onStart(): void; onOpen(roundId: string): void; onExit(): void;
  onTransition(roundId: string, transition: 'close' | 'reopen'): void;
  workspace?: boolean;
}) {
  return <section aria-label="Saved package reviews" className="space-y-3 rounded border p-3">
    <h3 className="font-medium">{workspace ? 'Review copies' : 'Review a saved package revision'}</h3>
    <p className="text-xs text-muted-foreground">{workspace ? 'Each copy stays tied to the version it was created from.' : 'Start a review of the selected saved revision. Captured members, original PDFs, templates and retained output stay with this review when the package or its source documents change.'}</p>
    <Button className={buttonClass} variant="outline" disabled={disabled || record.archived || !!opened || record.reviewRounds?.some(round => round.ownerPackageId === undefined)} onClick={onStart}>{workspace ? 'New review copy' : 'Start package review'}</Button>
    {(record.reviewRounds ?? []).map(round => <div key={round.id} tabIndex={-1} data-package-review-id={round.id} className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 break-words text-sm">{round.label} · {packageReviewRoundStatus(round)} · {new Date(round.createdAt).toLocaleString()}</span>
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={disabled} onClick={() => onOpen(round.id)}>Open review {round.label}</Button>
      {round.ownerPackageId === record.id && packageReviewRoundStatus(round) !== 'superseded' && <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={disabled}
        aria-label={workspace ? `${packageReviewRoundStatus(round) === 'closed' ? 'Reopen' : 'End'} ${round.label}` : undefined}
        onClick={() => onTransition(round.id, packageReviewRoundStatus(round) === 'closed' ? 'reopen' : 'close')}>
        {workspace ? packageReviewRoundStatus(round) === 'closed' ? 'Reopen review' : 'End review' : packageReviewRoundStatus(round) === 'closed' ? 'Reopen package review' : 'Close package review'}
      </Button>}
    </div>)}
    {opened && <div role="status" className="space-y-1 text-sm">
      <p className="font-medium">Reviewing exact saved package revision</p>
      {!workspace && <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={disabled} onClick={onExit}>Return to package workspace</Button>}
      {workspace ? <details className="pt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Review details</summary><p className="mt-3 break-all">{opened.label} · {packageReviewRoundStatus(opened)} · Saved revision {opened.revisionId.slice(-8)}</p><p className="mt-2">{opened.baseline.members.length} documents · {opened.baseline.outputs.length} retained PDFs. Original files and signatures are preserved.</p></details> : <><p className="break-all">{opened.label} · {packageReviewRoundStatus(opened)} · Revision ID: {opened.revisionId}</p>
      <p>{opened.baseline.members.length} captured members · {opened.baseline.outputs.length} retained outputs. Return to the package workspace to select another saved revision.</p>
      <p className="text-xs text-muted-foreground">Original PDFs retain their original bytes and signatures. This review does not edit source documents or confer approval.</p></>}
    </div>}
  </section>;
}

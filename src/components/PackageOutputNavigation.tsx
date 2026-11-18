import { Button } from './ui/button';
import type { PackageOutput, PackageRevision } from '@/lib/actionPackages';
import type { PackageDestination } from '@/lib/packageDestinations';

interface Props {
  output?: PackageOutput;
  revision: PackageRevision;
  disabled?: boolean;
  onOpenPage?(outputId: string, page: number): void;
  onNavigate?(destination: PackageDestination): void;
}
/** Saved physical ranges are shown alongside the independently printed labels. */
export function PackageOutputNavigation({ output, revision, disabled = false, onOpenPage, onNavigate }: Props) {
  const entries = output?.navigation;
  if (!output || !entries?.length) return null;
  return <section aria-label="Saved PDF contents" className="min-w-0 space-y-3 rounded border p-2 text-sm sm:p-3">
    <h3 className="font-medium">Saved PDF contents</h3>
    <p className="text-xs text-muted-foreground">PDF positions belong to this retained file. Printed document numbers follow each member’s numbering.</p>
    <ol className="min-w-0 space-y-2">{entries.map(entry => <li key={entry.memberId} className="min-w-0 rounded border p-2">
      <p className="break-words font-medium">{entry.label}</p>
      <p className="text-xs">PDF pages {entry.startPage}–{entry.startPage + entry.pageCount - 1} · first printed label {entry.firstPageLabel}</p>
      {output.assembly?.placements?.find(item => item.memberId === entry.memberId) && <p className="mt-1 break-words text-xs text-muted-foreground">{output.assembly.placements.find(item => item.memberId === entry.memberId)!.reason}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {onOpenPage && <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" size="sm" disabled={disabled} onClick={() => onOpenPage(output.id, entry.startPage)}>Open PDF page {entry.startPage}</Button>}
        {onNavigate && revision.members.some(member => member.id === entry.memberId) && <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" size="sm" disabled={disabled} onClick={() => onNavigate({ revisionId: revision.id, memberId: entry.memberId, section: 'documents' })}>Inspect {entry.label}</Button>}
      </div>
    </li>)}</ol>
  </section>;
}

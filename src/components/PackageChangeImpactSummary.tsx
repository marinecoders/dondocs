import { useState } from 'react';
import { Button } from './ui/button';
import type { PackageChangeImpact, PackageImpactDestination, PackageImpactItem } from '@/lib/packageChangeImpact';

interface Props {
  impact: PackageChangeImpact;
  disabled?: boolean;
  onNavigate?(destination: PackageImpactDestination): void;
}
const labels = { added: 'Added', removed: 'Removed', changed: 'Changed', moved: 'Moved', 'metadata-only': 'Context changed', renumbered: 'Renumbered', unchanged: 'Unchanged', unknown: 'Needs inspection', unavailable: 'Unavailable' };
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
function destinationLabel(value: PackageImpactDestination): string {
  return value.bindingId ? 'Inspect linked field' : value.factId ? 'Inspect shared value' : value.requirementId ? 'Inspect requirement'
    : value.citationId ? 'Inspect citation' : value.outputId ? 'Inspect retained PDF' : value.reviewRoundId ? 'Inspect review' : 'Inspect document';
}
function ImpactItem({ item, disabled, onNavigate }: { item: PackageImpactItem; disabled: boolean; onNavigate?: Props['onNavigate'] }) {
  return <li className="min-w-0 space-y-1 rounded border p-3">
    <p className="break-words font-medium">{item.label} · {labels[item.state]}</p>
    <p className="break-words">{item.message}</p>
    {item.beforePosition !== undefined && item.afterPosition !== undefined && item.beforePosition !== item.afterPosition && <p className="text-xs text-muted-foreground">Document {item.beforePosition} → {item.afterPosition}</p>}
    {(!!item.affectedMemberIds?.length || !!item.movedMemberIds?.length) && <p className="text-xs text-muted-foreground">
      {item.affectedMemberIds?.length ?? 0} affected document input{item.affectedMemberIds?.length === 1 ? '' : 's'} · {item.movedMemberIds?.length ?? 0} moved
    </p>}
    {item.availability === 'not-checked' && <p className="text-xs text-muted-foreground">File bytes have not been opened by this comparison.</p>}
    {onNavigate && !!item.destinations.length && <div className="flex flex-wrap gap-2 pt-1">
      {item.destinations.slice(0, 5).map((destination, index) => <Button key={index} className={buttonClass} size="sm" variant="outline" disabled={disabled}
        aria-label={`${destinationLabel(destination)} · ${item.label} · location ${index + 1}`} onClick={() => onNavigate(destination)}>{destinationLabel(destination)}</Button>)}
      {item.destinations.length > 5 && <p className="text-xs text-muted-foreground">{item.destinations.length} related locations. Inspect the shared value to find its other field links.</p>}
    </div>}
  </li>;
}

/** Same captured report serves saved-history comparison and privately prepared update previews. */
export function PackageChangeImpactSummary({ impact, disabled = false, onNavigate }: Props) {
  const scope = `${impact.beforeRevisionId}:${impact.afterRevisionId}`;
  const [showUnchanged, setShowUnchanged] = useState(false), [pagination, setPagination] = useState<{ scope: string; counts: Record<string, number> }>({ scope, counts: {} });
  const counts = pagination.scope === scope ? pagination.counts : {};
  const summary = impact.summary;
  return <section aria-label="Package impact details" className="min-w-0 space-y-3 rounded border p-3 text-sm">
    <h4 className="font-medium">What this change affects</h4>
    {impact.limited ? <p role="status">Detailed comparison is unavailable.</p> : <p className="break-words">
      {summary.changedMembers} changed document input{summary.changedMembers === 1 ? '' : 's'} · {summary.movedMembers} moved · {summary.changedFacts} changed shared value{summary.changedFacts === 1 ? '' : 's'}
    </p>}
    <p className="break-words text-xs text-muted-foreground">{summary.affectedOutputs} retained PDF{summary.affectedOutputs === 1 ? '' : 's'} need another check · {summary.affectedReviews} recorded review{summary.affectedReviews === 1 ? '' : 's'} affected · {summary.unknownEvidence} unavailable or unknown comparison{summary.unknownEvidence === 1 ? '' : 's'}</p>
    {impact.notices.map((notice, index) => <p key={index} className="break-words text-xs text-muted-foreground">{notice}</p>)}
    {!impact.limited && !impact.changed && <p>{summary.unknownEvidence ? 'No changes were confirmed; inspect the unavailable or unknown comparison items.' : 'No document or package-context changes were found in this comparison.'}</p>}
    {!impact.limited && <Button className={buttonClass} variant="outline" size="sm" disabled={disabled} aria-pressed={showUnchanged} onClick={() => setShowUnchanged(value => !value)}>
      {showUnchanged ? 'Hide unchanged items' : 'Show unchanged items'}
    </Button>}
    {impact.sections.map(section => {
      const items = section.items.filter(item => showUnchanged || item.state !== 'unchanged');
      if (!items.length) return null;
      const count = counts[section.kind] ?? 25;
      return <details key={section.kind} className="min-w-0 space-y-2 rounded border p-3" open={section.kind === 'member'}>
        <summary className="cursor-pointer break-words font-medium">{section.label} ({items.length})</summary>
        <ul className="min-w-0 space-y-2 pt-2">{items.slice(0, count).map(item => <ImpactItem key={item.id} item={item} disabled={disabled} onNavigate={onNavigate} />)}</ul>
        {items.length > count && <Button className={buttonClass} variant="outline" size="sm" disabled={disabled} onClick={() => setPagination({ scope, counts: { ...counts, [section.kind]: count + 25 } })}>Show more {section.label.toLocaleLowerCase()}</Button>}
      </details>;
    })}
  </section>;
}

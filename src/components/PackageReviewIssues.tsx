import { useState } from 'react';
import type { PackageNextAction } from '@/lib/packageNextActions';
import { AffectedPackageDocuments } from './PackageNextActions';
import { Button } from './ui/button';

export function PackageReviewIssues({ actions, onOpen, disabled }: {
  actions: PackageNextAction[];
  onOpen(action: PackageNextAction): void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!actions.length) return null;
  return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="border-b pb-3">
    <summary className="cursor-pointer text-sm font-medium">Before PDF delivery · {actions.length} {actions.length === 1 ? 'issue' : 'issues'}</summary>
    <ol className="mt-2 divide-y">{actions.map(action => <li key={action.id} className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <div className="min-w-0 break-words">
        <p>{action.message}</p>
        <AffectedPackageDocuments documents={action.affectedDocuments} />
      </div>
      {action.destination && <Button size="sm" variant="link" disabled={disabled} onClick={() => onOpen(action)}>
        {action.destination.correction?.label ?? action.label}
      </Button>}
    </li>)}</ol>
  </details>;
}

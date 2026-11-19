import { useEffect, useState } from 'react';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { derivePackageNextActions, type PackageNextActions as Findings } from '@/lib/packageNextActions';
import type { PackageDestination } from '@/lib/packageDestinations';
import { Button } from './ui/button';

export function PackageNextActions({ record, revision, disabled, reviewBaseline, onNavigate, onPrepare }: {
  record: ActionPackage;
  revision: PackageRevision;
  disabled: boolean;
  reviewBaseline: boolean;
  onNavigate(destination: PackageDestination): void;
  onPrepare(): void;
}) {
  const owner = `${record.id}:${record.sequence}:${revision.id}:${reviewBaseline}`;
  const [inspection, setInspection] = useState<{ owner: string; result?: Findings; error?: string } | null>(null);
  const result = inspection?.owner === owner ? inspection.result : undefined;
  const error = inspection?.owner === owner ? inspection.error : undefined;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void derivePackageNextActions(record, revision.id, { signal: controller.signal, reviewBaseline }).then(value => {
      if (current) setInspection({ owner, result: value });
    }).catch(cause => {
      if (current && !controller.signal.aborted) setInspection({ owner, error: cause instanceof Error ? cause.message : 'Package checks are unavailable.' });
    });
    return () => { current = false; controller.abort(); };
  }, [record, revision.id, reviewBaseline, owner]);
  const blockers = result?.actions.filter(action => action.blocking) ?? [];
  return <section aria-label="Package checks" className="space-y-4 border-b pb-6">
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-base font-medium">{error ? 'Package checks unavailable' : result ? blockers.length ? `${blockers.length} item${blockers.length === 1 ? '' : 's'} before PDF` : 'PDF checks complete' : 'Checking package…'}</h2>
      {result?.readyForOperation && <Button disabled={disabled} onClick={onPrepare}>Review PDF</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {blockers.slice(0, expanded ? undefined : 3).map(action => <div key={action.id} className="flex items-start justify-between gap-6 text-sm">
      <p className="min-w-0 break-words">{action.message}</p>
      {action.destination && <Button variant="link" size="sm" className="h-auto shrink-0 p-0" disabled={disabled}
        onClick={() => onNavigate(action.destination!)}>Open {action.destination.section === 'documents' ? 'document' : 'details'}</Button>}
    </div>)}
    {blockers.length > 3 && <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer' : `Show ${blockers.length - 3} more`}</Button>}
  </section>;
}

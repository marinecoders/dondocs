import type { usePackageChecks } from './usePackageChecks';
import { useState } from 'react';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import type { PackageNextActions as Findings } from '@/lib/packageNextActions';
import type { PackageDestination } from '@/lib/packageDestinations';
import { Button } from './ui/button';

export function DocumentPdfChecks({ actions, onNavigate, disabled, editable, inline = false }: {
  inline?: boolean; actions: Findings['actions']; onNavigate(destination: PackageDestination): void; disabled: boolean; editable: boolean;
}) {
  if (!actions.length) return null;
  const list = <ul className="mt-2 divide-y pl-3">{actions.map(action => <li key={action.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
      <span>{action.message}</span>{action.destination && <Button variant="link" size="sm" className="h-auto p-0" disabled={disabled}
        onClick={() => onNavigate(action.destination!)}>{editable && action.destination.correction ? action.destination.correction.label : 'Open details'}</Button>}
    </li>)}</ul>;
  return inline ? list : <details className="mt-2 text-sm"><summary className="cursor-pointer text-muted-foreground">{actions.length} {actions.length === 1 ? 'item' : 'items'} before PDF</summary>{list}</details>;
}

export function PackageNextActions({ record, revision, checks, disabled, quiet = false, reviewBaseline, onNavigate, onPrepare }: {
  record: ActionPackage;
  revision: PackageRevision;
  checks: ReturnType<typeof usePackageChecks>;
  disabled: boolean;
  quiet?: boolean;
  reviewBaseline: boolean;
  onNavigate(destination: PackageDestination): void;
  onPrepare(): void;
}) {
  const { result, error } = checks;
  const [expanded, setExpanded] = useState(false);
  const blockers = result?.actions.filter(action => action.blocking) ?? [];
  const panel = <section aria-label="Package checks" className="space-y-4 border-b pb-6">
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-base font-medium">{error ? 'Package checks unavailable' : result ? blockers.length ? `${blockers.length} item${blockers.length === 1 ? '' : 's'} before PDF` : 'PDF checks complete' : 'Checking package…'}</h2>
      {result?.readyForOperation && <Button disabled={disabled || reviewBaseline} onClick={onPrepare}>Review PDF</Button>}
    </div>
    {reviewBaseline && result?.readyForOperation && <p className="text-sm text-muted-foreground">Return to the current package to prepare a new PDF. Saved PDFs remain available in Delivery.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {blockers.slice(0, expanded ? undefined : 3).map(action => <div key={action.id} className="flex items-start justify-between gap-6 text-sm">
      <p className="min-w-0 break-words">{action.destination?.memberId && revision.documentNames?.[action.destination.memberId] && <strong className="mr-1 font-medium">{revision.documentNames[action.destination.memberId]}:</strong>}{action.message}</p>
      {action.destination && <Button variant="link" size="sm" className="h-auto shrink-0 p-0" disabled={disabled}
        onClick={() => onNavigate(action.destination!)}>{!reviewBaseline && !record.archived && record.currentRevisionId === revision.id && action.destination.correction ? action.destination.correction.label : action.destination.section === 'documents' ? 'Open document' : 'Open details'}</Button>}
    </div>)}
    {blockers.length > 3 && <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer' : `Show ${blockers.length - 3} more`}</Button>}
  </section>;
  return quiet ? <details><summary className="cursor-pointer text-sm text-muted-foreground">Saved package checks</summary><div className="mt-3">{panel}</div></details> : panel;
}

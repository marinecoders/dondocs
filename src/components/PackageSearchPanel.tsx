import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { ActionPackage, PackageAsset, PackageRevision } from '@/lib/actionPackages';
import { searchCapturedPackage, type PackageSearchReport } from '@/lib/packageSearch';
import type { PackageDestination } from '@/lib/packageDestinations';

export interface PackageSearchScope {
  key: string; label: string; record: ActionPackage; revisionId: string; sourceRevisionId: string;
  readAsset(asset: PackageAsset): Promise<ArrayBuffer>;
}
interface Props {
  record: ActionPackage; revision: PackageRevision; disabled: boolean; busy: boolean; delivery?: PackageSearchScope;
  run(action: () => Promise<void>): Promise<void>; signal(): AbortSignal | undefined; isCurrent(): boolean;
  onNavigate?(destination: PackageDestination): void;
}
const button = 'h-auto min-h-9 max-w-full whitespace-normal';
export function PackageSearchPanel(props: Props) {
  return <PackageSearchView key={`${props.record.id}:${props.record.sequence}:${props.revision.id}:${props.delivery?.key ?? ''}`} {...props} />;
}
function PackageSearchView({ record, revision, disabled, busy, delivery, run, signal, isCurrent, onNavigate }: Props) {
  const heading = useId(), owner = `${record.id}:${record.sequence}:${revision.id}:${delivery?.key ?? ''}`;
  const [query, setQuery] = useState(''), [scope, setScope] = useState('package'), [report, setReport] = useState<PackageSearchReport | null>(null);
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const alive = useRef(false), ownerRef = useRef(owner), generation = useRef(0), running = useRef(false);
  useLayoutEffect(() => { ownerRef.current = owner; });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const locked = disabled || busy || pending, selected = scope === 'delivery' ? delivery : undefined;
  async function search() {
    if (locked || running.current || scope === 'delivery' && !selected) return;
    const capturedOwner = owner, capturedGeneration = generation.current;
    const current = () => alive.current && ownerRef.current === capturedOwner && generation.current === capturedGeneration && isCurrent() && !signal()?.aborted;
    running.current = true; setPending(true); setError('');
    try { await run(async () => {
      const result = await searchCapturedPackage(selected?.record ?? record, selected?.revisionId ?? revision.id, query, { signal: signal(), readAsset: selected?.readAsset });
      if (current()) setReport(result);
    }); } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Captured package search failed.'); }
    finally { running.current = false; if (alive.current) setPending(false); }
  }
  return <section aria-labelledby={heading} aria-busy={pending} className="min-w-0 space-y-3 rounded border bg-background p-2 sm:p-4">
    <h3 id={heading} className="font-medium">Search captured package</h3>
    <p className="text-sm text-muted-foreground">Search supported text in the selected saved revision or a prepared delivery. Library source changes and other saved revisions are outside this search.</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <form className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); void search(); }}>
      <label className="min-w-0 flex-1 text-sm">Search text<input aria-label="Search captured package text" value={query} maxLength={200} className="mt-1 block w-full min-w-0 rounded border bg-background p-2" disabled={locked} onChange={event => { generation.current++; setQuery(event.target.value); setReport(null); }} /></label>
      <label className="min-w-0 text-sm">Search scope<select aria-label="Captured package search scope" value={scope} disabled={locked} className="mt-1 block w-full min-w-0 rounded border bg-background p-2" onChange={event => { generation.current++; setScope(event.target.value); setReport(null); }}><option value="package">Selected package revision</option>{delivery && <option value="delivery">Prepared delivery: {delivery.label}</option>}</select></label>
      <Button type="submit" className={button} disabled={locked || !query.trim()}>Search captured text</Button>
    </form>
    {report && <div className="min-w-0 space-y-3"><p role="status" className="text-sm">{report.matches.length} captured match{report.matches.length === 1 ? '' : 'es'}{report.limited ? ' · search limit reached' : ''}</p>
      {report.notices.map((notice, index) => <p key={index} className="break-words text-xs text-muted-foreground">{notice}</p>)}
      <ol className="min-w-0 space-y-2">{report.matches.map(match => <li key={match.id} className="min-w-0 space-y-2 rounded border p-2 text-sm">
        <p className="break-words font-medium">{match.label} · {match.context}</p><p className="whitespace-pre-wrap break-words">{match.snippet}</p>
        <details className="min-w-0"><summary className="cursor-pointer text-xs">Read captured context</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words pt-2 font-sans">{match.text}</pre></details>
        {onNavigate && <Button className={button} variant="outline" size="sm" disabled={locked} onClick={() => onNavigate({ ...match.destination, revisionId: selected?.sourceRevisionId ?? revision.id })}>Open {match.context}</Button>}
      </li>)}</ol>
    </div>}
  </section>;
}

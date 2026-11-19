import { useState } from 'react';
import type { ActionPackage } from '@/lib/actionPackages';
import { getPackageRevision } from '@/lib/actionPackages';
import { Button } from './ui/button';

export function PackageLibrary({ records, loaded, disabled, onOpen, onCreate }: {
  records: readonly ActionPackage[];
  loaded: boolean;
  disabled: boolean;
  onOpen(record: ActionPackage): void;
  onCreate(): void;
}) {
  const [query, setQuery] = useState('');
  const filtered = [...records].sort((a, b) => getPackageRevision(b).createdAt - getPackageRevision(a).createdAt)
    .filter(record => record.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section aria-labelledby="package-library-title" className="space-y-7">
    <div className="flex items-center justify-between gap-4">
      <h1 id="package-library-title" className="text-2xl font-semibold tracking-tight">Packages</h1>
      <Button disabled={!loaded || disabled} onClick={onCreate}>New package</Button>
    </div>
    {!loaded ? <p role="status" className="text-sm text-muted-foreground">Loading packages…</p> : records.length === 0 ?
      <p className="py-10 text-sm text-muted-foreground">No packages yet. Create one to bring your documents together.</p> : <>
        <label className="block max-w-md text-sm">Search packages
          <input type="search" className="mt-2 w-full rounded-md border bg-background px-3 py-2" value={query}
            onChange={event => setQuery(event.target.value)} />
        </label>
        <ul className="divide-y" aria-label="Saved packages">
          {filtered.map(record => {
            const revision = getPackageRevision(record);
            return <li key={record.id}>
              <button type="button" disabled={disabled} onClick={() => onOpen(record)}
                className="flex w-full items-center justify-between gap-6 py-5 text-left hover:bg-accent/30 disabled:opacity-50">
                <span className="min-w-0"><span className="block break-words text-sm font-medium">{record.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{revision.members.length} document{revision.members.length === 1 ? '' : 's'}{record.archived ? ' · Archived' : ''}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleDateString()}</span>
              </button>
            </li>;
          })}
        </ul>
        {filtered.length === 0 && <p role="status" className="text-sm text-muted-foreground">No matching packages.</p>}
      </>}
  </section>;
}

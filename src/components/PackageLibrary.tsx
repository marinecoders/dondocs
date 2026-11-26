import { useMemo, useState } from 'react';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { packageSectionLabels, type PackageWorkspaceContext } from '@/lib/packageWorkspaceContext';
import { getPackageRevision, packageDocumentName } from '@/lib/actionPackages';
import { Button } from './ui/button';

function caseReference(revision: PackageRevision) {
  const fact = revision.information?.facts.find(item => !item.participantId && item.label.trim().toLowerCase() === 'case reference');
  const value = fact?.value ?? revision.templateState?.answers.values.caseReference;
  return typeof value === 'string' ? value.trim() : '';
}

export function PackageLibrary({ records, loaded, disabled, onOpen, onCreate, onResume, lastWorkspace, onContinue }: {
  records: readonly ActionPackage[];
  loaded: boolean;
  disabled: boolean;
  onOpen(record: ActionPackage): void;
  onCreate(): void;
  onResume?(): void;
  lastWorkspace?: PackageWorkspaceContext | null;
  onContinue?(record: ActionPackage, location: PackageWorkspaceContext): void;
}) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => records.map(record => {
    const revision = getPackageRevision(record);
    return { record, revision, reference: caseReference(revision) };
  }).sort((a, b) => b.revision.createdAt - a.revision.createdAt), [records]);
  const search = query.trim().toLocaleLowerCase();
  const filtered = rows.filter(({ record, reference }) => [record.name, reference].some(value => value.toLocaleLowerCase().includes(search)));
  const recent = lastWorkspace && rows.find(row => row.record.id === lastWorkspace.packageId && !row.record.archived);
  const lastRevision = (recent || undefined)?.record.revisions.find(revision => revision.id === lastWorkspace?.revisionId);
  const resumeReference = lastRevision ? caseReference(lastRevision) : recent?.reference;
  const lastMember = lastRevision?.members.find(member => member.id === lastWorkspace?.memberId);
  return <section aria-labelledby="package-library-title" className="space-y-7">
    <div className="flex items-center justify-between gap-4">
      <h1 id="package-library-title" className="text-2xl font-semibold tracking-tight">Packages</h1>
      <Button data-new-package disabled={!loaded || disabled} onClick={onCreate}>New package</Button>
    </div>
    {recent && lastWorkspace && onContinue && !search && <div className="space-y-1">
      <Button variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal break-words text-left" disabled={!loaded || disabled} onClick={() => onContinue(recent.record, lastWorkspace)}>
        Continue {recent.record.name}{resumeReference ? ' · ' + resumeReference : ''}
      </Button>
      <p className="text-xs text-muted-foreground">{packageSectionLabels[lastWorkspace.section]}
        {lastWorkspace.section === 'documents' && lastRevision && lastMember && ' · ' + packageDocumentName(lastRevision, lastMember)}
        {lastRevision && lastRevision.id !== recent.revision.id && ' · Saved version ' + (recent.record.revisions.indexOf(lastRevision) + 1)}
        {!lastRevision && ' · Current version'}</p>
    </div>}
    {onResume && <Button variant="outline" disabled={!loaded || disabled} onClick={onResume}>Resume unfinished action</Button>}
    {!loaded ? <p role="status" className="text-sm text-muted-foreground">Loading packages…</p> : records.length === 0 ?
      <p className="py-10 text-sm text-muted-foreground">No packages yet. Create one to bring your documents together.</p> : <>
        <label className="block max-w-md text-sm">Search packages
          <input type="search" className="mt-2 w-full rounded-md border bg-background px-3 py-2" value={query}
            onChange={event => setQuery(event.target.value)} />
        </label>
        <ul className="divide-y" aria-label="Saved packages">
          {filtered.map(({ record, revision, reference }) => {
            return <li key={record.id}>
              <button type="button" data-package-id={record.id} disabled={disabled} onClick={() => onOpen(record)}
                className="flex w-full items-center justify-between gap-6 py-5 text-left hover:bg-accent/30 disabled:opacity-50">
                <span className="min-w-0"><span className="block break-words text-sm font-medium">{record.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{reference && <>Case reference {reference} · </>}{revision.members.length} document{revision.members.length === 1 ? '' : 's'}{record.archived ? ' · Archived' : ''}</span>
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

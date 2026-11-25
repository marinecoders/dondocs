import { useState } from 'react';
import { Button } from './ui/button';

const visibleLimit = 12;

export function PackageOfficialFormChoices({ forms, onAdd }: {
  forms: ReadonlyArray<{ id: string; label: string }>;
  onAdd(id: string): void;
}) {
  const [query, setQuery] = useState('');
  // Ignore separators so "NAVMC 10132" and the catalog ID "navmc10132" both match.
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const needle = normalize(query);
  const matches = needle ? forms.filter(form => normalize(form.label).includes(needle) || normalize(form.id).includes(needle)) : forms;
  return <>
    {forms.length > visibleLimit && <label className="grid gap-1 text-sm">Search official forms
      <input type="search" className="rounded border bg-background p-2" placeholder="Form number or title" value={query}
        onChange={event => setQuery(event.target.value)} /></label>}
    {matches.slice(0, visibleLimit).map(form => <Button key={form.id} variant="outline" onClick={() => onAdd(form.id)}>Add {form.label}</Button>)}
    {matches.length > visibleLimit && <p className="text-sm text-muted-foreground">Showing {visibleLimit} of {matches.length} forms. Search to narrow the list.</p>}
    {!matches.length && query && <p role="status">No matching official forms.</p>}
  </>;
}

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowUpRight, Search, SearchX, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { fuzzyMatch } from '@/lib/fuzzyMatch';
import { findSearchMatch, matchesSearch, type SearchField } from '@/lib/workspaceSearch';

export type CommandScope = 'Documents' | 'Forms' | 'Templates' | 'Sections' | 'Actions' | 'Settings';
export interface CommandItem {
  id: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  kbd?: string;
  searchFields?: SearchField[];
  onRun: (query: string) => void;
}
export interface CommandGroup {
  label: string;
  scope?: CommandScope;
  items: CommandItem[];
}

export function CommandPalette({ open, onClose, groups, presentation = 'dialog' }: {
  open: boolean;
  onClose: () => void;
  groups: CommandGroup[];
  presentation?: 'dialog' | 'workspace';
}) {
  const workspace = presentation === 'workspace';
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<CommandScope | 'All'>('All');
  const [sel, setSel] = useState(0);
  const [previousFocus] = useState(() => document.activeElement as HTMLElement | null);
  const ran = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const pointerMoved = useRef(false);
  const q = query.trim();
  const ordered = workspace ? [...groups].sort((a, b) => {
    const order = ['Documents', 'Forms', 'Templates', 'Sections', 'Actions', 'Settings'];
    return order.indexOf(a.scope ?? 'Actions') - order.indexOf(b.scope ?? 'Actions');
  }) : groups;
  const filtered = ordered.filter((g) => scope === 'All' || (g.scope ?? 'Actions') === scope).map((group) => {
    const items = group.items.flatMap((item) => {
      const labelMatch = fuzzyMatch(item.label, q);
      const hintMatch = item.hint ? fuzzyMatch(item.hint, q) : null;
      const textMatches = item.searchFields && matchesSearch([item.label, item.hint, ...item.searchFields.map((f) => f.text)].join(' '), q);
      if (!labelMatch && !hintMatch && !textMatches) return [];
      const match = textMatches ? findSearchMatch(item.searchFields!, q) : undefined;
      return [{ item, score: labelMatch?.score ?? hintMatch?.score ?? 0, match, scope: group.scope ?? 'Actions' }];
    });
    if (q) items.sort((a, b) => b.score - a.score);
    return { ...group, items };
  }).filter((g) => g.items.length);
  const flat = filtered.flatMap((g) => g.items);
  const clampedSel = Math.min(sel, Math.max(0, flat.length - 1));
  const selected = flat[clampedSel];
  const selectedFields = selected?.item.searchFields?.filter((field) => field.sectionId !== 'type').slice(0, 5) ?? [];
  const previewSections = new Map<string, { label: string; fields: SearchField[] }>();
  for (const field of selectedFields) {
    const section = previewSections.get(field.sectionId);
    if (section) section.fields.push(field);
    else previewSections.set(field.sectionId, { label: field.label, fields: [field] });
  }
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [clampedSel, query, scope]);
  useEffect(() => {
    if (!workspace || !open) return;
    inputRef.current?.focus();
    return () => { if (!ran.current && previousFocus?.isConnected) previousFocus.focus(); };
  }, [workspace, open, previousFocus]);

  const run = (item?: CommandItem) => {
    if (!item) return;
    ran.current = true;
    // Restore before dispatch: the destination's dialog or section jump owns
    // focus afterward, rather than losing it to search cleanup.
    previousFocus?.focus();
    onClose();
    item.onRun(q);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      pointerMoved.current = false;
      setSel((s) => Math.max(0, Math.min(s + (e.key === 'ArrowDown' ? 1 : -1), flat.length - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(selected?.item);
    }
  };
  const listboxId = 'command-palette-listbox';
  let index = -1;
  const controls = <>
    <div className={cn('flex items-center gap-2.5', workspace ? 'mx-4 sm:mx-7 mt-6 mb-3 rounded-md border border-input bg-card px-3 py-3' : 'border-b border-border px-4 py-3.5 pr-12')}>
      <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
      <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setSel(0); }} onKeyDown={onKey}
        placeholder="Search documents, forms, templates…" aria-label="Command search" role="combobox" aria-expanded={true}
        aria-controls={listboxId} aria-activedescendant={flat.length ? `command-palette-option-${clampedSel}` : undefined}
        aria-autocomplete="list" className="min-w-0 flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground" />
      {query && <button type="button" className="text-xs text-muted-foreground hover:text-foreground min-h-6" onClick={() => { setQuery(''); setSel(0); inputRef.current?.focus(); }}>Clear</button>}
    </div>
    <div className={cn('flex gap-1 overflow-x-auto border-b py-2', workspace ? 'px-4 sm:px-7' : 'px-2')} role="group" aria-label="Search scope">
      {(['All', 'Documents', 'Forms', 'Templates', 'Sections', 'Actions', 'Settings'] as const).map((value) =>
        <button key={value} type="button" aria-pressed={scope === value}
          className={cn('shrink-0 rounded-md px-2.5 min-h-9 text-xs focus-visible:ring-2 focus-visible:ring-ring', scope === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}
          onClick={() => { setScope(value); setSel(0); inputRef.current?.focus(); }}>{value}</button>)}
    </div>
  </>;
  const results = <div id={listboxId} role="listbox" aria-label="Commands" onMouseMove={() => { pointerMoved.current = true; }} className={cn('min-h-0 overflow-y-auto', workspace ? 'flex-1 px-3 sm:px-5 py-3' : 'max-h-[min(55dvh,440px)] p-1.5')}>
    {!flat.length ? <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-3 py-8 text-center">
      <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      {/* Only Documents and Forms can be empty with no query: they list saved work. */}
      {q ? <>
        <p className="text-sm text-muted-foreground">No results for “{query}” in {scope.toLowerCase()}.</p>
        <p className="text-xs text-muted-foreground">Try fewer words or another scope. Deleted drafts are in Trash.</p>
      </> : <>
        <p className="text-sm text-muted-foreground">No saved {scope.toLowerCase()} yet.</p>
        <p className="text-xs text-muted-foreground">{scope} you work on appear here. Deleted drafts are in Trash.</p>
      </>}
    </div> : filtered.map((group) => <div key={group.label} className="mb-3" role="group" aria-label={group.label}>
      <div aria-hidden="true" className="px-2.5 pb-2 pt-2 text-xs font-medium text-muted-foreground">{group.label}</div>
      {group.items.map(({ item, match }) => {
        const row = ++index;
        const active = row === clampedSel;
        const Icon = item.icon;
        return <div key={item.id} id={`command-palette-option-${row}`} ref={active ? activeRef : undefined}
          role="option" aria-selected={active}
          onMouseEnter={() => { if (!workspace && pointerMoved.current) setSel(row); }}
          onClick={() => { if (workspace) { setSel(row); inputRef.current?.focus({ preventScroll: true }); } else run(item); }}
          onDoubleClick={() => { if (workspace) run(item); }}
          className={cn('flex cursor-pointer items-start gap-3 rounded-md px-3 py-3', active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
          <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{item.label}</p>
            {match && <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{match.field.label}: {match.snippet}</p>}
            {item.hint && <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>}
          </div>
          {item.kbd && <Kbd active={active}>{item.kbd}</Kbd>}
        </div>;
      })}
    </div>)}
  </div>;
  const footer = <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 sm:px-7 py-3 text-xs text-muted-foreground">
    <span>↑ ↓ Navigate · Enter Open · Esc Close</span>
    <span role="status" className="tabular-nums">{flat.length} result{flat.length === 1 ? '' : 's'}</span>
  </div>;

  if (workspace) return open && <section id="main-content" aria-label="Search workspace" className="flex flex-1 min-h-0 min-w-0 flex-col bg-background" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 sm:px-7 py-5">
      <div><h1 className="text-lg font-medium tracking-tight">Search workspace</h1><p className="mt-1 text-xs text-muted-foreground">Find saved work or jump to an action.</p></div>
      <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-3.5 w-3.5" />Back to document</button>
    </header>
    {controls}
    <div className="flex flex-1 min-h-0 min-w-0">
      {results}
      <aside aria-label="Selected result" className="hidden md:flex w-[38%] max-w-md min-w-64 flex-col gap-5 overflow-y-auto border-l bg-card px-6 py-6">
        {selected ? <>
          <p className="text-xs text-muted-foreground">Selected result</p>
          <div><h2 className="break-words text-xl font-medium tracking-tight">{selected.item.label}</h2>{selected.item.hint && <p className="mt-2 text-xs text-muted-foreground">{selected.item.hint}</p>}</div>
          <button type="button" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring" onClick={() => run(selected.item)}>Open result<ArrowUpRight className="h-4 w-4" /></button>
          {selected.match ? <div className="border-y py-5"><p className="mb-2 text-xs font-medium text-muted-foreground">Match in {selected.match.field.label}</p><p className="break-words text-sm leading-7">{selected.match.field.text.length > 2000 ? selected.match.snippet : selected.match.field.text}</p></div>
            : previewSections.size > 0 ? <div className="space-y-4 border-y py-5">
              {Array.from(previewSections, ([sectionId, section]) => <div key={sectionId}>
                <h3 className="text-xs font-medium text-muted-foreground">{section.label}</h3>
                {section.fields.map((field, i) => <p key={i} className="mt-1 break-words text-sm leading-6 line-clamp-4">{field.text}</p>)}
              </div>)}
            </div> : <p className="text-sm text-muted-foreground">Open this result to continue in the workspace.</p>}
          {selected.match && <p className="text-xs leading-5 text-muted-foreground">{selected.scope === 'Templates' ? 'Opens template review before applying.' : `Opens directly to ${selected.match.field.label.toLowerCase()}.`}</p>}
        </> : <p className="text-sm text-muted-foreground">Choose a result to inspect it here.</p>}
      </aside>
    </div>
    {selected && <div className="md:hidden flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3"><p className="min-w-0 truncate text-xs">{selected.item.label}</p><button type="button" onClick={() => run(selected.item)} className="min-h-11 shrink-0 rounded-md bg-primary px-4 text-sm text-primary-foreground">Open result</button></div>}
    {footer}
  </section>;

  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent className="gap-0 p-0 overflow-hidden sm:max-w-xl max-h-[85dvh] flex flex-col"
      onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
      onCloseAutoFocus={(e) => { e.preventDefault(); if (!ran.current) previousFocus?.focus(); }}>
      <DialogTitle className="sr-only">Search workspace</DialogTitle>
      <DialogDescription className="sr-only">Search saved documents and forms, templates, sections, actions and settings. Use arrow keys to choose a result and Enter to open it.</DialogDescription>
      {controls}{results}{footer}
    </DialogContent>
  </Dialog>;
}

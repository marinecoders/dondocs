import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Search, SearchX, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { fuzzyMatch } from '@/lib/fuzzyMatch';
import { findSearchMatch, matchesSearch, type SearchField } from '@/lib/workspaceSearch';

export type CommandScope = 'Documents' | 'Templates' | 'Sections' | 'Actions' | 'Settings';
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

export function CommandPalette({ open, onClose, groups }: {
  open: boolean;
  onClose: () => void;
  groups: CommandGroup[];
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<CommandScope | 'All'>('All');
  const [sel, setSel] = useState(0);
  const [previousFocus] = useState(() => document.activeElement as HTMLElement | null);
  const ran = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const pointerMoved = useRef(false);
  const q = query.trim();
  const filtered = groups.filter((g) => scope === 'All' || (g.scope ?? 'Actions') === scope).map((group) => {
    const items = group.items.flatMap((item) => {
      const labelMatch = fuzzyMatch(item.label, q);
      const hintMatch = item.hint ? fuzzyMatch(item.hint, q) : null;
      const textMatches = item.searchFields && matchesSearch([item.label, item.hint, ...item.searchFields.map((f) => f.text)].join(' '), q);
      if (!labelMatch && !hintMatch && !textMatches) return [];
      const match = textMatches ? findSearchMatch(item.searchFields!, q) : undefined;
      return [{ item, score: labelMatch?.score ?? hintMatch?.score ?? 0, match }];
    });
    if (q) items.sort((a, b) => b.score - a.score);
    return { ...group, items };
  }).filter((g) => g.items.length);
  const flat = filtered.flatMap((g) => g.items);
  const clampedSel = Math.min(sel, Math.max(0, flat.length - 1));
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [clampedSel]);

  const run = (item?: CommandItem) => {
    if (!item) return;
    ran.current = true;
    // Restore before dispatch: a newly opened dialog or queued section jump
    // owns focus afterward, instead of losing it to this dialog's cleanup.
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
      run(flat[clampedSel]?.item);
    }
  };
  const listboxId = 'command-palette-listbox';
  let index = -1;
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent
      className="gap-0 p-0 overflow-hidden sm:max-w-xl max-h-[85dvh] flex flex-col"
      onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
      onCloseAutoFocus={(e) => { e.preventDefault(); if (!ran.current) previousFocus?.focus(); }}
    >
      <DialogTitle className="sr-only">Search workspace</DialogTitle>
      <DialogDescription className="sr-only">Search saved documents and forms, templates, sections, actions and settings. Use arrow keys to choose a result and Enter to open it.</DialogDescription>
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 pr-12">
        <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setSel(0); }} onKeyDown={onKey}
          placeholder="Search your workspace…" aria-label="Command search" role="combobox" aria-expanded={true}
          aria-controls={listboxId} aria-activedescendant={flat.length ? `command-palette-option-${clampedSel}` : undefined}
          aria-autocomplete="list" className="min-w-0 flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground" />
      </div>
      <div className="flex gap-1 overflow-x-auto border-b p-2" role="group" aria-label="Search scope">
        {(['All', 'Documents', 'Templates', 'Sections', 'Actions', 'Settings'] as const).map((value) =>
          <button key={value} type="button" aria-pressed={scope === value}
            className={cn('shrink-0 rounded-md px-2.5 min-h-9 text-xs focus-visible:ring-2 focus-visible:ring-ring', scope === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}
            onClick={() => { setScope(value); setSel(0); inputRef.current?.focus(); }}>{value}</button>)}
      </div>
      <div id={listboxId} role="listbox" aria-label="Commands" onMouseMove={() => { pointerMoved.current = true; }} className="min-h-0 max-h-[min(55dvh,440px)] overflow-y-auto p-1.5">
        {!flat.length ? <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-3 py-8 text-center">
          <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No results for “{query}” in {scope.toLowerCase()}.</p>
          <p className="text-xs text-muted-foreground">Try fewer words or another scope. Deleted drafts are in Trash.</p>
        </div> : filtered.map((group) => <div key={group.label} className="mb-1" role="group" aria-label={group.label}>
          <div aria-hidden="true" className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group.label}</div>
          {group.items.map(({ item, match }) => {
            const row = ++index;
            const active = row === clampedSel;
            const Icon = item.icon;
            return <div key={item.id} id={`command-palette-option-${row}`} ref={active ? activeRef : undefined}
              role="option" aria-selected={active} onMouseEnter={() => { if (pointerMoved.current) setSel(row); }} onClick={() => run(item)}
              className={cn('flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2.5', active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
              <Icon className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.label}</p>
                {match && <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{match.field.label}: {match.snippet}</p>}
                {item.hint && <p className="text-xs text-muted-foreground">{item.hint}</p>}
              </div>
              {item.kbd && <Kbd active={active}>{item.kbd}</Kbd>}
            </div>;
          })}
        </div>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>↑ ↓ Navigate · Enter Open · Esc Close</span>
        <span role="status" className="tabular-nums">{flat.length} result{flat.length === 1 ? '' : 's'}</span>
      </div>
    </DialogContent>
  </Dialog>;
}

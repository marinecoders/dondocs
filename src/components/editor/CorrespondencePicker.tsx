import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DOC_TYPE_CATEGORIES, DOC_TYPE_LABELS } from '@/types/document';
import { cn } from '@/lib/utils';

/** Selects the current draft's format; searching never creates or converts a draft. */
export function CorrespondencePicker({ value, onSelect }: {
  value: string;
  onSelect: (type: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const groups = DOC_TYPE_CATEGORIES.map(group => ({
    ...group,
    types: group.types.filter(type => {
      const text = `${DOC_TYPE_LABELS[type]} ${type.replaceAll('_', ' ')} ${group.category}`.toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    }),
  })).filter(group => group.types.length > 0);
  const options = groups.flatMap(group => group.types);
  const active = options[activeIndex];
  const activeId = active ? `${listId}-${active}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  function changeOpen(next: boolean) {
    setOpen(next);
    setQuery('');
    setActiveIndex(-1);
  }

  function pick(type: string) {
    onSelect(type);
    changeOpen(false);
  }

  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" aria-label="Correspondence type" aria-expanded={open} className="w-full justify-between font-normal">
        <span className="truncate">{DOC_TYPE_LABELS[value] ?? 'Select correspondence type'}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="start"
      aria-label="Choose correspondence type"
      className="flex w-[max(18rem,var(--radix-popover-trigger-width))] max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden p-0"
      onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus(); }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          value={query}
          onChange={event => { setQuery(event.target.value); setActiveIndex(-1); }}
          role="combobox"
          aria-label="Search correspondence"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={activeId}
          placeholder="Search by name or abbreviation"
          className="h-11 border-0 bg-transparent px-0 shadow-none dark:bg-transparent focus-visible:ring-0"
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || !options.length) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(event.key === 'ArrowDown'
                ? (activeIndex + 1) % options.length
                : activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              pick(active ?? (options.includes(value) ? value : options[0]));
            }
          }}
        />
      </div>
      <div id={listId} role="listbox" aria-label="Correspondence types" className="min-h-0 max-h-72 overflow-y-auto p-1">
        {groups.map(group => <div key={group.category} role="group" aria-label={group.category}>
          <p className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{group.category}</p>
          {group.types.map(type => <button
            key={type}
            id={`${listId}-${type}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={type === value}
            onMouseMove={() => setActiveIndex(options.indexOf(type))}
            onClick={() => pick(type)}
            className={cn('flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent', active === type && 'bg-accent text-accent-foreground')}
          >
            <Check className={cn('h-4 w-4 shrink-0', type === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">{DOC_TYPE_LABELS[type]}</span>
          </button>)}
        </div>)}
        {options.length === 0 && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">No correspondence types match. Try another name or abbreviation.</p>}
      </div>
    </PopoverContent>
  </Popover>;
}

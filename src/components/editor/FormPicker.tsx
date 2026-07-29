import { useMemo, useRef, useState } from 'react';
import { BadgeCheck, Check, ChevronsUpDown, Search, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { fuzzyMatch } from '@/lib/fuzzyMatch';
import { useFormCatalog, type CatalogForm } from '@/services/formCatalog';
import { useFormStore } from '@/stores/formStore';
import type { FormType } from '@/types/document';

/**
 * Searchable form picker (replaces the flat Form Type dropdown). Type a form
 * number, a title fragment, or Marine vocabulary ("page 11", "6105", "UPB") —
 * matches fuzzily over all three. Results group under Favorites / Recent /
 * category headers, so the list stays navigable as the catalog grows.
 */
export function FormPicker({
  value,
  onSelect,
}: {
  value: FormType;
  onSelect: (formType: FormType) => void;
}) {
  const catalog = useFormCatalog();
  const favorites = useFormStore((s) => s.favoriteForms);
  const recents = useFormStore((s) => s.recentForms);
  const touchRecent = useFormStore((s) => s.touchRecentForm);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const current = catalog.find((f) => f.formType === value);

  const groups = useMemo(() => {
    const matches = (f: CatalogForm) =>
      fuzzyMatch(`${f.name} ${f.keywords.join(' ')}`, query) !== null;
    const hit = catalog.filter(matches);
    const q = query.trim();
    const used = new Set<string>();
    const take = (ids: string[]) =>
      ids
        .map((id) => hit.find((f) => f.formType === id))
        .filter((f): f is CatalogForm => !!f && !used.has(f.formType))
        .map((f) => (used.add(f.formType), f));
    const out: Array<{ label: string; forms: CatalogForm[] }> = [];
    // Hand-checked forms are pinned to the very top — always, even while
    // searching — so a verified form is never buried under robot drafts.
    const verified = take(hit.filter((f) => f.verified).map((f) => f.formType));
    if (verified.length) out.push({ label: 'Hand-checked', forms: verified });
    // Favorites and Recent lead only when not searching; a query flattens to
    // pure relevance grouped by category.
    if (!q) {
      const fav = take(favorites);
      if (fav.length) out.push({ label: 'Favorites', forms: fav });
      const rec = take(recents);
      if (rec.length) out.push({ label: 'Recent', forms: rec });
    }
    const rest = hit.filter((f) => !used.has(f.formType));
    for (const cat of [...new Set(rest.map((f) => f.category))].sort()) {
      out.push({ label: cat, forms: rest.filter((f) => f.category === cat) });
    }
    return out;
  }, [catalog, favorites, recents, query]);

  const pick = (f: CatalogForm) => {
    onSelect(f.formType);
    touchRecent(f.formType);
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setTimeout(() => inputRef.current?.focus(), 0);
        else setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{current ? current.name : 'Select form type'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search forms — try a number, title, or “page 11”"
            aria-label="Search forms"
            className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label="Forms">
          {groups.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No forms match.</p>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.label}
              </p>
              {g.forms.map((f) => (
                <button
                  key={`${g.label}:${f.formType}`}
                  type="button"
                  role="option"
                  aria-selected={f.formType === value}
                  onClick={() => pick(f)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm outline-none',
                    'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent'
                  )}
                >
                  <Check
                    className={cn('h-4 w-4 shrink-0', f.formType === value ? 'opacity-100' : 'opacity-0')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">{f.number}</span> {f.title}
                  </span>
                  {favorites.includes(f.formType) && (
                    <Star className="h-3 w-3 shrink-0 fill-current text-muted-foreground" aria-hidden />
                  )}
                  {f.verified && (
                    <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Hand-checked form" />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

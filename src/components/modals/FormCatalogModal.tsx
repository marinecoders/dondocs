import { useMemo, useState } from 'react';
import { BadgeCheck, Bot, Search, Star, TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { fuzzyMatch } from '@/lib/fuzzyMatch';
import { catalogCategories, useFormCatalog, type CatalogForm } from '@/services/formCatalog';
import { useFormStore } from '@/stores/formStore';
import type { FormType } from '@/types/document';

/** A robot-drafted form whose fields largely don't land where declared — the
 *  fill-smoke measure caught bad box detection. Warn and sink these. */
const isLowQuality = (f: CatalogForm) => f.fieldLanding !== undefined && f.fieldLanding < 50;

/**
 * Browse-all forms catalog: card grid with page-one thumbnails, category
 * filter chips, search (numbers, titles, Marine vocabulary), star favorites,
 * and honesty badges — hand-checked vs prepared automatically. Picking a card
 * selects the form and closes.
 */
export function FormCatalogModal({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (formType: FormType) => void;
}) {
  const catalog = useFormCatalog();
  const favorites = useFormStore((s) => s.favoriteForms);
  const toggleFavorite = useFormStore((s) => s.toggleFavoriteForm);
  const touchRecent = useFormStore((s) => s.touchRecentForm);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = catalogCategories(catalog);
  const shown = useMemo(() => {
    return catalog
      .filter((f) => !category || f.category === category)
      .filter((f) => fuzzyMatch(`${f.name} ${f.keywords.join(' ')}`, query) !== null)
      .sort((a, b) => {
        // Hand-checked forms are pinned to the very top; then favorites; then
        // badly-detected forms sink to the bottom so a working form is always
        // found before a broken one; then alphabetical.
        const verDelta = Number(b.verified) - Number(a.verified);
        if (verDelta) return verDelta;
        const favDelta = Number(favorites.includes(b.formType)) - Number(favorites.includes(a.formType));
        if (favDelta) return favDelta;
        const lowDelta = Number(isLowQuality(a)) - Number(isLowQuality(b));
        return lowDelta || a.title.localeCompare(b.title);
      });
  }, [catalog, category, query, favorites]);

  // The catalog holds 700+ forms; rendering every card (each with a thumbnail)
  // at once janks the modal. Cap the grid and steer to search/filter — the
  // count line tells the user what's hidden.
  const RENDER_CAP = 90;
  const visible = shown.slice(0, RENDER_CAP);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Form catalog</DialogTitle>
          <DialogDescription>
            Every fillable form in DonDocs. Search by number, title, or what Marines call it
            (&ldquo;page 11&rdquo;, &ldquo;6105&rdquo;, &ldquo;UPB&rdquo;).
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md border border-input px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search forms"
            aria-label="Search forms"
            className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
          <Button
            type="button"
            size="sm"
            variant={category === null ? 'default' : 'outline'}
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => setCategory(null)}
          >
            All
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat}
              type="button"
              size="sm"
              variant={category === cat ? 'default' : 'outline'}
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setCategory(category === cat ? null : cat)}
            >
              {cat}
            </Button>
          ))}
        </div>

        <div className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
          {shown.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
              No forms match.
            </p>
          )}
          {visible.map((f) => (
            <div
              key={f.formType}
              className="group relative rounded-lg border border-border bg-card text-left transition-colors hover:border-muted-foreground/40"
            >
              <button
                type="button"
                className="w-full rounded-lg p-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => {
                  onSelect(f.formType);
                  touchRecent(f.formType);
                  onOpenChange(false);
                }}
              >
                {/* Thumbs are ~10KB each; loaded eagerly — lazy loading
                    stalls inside the dialog's scroll container. */}
                {f.directory && (
                  <img
                    src={`/templates/${f.directory}/thumb.png`}
                    alt=""
                    className="mb-2 h-28 w-full rounded border border-border/60 bg-white object-contain object-top"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <p className="text-2xs text-muted-foreground">{f.number}</p>
                <p className="line-clamp-2 text-sm font-medium leading-snug">{f.title}</p>
                <div className="mt-1.5 flex items-center gap-1">
                  {f.verified ? (
                    <Badge variant="outline" className="gap-1 border-success/40 px-1.5 text-2xs text-success">
                      <BadgeCheck className="h-3 w-3" aria-hidden /> Hand-checked
                    </Badge>
                  ) : isLowQuality(f) ? (
                    <Badge variant="outline" className="gap-1 border-destructive/40 px-1.5 text-2xs text-destructive">
                      <TriangleAlert className="h-3 w-3" aria-hidden /> May not fill correctly
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 border-amber-400/60 px-1.5 text-2xs text-amber-600 dark:text-amber-400">
                      <Bot className="h-3 w-3" aria-hidden /> Robot draft
                    </Badge>
                  )}
                </div>
              </button>
              <button
                type="button"
                aria-label={
                  favorites.includes(f.formType)
                    ? `Remove ${f.number} from favorites`
                    : `Add ${f.number} to favorites`
                }
                aria-pressed={favorites.includes(f.formType)}
                onClick={() => toggleFavorite(f.formType)}
                className={cn(
                  'absolute right-1.5 top-1.5 rounded p-1 outline-none transition-colors',
                  'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  favorites.includes(f.formType)
                    ? 'text-amber-500'
                    : 'text-muted-foreground/40 opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
                )}
              >
                <Star className={cn('h-4 w-4', favorites.includes(f.formType) && 'fill-current')} aria-hidden />
              </button>
            </div>
          ))}
          {shown.length > RENDER_CAP && (
            <p className="col-span-full py-3 text-center text-xs text-muted-foreground">
              Showing {RENDER_CAP} of {shown.length} — search or filter to narrow the list.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useMemo, type ReactNode } from 'react';
import { Search, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  formatReference,
  getReferencesByCategory,
  searchReferences,
} from '@/data/references';

interface ReferenceLibraryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the formatted citation string when the user picks a reference. */
  onSelect: (citation: string) => void;
  /** Dialog title (defaults to "Reference Library"). */
  title?: ReactNode;
  /** Optional sub-description under the title. */
  description?: ReactNode;
  /** Optional footer note under the list. */
  footer?: ReactNode;
  /** Show a live "N results found" line under the search box. */
  showResultCount?: boolean;
  /** Autofocus the search box on open. */
  autoFocus?: boolean;
}

/**
 * Shared reference-library picker used by both ReferenceLibraryModal (top bar,
 * general docs) and FormReferenceLibraryModal (counseling forms). Both consume
 * the single `src/data/references.ts` dataset with keyword-aware search — no
 * more duplicated inline arrays. The small copy differences (title icon,
 * footer, result count, autofocus) are props.
 */
export function ReferenceLibraryPicker({
  open,
  onOpenChange,
  onSelect,
  title = 'Reference Library',
  description,
  footer,
  showResultCount = false,
  autoFocus = false,
}: ReferenceLibraryPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const { grouped, total } = useMemo(() => {
    const matches = searchReferences(searchQuery);
    return { grouped: getReferencesByCategory(matches), total: matches.length };
  }, [searchQuery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search references…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            autoFocus={autoFocus}
          />
        </div>

        {showResultCount && (
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? `${total} result${total === 1 ? '' : 's'} found`
              : 'Browse or search common references for counseling and administrative actions'}
          </p>
        )}

        <ScrollArea className="h-[400px] pr-4">
          {Object.entries(grouped).map(([category, refs]) => (
            <div key={category} className="mb-4">
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">{category}</h4>
              <div className="space-y-1">
                {refs.map((ref) => {
                  const citation = formatReference(ref);
                  return (
                    <div
                      key={ref.id}
                      className="flex items-center justify-between p-2 rounded-md hover:bg-secondary/50 focus-within:bg-secondary/50 group"
                    >
                      <span className="text-sm">{citation}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onSelect(citation)}
                        // Hidden-until-hover on pointer devices, but always shown on
                        // touch (no hover) and revealed on keyboard focus, so the
                        // action is reachable by every input method.
                        className="opacity-0 [@media(hover:none)]:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {total === 0 && (
            <div className="text-center text-muted-foreground py-8">
              No references found matching "{searchQuery}"
            </div>
          )}
        </ScrollArea>

        {footer && (
          <div className="text-xs text-muted-foreground border-t pt-3">{footer}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

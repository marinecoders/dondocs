import { useState, useMemo, useEffect } from 'react';
import { Search, X, BookOpen, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { loadSsicCategories, type SSICCategory, type SSICCode } from '@/data/ssicCodes';

interface SSICLookupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (code: string) => void;
}

// The full set is 2,240 codes; a broad search ("1") matches hundreds. Cap what
// renders so the list stays responsive, and tell the user when there's more.
const MAX_SEARCH_RESULTS = 100;

export function SSICLookupModal({ open, onOpenChange, onSelect }: SSICLookupModalProps) {
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<SSICCategory[]>([]);

  // ssic.json is dynamically imported to keep it out of the main bundle, so
  // pull it in when the modal opens. The loader caches, so reopening is free.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadSsicCategories().then((loaded) => {
      if (!cancelled) setCategories(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const { filteredCategories, totalMatches } = useMemo(() => {
    if (!search.trim()) {
      return { filteredCategories: categories, totalMatches: 0 };
    }

    const searchLower = search.toLowerCase();
    const matched = categories
      .map((category) => ({
        ...category,
        codes: category.codes.filter(
          (code) =>
            code.code.includes(search) ||
            code.title.toLowerCase().includes(searchLower) ||
            code.description?.toLowerCase().includes(searchLower)
        ),
      }))
      .filter((category) => category.codes.length > 0);

    const total = matched.reduce((acc, c) => acc + c.codes.length, 0);

    // Trim across categories in order, so the cap never hides a whole group's
    // worth of results behind an earlier group.
    let remaining = MAX_SEARCH_RESULTS;
    const capped = matched.flatMap((category) => {
      if (remaining <= 0) return [];
      const codes = category.codes.slice(0, remaining);
      remaining -= codes.length;
      return [{ ...category, codes }];
    });

    return { filteredCategories: capped, totalMatches: total };
  }, [search, categories]);

  // Searching must reveal its own hits — an accordion collapsed over a match is
  // indistinguishable from no match at all. Remounting on the matched set (the
  // `key` below) re-applies defaultValue, so groups auto-open while searching
  // while the accordion stays uncontrolled for ordinary browsing.
  const matchedRanges = search.trim() ? filteredCategories.map((c) => c.range).join('|') : '';

  const handleSelect = (code: SSICCode) => {
    onSelect(code.code);
    onOpenChange(false);
    setSearch('');
  };

  const shown = filteredCategories.reduce((acc, cat) => acc + cat.codes.length, 0);
  const loading = categories.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            SSIC Code Reference
          </DialogTitle>
          <DialogDescription>Standard Subject Identification Codes</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by code or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9"
            autoFocus
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setSearch('')}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          {!search && 'Browse or search SSIC codes'}
          {search && totalMatches > shown && `Showing ${shown} of ${totalMatches} results — refine your search`}
          {search && totalMatches <= shown && `${totalMatches} result${totalMatches === 1 ? '' : 's'} found`}
        </p>

        <ScrollArea className="h-[400px] pr-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading SSIC codes…</span>
            </div>
          )}
          <Accordion
            key={matchedRanges || 'browse'}
            type="multiple"
            className="w-full"
            defaultValue={matchedRanges ? matchedRanges.split('|') : []}
          >
            {filteredCategories.map((category) => (
              <AccordionItem key={category.range} value={category.range}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-muted-foreground">{category.range}</span>
                    <span>{category.name}</span>
                    <span className="text-xs text-muted-foreground">({category.codes.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1 pl-4">
                    {category.codes.map((code) => (
                      <button
                        key={code.code}
                        onClick={() => handleSelect(code)}
                        className="w-full text-left p-2 rounded-md hover:bg-accent transition-colors flex items-start gap-3 group"
                      >
                        <span className="font-mono text-sm font-medium text-primary min-w-[50px]">
                          {code.code}
                        </span>
                        <div className="flex-1">
                          <span className="font-medium group-hover:text-primary transition-colors">
                            {code.title}
                          </span>
                          {code.description && (
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {code.description}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {filteredCategories.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No SSIC codes found matching "{search}"</p>
              <p className="text-sm mt-1">Try a different search term</p>
            </div>
          )}
        </ScrollArea>

        <div className="text-xs text-muted-foreground border-t pt-3">
          Reference: SECNAV M-5210.2 (Department of the Navy Standard Subject Identification Codes)
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useMemo } from 'react';
import { Search, X, Briefcase } from 'lucide-react';
import {
  Dialog,
  DialogContent,
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
import { getOfficeCodesByCategory, type OfficeCode } from '@/data/officeCodes';

interface OfficeCodeLookupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (code: string) => void;
}

export function OfficeCodeLookupModal({ open, onOpenChange, onSelect }: OfficeCodeLookupModalProps) {
  const [search, setSearch] = useState('');

  const categories = useMemo(() => getOfficeCodesByCategory(), []);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;

    const searchLower = search.toLowerCase();
    return categories.map((category) => ({
      ...category,
      codes: category.codes.filter(
        (code) =>
          code.code.toLowerCase().includes(searchLower) ||
          code.title.toLowerCase().includes(searchLower) ||
          code.description?.toLowerCase().includes(searchLower)
      ),
    })).filter((category) => category.codes.length > 0);
  }, [search, categories]);

  const handleSelect = (code: OfficeCode) => {
    onSelect(code.code);
    onOpenChange(false);
    setSearch('');
  };

  const totalResults = filteredCategories.reduce((acc, cat) => acc + cat.codes.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Office Code Reference
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by code or description..."
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
          {search ? `${totalResults} results found` : 'Browse or search Office codes'}
        </p>

        <ScrollArea className="h-[400px] pr-4">
          <Accordion type="multiple" className="w-full" defaultValue={search ? filteredCategories.map((c) => c.name) : []}>
            {filteredCategories.map((category) => (
              <AccordionItem key={category.name} value={category.name}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3">
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
                        <span className="font-mono text-sm font-medium text-primary min-w-[60px]">
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
              <Briefcase className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No office codes found matching "{search}"</p>
              <p className="text-sm mt-1">Try a different search term</p>
            </div>
          )}
        </ScrollArea>

        <div className="text-xs text-muted-foreground border-t pt-3">
          Reference: SECNAV M-5216.5 (Standard Naval Correspondence Office Codes)
        </div>
      </DialogContent>
    </Dialog>
  );
}

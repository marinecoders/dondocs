import { useState, useMemo } from 'react';
import { Search, X, Building2, MapPin } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { UNIT_CATEGORIES, ALL_UNITS, formatUnitAddress, UNIT_DATABASE_INFO, type UnitInfo } from '@/data/unitDirectory';

interface UnitLookupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (unit: UnitInfo) => void;
}

export function UnitLookupModal({ open, onOpenChange, onSelect }: UnitLookupModalProps) {
  const [search, setSearch] = useState('');

  // For searches, search all units; for browsing, use categories
  const filteredResults = useMemo(() => {
    if (!search.trim()) {
      return { mode: 'categories' as const, categories: UNIT_CATEGORIES };
    }

    const searchLower = search.toLowerCase();
    const matchedUnits = ALL_UNITS.filter(
      (unit) =>
        unit.name.toLowerCase().includes(searchLower) ||
        unit.abbrev?.toLowerCase().includes(searchLower) ||
        unit.parentUnit?.toLowerCase().includes(searchLower) ||
        unit.mcc?.includes(search) ||
        unit.address.toLowerCase().includes(searchLower) ||
        unit.city?.toLowerCase().includes(searchLower) ||
        unit.state?.toLowerCase().includes(searchLower) ||
        unit.type?.toLowerCase().includes(searchLower) ||
        unit.service?.toLowerCase().includes(searchLower)
    );

    return { mode: 'search' as const, units: matchedUnits };
  }, [search]);

  const handleSelect = (unit: UnitInfo) => {
    onSelect(unit);
    onOpenChange(false);
    setSearch('');
  };

  const totalResults = filteredResults.mode === 'search'
    ? filteredResults.units.length
    : UNIT_CATEGORIES.reduce((acc, cat) => acc + cat.units.length, 0);

  const serviceColors: Record<string, string> = {
    'USMC': 'bg-red-500/10 text-red-600',
    'USN': 'bg-blue-500/10 text-blue-500',
    'USCG': 'bg-orange-500/10 text-orange-500',
    'DOD': 'bg-purple-500/10 text-purple-500',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Unit Directory
            <Badge variant="outline" className="ml-2 text-xs font-normal">
              {UNIT_DATABASE_INFO.totalUnits.toLocaleString()} units
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by unit name, abbreviation, MCC, or location..."
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
          {search
            ? `${totalResults.toLocaleString()} units found`
            : 'Browse or search military units'}
        </p>

        <ScrollArea className="h-[450px] pr-4">
          {filteredResults.mode === 'search' ? (
            // Search results - flat list
            <div className="space-y-2">
              {filteredResults.units.slice(0, 100).map((unit, idx) => (
                <UnitCard
                  key={`${unit.name}-${idx}`}
                  unit={unit}
                  onSelect={handleSelect}
                  serviceColors={serviceColors}
                />
              ))}
              {filteredResults.units.length > 100 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  Showing first 100 of {filteredResults.units.length} results. Refine your search for more specific results.
                </p>
              )}
              {filteredResults.units.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No units found matching "{search}"</p>
                  <p className="text-sm mt-1">Try a different search term</p>
                </div>
              )}
            </div>
          ) : (
            // Category browsing - accordion
            <Accordion type="multiple" className="w-full">
              {filteredResults.categories.map((category) => (
                <AccordionItem key={category.name} value={category.name}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{category.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({category.units.length.toLocaleString()})
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 pl-2">
                      {category.units.slice(0, 50).map((unit, idx) => (
                        <UnitCard
                          key={`${unit.name}-${idx}`}
                          unit={unit}
                          onSelect={handleSelect}
                          serviceColors={serviceColors}
                          compact
                        />
                      ))}
                      {category.units.length > 50 && (
                        <p className="text-xs text-muted-foreground text-center py-2">
                          Showing first 50. Use search to find specific units.
                        </p>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </ScrollArea>

        <div className="text-xs text-muted-foreground border-t pt-3 flex justify-between">
          <span>Click a unit to populate letterhead information</span>
          <span>v{UNIT_DATABASE_INFO.version} • {UNIT_DATABASE_INFO.lastUpdated}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Unit card component
function UnitCard({
  unit,
  onSelect,
  serviceColors,
  compact = false,
}: {
  unit: UnitInfo;
  onSelect: (unit: UnitInfo) => void;
  serviceColors: Record<string, string>;
  compact?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(unit)}
      className={`w-full text-left p-3 rounded-lg border hover:border-primary hover:bg-accent/50 transition-colors ${
        compact ? 'p-2' : 'p-3'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {unit.abbrev && (
              <span className="font-semibold text-primary">{unit.abbrev}</span>
            )}
            {unit.service && (
              <Badge variant="secondary" className={`text-xs ${serviceColors[unit.service] || ''}`}>
                {unit.service}
              </Badge>
            )}
            {unit.mcc && (
              <span className="text-xs text-muted-foreground">MCC: {unit.mcc}</span>
            )}
          </div>
          <p className={`text-foreground truncate ${compact ? 'text-sm' : 'text-sm mt-1'}`}>
            {unit.name}
          </p>
          {unit.parentUnit && (
            <p className="text-xs text-muted-foreground truncate">
              {unit.parentUnit}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{formatUnitAddress(unit)}</span>
      </div>
    </button>
  );
}

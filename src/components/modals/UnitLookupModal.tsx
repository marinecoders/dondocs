import { useState, useMemo } from 'react';
import { Search, X, Building2, MapPin, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLookupData } from '@/hooks/useLookupData';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  formatUnitAddress,
  loadUnitDirectory,
  type UnitInfo,
} from '@/data/unitDirectory';

interface UnitLookupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (unit: UnitInfo) => void;
}

export function UnitLookupModal({ open, onOpenChange, onSelect }: UnitLookupModalProps) {
  const [search, setSearch] = useState('');
  const lookup = useLookupData(open, loadUnitDirectory);
  const { data: database, status, retry } = lookup;

  // For searches, search all units; for browsing, use categories. Both
  // require the database to be loaded.
  const filteredResults = useMemo(() => {
    if (!database) return null;

    if (!search.trim()) {
      return { mode: 'categories' as const, categories: database.UNIT_CATEGORIES };
    }

    const searchLower = search.toLowerCase();
    const matchedUnits = database.ALL_UNITS.filter(
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
  }, [search, database]);

  const handleSelect = (unit: UnitInfo) => {
    onSelect(unit);
    onOpenChange(false);
    setSearch('');
  };

  const totalResults = filteredResults?.mode === 'search'
    ? filteredResults.units.length
    : database?.UNIT_CATEGORIES.reduce((acc, cat) => acc + cat.units.length, 0) ?? 0;

  const serviceColors: Record<string, string> = {
    'USMC': 'bg-red-500/10 text-red-600',
    'USN': 'bg-blue-500/10 text-blue-500',
    'USCG': 'bg-orange-500/10 text-orange-500',
    'DOD': 'bg-purple-500/10 text-purple-500',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[85dvh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-10 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Building2 className="h-5 w-5" />
            Unit Directory
            {database ? (
              <Badge variant="outline" className="ml-2 text-xs font-normal">
                {database.UNIT_DATABASE_INFO.totalUnits.toLocaleString()} units
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-2 text-xs font-normal">
                {status === 'error' ? 'Unavailable' : 'Loading…'}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Search the unit directory and insert a unit&apos;s name and address.
          </DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search unit directory"
            placeholder="Search by unit name, abbreviation, MCC, or location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9"
            autoFocus
            disabled={!database}
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              aria-label="Clear search"
              onClick={() => setSearch('')}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          {status === 'error' ? 'Unit directory unavailable' : !database
            ? 'Loading unit directory…'
            : search
              ? `${totalResults.toLocaleString()} units found`
              : 'Browse or search military units'}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto pr-2">
          {status === 'error' ? (
            <div role="alert" className="text-center py-8">
              <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Failed to load unit directory</p>
              <p className="text-sm mt-1 text-muted-foreground">Check your connection and try again.</p>
              <Button variant="outline" className="mt-3" onClick={retry}>Try again</Button>
              {lookup.status === 'error' && <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Technical details</summary>
                <p className="mt-2 break-words">{lookup.error}</p>
              </details>}
            </div>
          ) : !filteredResults ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span className="text-sm">Loading {`< 1 MB of unit data`}…</span>
            </div>
          ) : filteredResults.mode === 'search' ? (
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
            <Accordion staticLayout={false} type="multiple" className="w-full">
              {filteredResults.categories.map((category) => (
                <AccordionItem key={category.name} value={category.name} className="rounded-none border-0 border-b bg-transparent px-0 shadow-none backdrop-blur-none">
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
        </div>

        <div className="shrink-0 text-xs text-muted-foreground border-t pt-3 flex flex-wrap gap-2 justify-between">
          <span>Click a unit to populate letterhead information</span>
          {database && (
            <span>v{database.UNIT_DATABASE_INFO.version} • {database.UNIT_DATABASE_INFO.lastUpdated}</span>
          )}
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

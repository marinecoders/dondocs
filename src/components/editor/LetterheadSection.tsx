import { useState, useEffect, useRef } from 'react';
import { Building2, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useDocumentStore } from '@/stores/documentStore';
import { UnitLookupModal } from '@/components/modals/UnitLookupModal';
import { formatLetterhead, type UnitInfo } from '@/data/unitDirectory';
import { DOC_TYPE_CONFIG } from '@/types/document';
import {
  parseUnitAddress,
  composeUnitAddress,
  type UnitAddressParts,
} from '@/lib/unitAddress';

export function LetterheadSection() {
  const { formData, setField, docType, documentMode } = useDocumentStore();
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;
  const isCompliant = documentMode === 'compliant';
  const isOptional = isCompliant && config.optionalLetterhead;
  const isDisabled = !config.letterhead;

  // Structured address fields are local UI state, kept in sync with
  // `formData.unitAddress` (the persisted single-line representation).
  // Two sync directions:
  //
  //   formData → local: when unitAddress changes for a reason OTHER than
  //     our own write (unit-directory pick, profile load, fresh session
  //     with a default), re-parse the string into the structured shape.
  //
  //   local → formData: any user edit recomposes the parts back into a
  //     single string and writes it via setField.
  //
  // The `lastWriteRef` marker lets us distinguish "we just wrote this"
  // from "something external wrote this" so we don't overwrite the
  // user's mid-typing partial state with a re-parse of our own
  // composition (which would lose the partial state mid-edit).
  const [addressParts, setAddressParts] = useState<UnitAddressParts>(() =>
    parseUnitAddress(formData.unitAddress || '')
  );
  const lastWriteRef = useRef<string | null>(null);

  useEffect(() => {
    const current = formData.unitAddress || '';
    if (current === lastWriteRef.current) {
      // This is the round-trip echo of our own write. The local state
      // is already what we wanted; ignore.
      return;
    }
    // Legitimate "synchronize React state with an external system"
    // pattern (per the react-hooks/set-state-in-effect rule docs):
    // the external system here is the documentStore's unitAddress
    // string. When something else writes to that string (unit
    // directory pick, profile load, restore-session) we mirror the
    // change into local structured-fields state. Suppressed for the
    // same reason as the analogous patterns in useServiceWorker.ts
    // and the PR #59 sweep.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAddressParts(parseUnitAddress(current));
    lastWriteRef.current = null;
  }, [formData.unitAddress]);

  const updateAddressPart = (key: keyof UnitAddressParts, value: string) => {
    const next = { ...addressParts, [key]: value };
    setAddressParts(next);
    const composed = composeUnitAddress(next);
    lastWriteRef.current = composed;
    setField('unitAddress', composed);
  };

  const handleUnitSelect = (unit: UnitInfo) => {
    // Use SECNAV M-5216.5 compliant letterhead formatting
    const letterhead = formatLetterhead(unit);
    // Line 1: Unit name (expanded abbreviations)
    setField('unitLine1', letterhead.line1);
    // Line 2: Parent/higher command (e.g., "1ST MARINE DIVISION")
    setField('unitLine2', letterhead.line2);
    // Line 3: Address
    setField('unitAddress', letterhead.address);
  };

  return (
    <>
      <UnitLookupModal
        open={unitModalOpen}
        onOpenChange={setUnitModalOpen}
        onSelect={handleUnitSelect}
      />

      <Accordion type="single" collapsible defaultValue={isDisabled ? undefined : 'letterhead'}>
        <AccordionItem value="letterhead">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              <span className={isDisabled ? 'text-muted-foreground' : ''}>Letterhead</span>
              {isOptional && (
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              )}
              {isDisabled && (
                <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <Info className="h-3 w-3" />
                  Not used by this document type
                </span>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className={`space-y-4 pt-2 ${isDisabled ? 'opacity-50 pointer-events-none select-none' : ''}`}>
              {/* Seal Type + Color + Department/Service + Browse Units - responsive layout */}
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-3">
                  <div className="space-y-2 sm:w-28">
                    <Label>Seal</Label>
                    <Select
                      value={formData.sealType || 'dow'}
                      onValueChange={(v) => setField('sealType', v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dod">DoD</SelectItem>
                        <SelectItem value="dow">DoW</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 sm:w-28">
                    <Label>Color</Label>
                    <Select
                      value={formData.letterheadColor || 'blue'}
                      onValueChange={(v) => setField('letterheadColor', v as 'blue' | 'black')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blue">Blue</SelectItem>
                        <SelectItem value="black">Black</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2 flex-1 hidden sm:block">
                  <Label>Department / Service</Label>
                  <Select
                    value={formData.department || 'usmc'}
                    onValueChange={(v) => setField('department', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="usmc">United States Marine Corps</SelectItem>
                      <SelectItem value="navy">Department of the Navy</SelectItem>
                      <SelectItem value="dod">Department of Defense</SelectItem>
                      <SelectItem value="dow">Department of War</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Mobile-only Department selector */}
                <div className="space-y-2 sm:hidden">
                  <Label>Department</Label>
                  <Select
                    value={formData.department || 'usmc'}
                    onValueChange={(v) => setField('department', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="usmc">USMC</SelectItem>
                      <SelectItem value="navy">Navy</SelectItem>
                      <SelectItem value="dod">DoD</SelectItem>
                      <SelectItem value="dow">DoW</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={() => setUnitModalOpen(true)}
                  className="gap-2 w-full sm:w-auto"
                >
                  <Building2 className="h-4 w-4" />
                  Browse Units
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="unitLine1">Unit Name</Label>
                <Input
                  id="unitLine1"
                  value={formData.unitLine1 || ''}
                  onChange={(e) => setField('unitLine1', e.target.value)}
                  placeholder="e.g., HEADQUARTERS UNITED STATES MARINE CORPS"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="unitLine2">Unit Name (Line 2, if needed)</Label>
                <Input
                  id="unitLine2"
                  value={formData.unitLine2 || ''}
                  onChange={(e) => setField('unitLine2', e.target.value)}
                  placeholder="Only for very long unit names"
                />
              </div>

              <div className="space-y-2">
                <Label>Address</Label>
                <p className="text-xs text-muted-foreground">
                  Per SECNAV M-5216.5 letterhead format. Street/Box is
                  optional; City, State, and ZIP appear together on the
                  next line.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                  <div className="sm:col-span-6 space-y-1">
                    <Label
                      htmlFor="addressStreet"
                      className="text-xs font-normal text-muted-foreground"
                    >
                      Street / Box <span className="italic">(optional)</span>
                    </Label>
                    <Input
                      id="addressStreet"
                      value={addressParts.street}
                      onChange={(e) => updateAddressPart('street', e.target.value)}
                      placeholder="e.g., PSC BOX 8050"
                    />
                  </div>

                  <div className="sm:col-span-4 space-y-1">
                    <Label
                      htmlFor="addressCity"
                      className="text-xs font-normal text-muted-foreground"
                    >
                      City
                    </Label>
                    <Input
                      id="addressCity"
                      value={addressParts.city}
                      onChange={(e) => updateAddressPart('city', e.target.value)}
                      placeholder="e.g., CHERRY POINT"
                    />
                  </div>

                  <div className="sm:col-span-1 space-y-1">
                    <Label
                      htmlFor="addressState"
                      className="text-xs font-normal text-muted-foreground"
                    >
                      State
                    </Label>
                    <Input
                      id="addressState"
                      value={addressParts.state}
                      onChange={(e) =>
                        // Auto-uppercase + cap at 2 characters so users
                        // can't type "Cal" or "north carolina"
                        updateAddressPart(
                          'state',
                          e.target.value.toUpperCase().slice(0, 2)
                        )
                      }
                      placeholder="NC"
                      maxLength={2}
                      className="uppercase"
                    />
                  </div>

                  <div className="sm:col-span-1 space-y-1">
                    <Label
                      htmlFor="addressZip"
                      className="text-xs font-normal text-muted-foreground"
                    >
                      ZIP
                    </Label>
                    <Input
                      id="addressZip"
                      value={addressParts.zip}
                      onChange={(e) => updateAddressPart('zip', e.target.value)}
                      placeholder="28533-0050"
                    />
                  </div>
                </div>
              </div>
            </div>
          </AccordionContent>
      </AccordionItem>
    </Accordion>
    </>
  );
}

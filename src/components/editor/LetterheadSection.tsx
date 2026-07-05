import { useState, useEffect, useRef } from 'react';
import { Building2, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { HelpTip } from '@/components/ui/help-tip';
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
import { useUIStore } from '@/stores/uiStore';
import { unfilled } from '@/lib/requiredField';
import { UnitLookupModal } from '@/components/modals/UnitLookupModal';
import { formatLetterhead, type UnitInfo } from '@/data/unitDirectory';
import { DOC_TYPE_CONFIG } from '@/types/document';
import {
  parseUnitAddress,
  composeUnitAddress,
  canonicalizeUnitAddress,
  type UnitAddressParts,
} from '@/lib/unitAddress';

export function LetterheadSection() {
  const { formData, setField, docType, documentMode } = useDocumentStore();
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;
  const isCompliant = documentMode === 'compliant';
  const isOptional = isCompliant && config.optionalLetterhead;
  const isDisabled = !config.letterhead;
  const validationVisible = useUIStore((s) => s.validationVisible);
  // Mirror getSectionError('letterhead'): only a required (non-optional)
  // letterhead flags a missing unit name.
  const unitNameRequired = config.letterhead === true && !config.optionalLetterhead;
  const unitNameInvalid = validationVisible && unitNameRequired && unfilled(formData.unitLine1);

  // Structured address fields mirror formData.unitAddress (the persisted
  // single-line form). User edits recompose into the string; external writes
  // (directory pick, profile load) re-parse back into the fields. lastWriteRef
  // distinguishes our own write from an external one so a re-parse doesn't clobber
  // the user's mid-edit partial state.
  const [addressParts, setAddressParts] = useState<UnitAddressParts>(() =>
    parseUnitAddress(formData.unitAddress || '')
  );
  const lastWriteRef = useRef<string | null>(null);

  useEffect(() => {
    const current = formData.unitAddress || '';
    if (current === lastWriteRef.current) {
      // Round-trip echo of our own write; local state already matches.
      return;
    }
    // External write (directory pick, profile load, restore-session): mirror it
    // into the structured fields. The echo guard above means no same-value
    // setState here.
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
    const letterhead = formatLetterhead(unit);
    setField('unitLine1', letterhead.line1);
    setField('unitLine2', letterhead.line2);
    // canonicalizeUnitAddress adds the missing city/state comma for civilian
    // addresses (and preserves the no-comma FPO/APO/DPO form per USPS Pub 28
    // §38) so the address splits across letterhead lines correctly.
    const canonicalAddress = canonicalizeUnitAddress(letterhead.address);
    // Clear the own-write marker so the sync effect re-parses even if the
    // canonical address happens to match the last composed value.
    lastWriteRef.current = null;
    setField('unitAddress', canonicalAddress);
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
              <HelpTip>
                <p className="font-medium mb-1">Letterhead</p>
                <p className="text-xs">
                  Unit name, address, seal, and color. Some document types (MFR, plain paper) don&apos;t use letterhead.
                </p>
              </HelpTip>
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
              <p className="-mt-1 text-xs text-muted-foreground">
                Unit name, address, seal, and color that appear at the top of the page.
              </p>
              {/* Responsive row: the editor column width is independent of the
                  viewport (collapsible sidebar + resizable preview), so flex-wrap
                  lets it wrap rather than overflow at a narrow column. */}
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
                {/* Seal + Color wrap as one unit; sm:basis-52 drives the line
                    break and min-w-0 lets the cells shrink rather than overflow. */}
                <div className="grid grid-cols-2 gap-3 min-w-0 sm:basis-52 sm:grow-0 sm:shrink">
                  <div className="space-y-2 min-w-0">
                    <Label className="flex items-center gap-1.5">
                      Seal
                      <HelpTip>
                        <p className="text-xs">
                          Which seal prints on the letterhead. <strong>DoW</strong> is the
                          Department of War seal (the current default); <strong>DoD</strong>
                          {' '}is the older Department of Defense seal. Picking the wrong one
                          produces an officially incorrect document.
                        </p>
                      </HelpTip>
                    </Label>
                    <Select
                      value={formData.sealType || 'dow'}
                      onValueChange={(v) => setField('sealType', v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dod">DoD</SelectItem>
                        <SelectItem value="dow">DoW</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 min-w-0">
                    <Label>Color</Label>
                    <Select
                      value={formData.letterheadColor || 'blue'}
                      onValueChange={(v) => setField('letterheadColor', v as 'blue' | 'black')}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blue">
                          <span className="flex items-center gap-2">
                            <span className="h-3 w-3 shrink-0 rounded-full border border-border bg-[#00205B]" aria-hidden="true" />
                            Blue
                          </span>
                        </SelectItem>
                        <SelectItem value="black">
                          <span className="flex items-center gap-2">
                            <span className="h-3 w-3 shrink-0 rounded-full border border-border bg-black" aria-hidden="true" />
                            Black
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Department grows to fill the row and wraps below seal/color at a
                    narrow column. sm:basis-48 gives the wrap a real width (basis-0
                    let Browse Units overflow); min-w-0 truncates the value. */}
                <div className="space-y-2 min-w-0 hidden sm:block sm:grow sm:basis-48">
                  <Label>Department / Service</Label>
                  <Select
                    value={formData.department || 'usmc'}
                    onValueChange={(v) => setField('department', v)}
                  >
                    <SelectTrigger className="w-full">
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
                <div className="space-y-2 min-w-0 sm:hidden">
                  <Label>Department</Label>
                  <Select
                    value={formData.department || 'usmc'}
                    onValueChange={(v) => setField('department', v)}
                  >
                    <SelectTrigger className="w-full">
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
                  className="gap-2 w-full sm:w-auto shrink-0"
                >
                  <Building2 className="h-4 w-4" />
                  Browse Units
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="unitLine1">
                  Unit Name{unitNameRequired && <span className="text-destructive"> *</span>}
                </Label>
                <Input
                  id="unitLine1"
                  value={formData.unitLine1 || ''}
                  onChange={(e) => setField('unitLine1', e.target.value)}
                  aria-invalid={unitNameInvalid ? true : undefined}
                  aria-describedby={unitNameInvalid ? 'unitLine1-error' : undefined}
                  placeholder="e.g., HEADQUARTERS UNITED STATES MARINE CORPS"
                />
                {unitNameInvalid && (
                  <p id="unitLine1-error" role="alert" className="text-xs text-destructive">
                    Unit name is required.
                  </p>
                )}
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
                        // Uppercase + cap at 2 chars for the state abbreviation.
                        updateAddressPart(
                          'state',
                          e.target.value.toUpperCase().slice(0, 2)
                        )
                      }
                      placeholder="NC"
                      maxLength={2}
                      className="uppercase"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
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
                      // Keep only digits and the ZIP+4 hyphen, capped at 10 chars
                      // ("#####-####"); `pattern` alone never fires without a
                      // native submit, which this form doesn't do.
                      onChange={(e) => updateAddressPart('zip', e.target.value.replace(/[^0-9-]/g, '').slice(0, 10))}
                      placeholder="28533-0050"
                      maxLength={10}
                      inputMode="numeric"
                      pattern="[0-9-]*"
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

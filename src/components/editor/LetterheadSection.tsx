import { useState } from 'react';
import { Building2 } from 'lucide-react';
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

export function LetterheadSection() {
  const { formData, setField } = useDocumentStore();
  const [unitModalOpen, setUnitModalOpen] = useState(false);

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

      <Accordion type="single" collapsible defaultValue="letterhead">
        <AccordionItem value="letterhead">
          <AccordionTrigger>Letterhead</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* Seal Type + Color + Department/Service + Browse Units - responsive layout */}
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-3">
                  <div className="space-y-2 sm:w-28">
                    <Label>Seal</Label>
                    <Select
                      value={formData.sealType || 'dod'}
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
                <Label htmlFor="unitAddress">Address</Label>
                <Input
                  id="unitAddress"
                  value={formData.unitAddress || ''}
                  onChange={(e) => setField('unitAddress', e.target.value)}
                  placeholder="e.g., 3000 MARINE CORPS PENTAGON, WASHINGTON DC 20350"
                />
              </div>
            </div>
          </AccordionContent>
      </AccordionItem>
    </Accordion>
    </>
  );
}

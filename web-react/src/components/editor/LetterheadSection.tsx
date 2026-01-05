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
import { formatUnitAddress, type UnitInfo } from '@/data/unitDirectory';

export function LetterheadSection() {
  const { formData, setField } = useDocumentStore();
  const [unitModalOpen, setUnitModalOpen] = useState(false);

  const handleUnitSelect = (unit: UnitInfo) => {
    // Use full name for line 1
    setField('unitLine1', unit.name);
    // Use abbreviation for line 2 if available
    setField('unitLine2', unit.abbrev || '');
    // Format the full address (replaces newlines with comma-space)
    setField('unitAddress', unit.address.replace(/\n/g, ', '));
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
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setUnitModalOpen(true)}
                  className="gap-2"
                >
                  <Building2 className="h-4 w-4" />
                  Browse Units
                </Button>
              </div>

              <div className="space-y-2">
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
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="unitLine1">Command Name (Line 1)</Label>
                <Input
                  id="unitLine1"
                  value={formData.unitLine1 || ''}
                  onChange={(e) => setField('unitLine1', e.target.value)}
                  placeholder="e.g., 1ST BATTALION, 6TH MARINES"
                />
              </div>

            <div className="space-y-2">
              <Label htmlFor="unitLine2">Command Name (Line 2)</Label>
              <Input
                id="unitLine2"
                value={formData.unitLine2 || ''}
                onChange={(e) => setField('unitLine2', e.target.value)}
                placeholder="e.g., 6TH MARINE REGIMENT"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unitAddress">Address</Label>
              <Input
                id="unitAddress"
                value={formData.unitAddress || ''}
                onChange={(e) => setField('unitAddress', e.target.value)}
                placeholder="e.g., PSC BOX 20123, CAMP LEJEUNE, NC 28542"
              />
            </div>

            <div className="space-y-2">
              <Label>Seal Type</Label>
              <Select
                value={formData.sealType || 'dod'}
                onValueChange={(v) => setField('sealType', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dod">Department of Defense</SelectItem>
                  <SelectItem value="dow">Department of War</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
    </>
  );
}

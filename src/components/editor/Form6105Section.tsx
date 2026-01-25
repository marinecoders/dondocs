import { useState } from 'react';
import { ClipboardList, RotateCcw, ChevronDown, Trash2, FileText } from 'lucide-react';
import { BookOpen, Building2, Library } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { InputWithVariables, TextareaWithVariables } from '@/components/ui/variable-autocomplete';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';
import { useFormStore } from '@/stores/formStore';
import { SSICLookupModal } from '@/components/modals/SSICLookupModal';
import { UnitLookupModal } from '@/components/modals/UnitLookupModal';
import { FormReferenceLibraryModal } from '@/components/modals/FormReferenceLibraryModal';
import { NAVMC_10274_PLACEHOLDERS } from '@/lib/constants';
import type { UnitInfo } from '@/data/unitDirectory';

// Common variables to show first in autocomplete
const COMMON_FORM_VARS = ['LAST_NAME', 'FIRST_NAME', 'NAME', 'EDIPI', 'RANK', 'DATE'];

export function Form6105Section() {
  const { navmc10274, setNavmc10274Field, resetNavmc10274, clearNavmc10274, includeCoverPage, setIncludeCoverPage } = useFormStore();

  // Modal states
  const [ssicModalOpen, setSSICModalOpen] = useState(false);
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [referenceModalOpen, setReferenceModalOpen] = useState(false);

  const handleSSICSelect = (code: string) => {
    setNavmc10274Field('ssicFileNo', code);
  };

  const handleUnitSelect = (unit: UnitInfo) => {
    // Format unit info for the Organization/Station field
    const unitText = [
      unit.name,
      unit.address,
    ].filter(Boolean).join('\n');
    setNavmc10274Field('orgStation', unitText);
  };

  const handleReferenceSelect = (reference: string) => {
    // Add reference to existing references with proper lettering
    const currentRefs = navmc10274.references.trim();
    if (!currentRefs) {
      setNavmc10274Field('references', `(a) ${reference}`);
    } else {
      // Count existing references to determine next letter
      const refLines = currentRefs.split('\n').filter(line => line.trim());
      const nextLetter = String.fromCharCode(97 + refLines.length); // a=97, b=98, etc.
      setNavmc10274Field('references', `${currentRefs}\n(${nextLetter}) ${reference}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="h-5 w-5" />
          NAVMC 10274 - Administrative Action
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={resetNavmc10274}>
                <FileText className="h-4 w-4 mr-2" />
                Reset to Example
              </DropdownMenuItem>
              <DropdownMenuItem onClick={clearNavmc10274}>
                <Trash2 className="h-4 w-4 mr-2" />
                Clear All Fields
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Administrative Action Form per MCO 5216.19A. Used for counseling, requests, and other administrative actions.
      </p>

      {/* Variable hint banner */}
      <div className="px-3 py-2.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm">
        <div className="flex items-start gap-2">
          <span className="text-blue-600 dark:text-blue-400 text-lg leading-none mt-0.5">@</span>
          <div className="flex-1">
            <p className="font-medium text-blue-700 dark:text-blue-300">Variables for Batch Documents</p>
            <p className="text-blue-600 dark:text-blue-400 text-xs mt-0.5">
              Type <code className="bg-blue-100 dark:bg-blue-900 px-1 py-0.5 rounded font-mono">@</code> followed by any name (e.g., <code className="bg-blue-100 dark:bg-blue-900 px-1 py-0.5 rounded font-mono">@NAME</code>, <code className="bg-blue-100 dark:bg-blue-900 px-1 py-0.5 rounded font-mono">@CUSTOM</code>) to create variables.
              Once created, they'll auto-suggest throughout the document.
            </p>
          </div>
        </div>
      </div>

      {/* Options */}
      <div className="flex items-center gap-2 px-1">
        <Checkbox
          id="includeCoverPage"
          checked={includeCoverPage}
          onCheckedChange={(checked) => setIncludeCoverPage(checked === true)}
        />
        <Label htmlFor="includeCoverPage" className="text-sm cursor-pointer">
          Include Privacy Act cover page
        </Label>
      </div>

      <Accordion type="multiple" defaultValue={['header', 'addressing', 'content']} className="space-y-2">
        {/* Header Section */}
        <AccordionItem value="header" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Header Information</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="actionNo">1. Action No.</Label>
                <Input
                  id="actionNo"
                  value={navmc10274.actionNo}
                  onChange={(e) => setNavmc10274Field('actionNo', e.target.value)}
                  placeholder="e.g., 001-25"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ssicFileNo">2. SSIC/File No.</Label>
                <div className="flex gap-1">
                  <Input
                    id="ssicFileNo"
                    value={navmc10274.ssicFileNo}
                    onChange={(e) => setNavmc10274Field('ssicFileNo', e.target.value)}
                    placeholder="e.g., 1610"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setSSICModalOpen(true)}
                    title="Browse SSIC Codes"
                  >
                    <BookOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">3. Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={navmc10274.date}
                  onChange={(e) => setNavmc10274Field('date', e.target.value)}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Addressing Section */}
        <AccordionItem value="addressing" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Addressing</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="from">4. From (Grade, Name, EDIPI, MOS, etc.)</Label>
                <TextareaWithVariables
                  id="from"
                  value={navmc10274.from}
                  onValueChange={(v) => setNavmc10274Field('from', v)}
                  placeholder="Originator name and title (type @ for variables)"
                  rows={2}
                  placeholders={NAVMC_10274_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="orgStation">5. Organization/Station</Label>
                <div className="flex gap-1">
                  <TextareaWithVariables
                    id="orgStation"
                    value={navmc10274.orgStation}
                    onValueChange={(v) => setNavmc10274Field('orgStation', v)}
                    placeholder="Unit and location (type @ for variables)"
                    rows={2}
                    className="flex-1"
                    placeholders={NAVMC_10274_PLACEHOLDERS}
                    commonVariables={COMMON_FORM_VARS}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setUnitModalOpen(true)}
                    title="Browse Unit Directory"
                    className="h-auto self-stretch"
                  >
                    <Building2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="via">6. Via (As required)</Label>
              <InputWithVariables
                id="via"
                value={navmc10274.via}
                onValueChange={(v) => setNavmc10274Field('via', v)}
                placeholder="Chain of command (type @ for variables)"
                placeholders={NAVMC_10274_PLACEHOLDERS}
                commonVariables={COMMON_FORM_VARS}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="to">7. To</Label>
              <TextareaWithVariables
                id="to"
                value={navmc10274.to}
                onValueChange={(v) => setNavmc10274Field('to', v)}
                placeholder="Marine's full name, rank, and MOS (type @ for variables)"
                rows={2}
                placeholders={NAVMC_10274_PLACEHOLDERS}
                commonVariables={COMMON_FORM_VARS}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Content Section */}
        <AccordionItem value="content" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Counseling Content</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="natureOfAction">8. Nature of Action/Subject</Label>
              <TextareaWithVariables
                id="natureOfAction"
                value={navmc10274.natureOfAction}
                onValueChange={(v) => setNavmc10274Field('natureOfAction', v)}
                placeholder="Brief description (type @ for variables)"
                rows={2}
                placeholders={NAVMC_10274_PLACEHOLDERS}
                commonVariables={COMMON_FORM_VARS}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplementalInfo">12. Supplemental Information</Label>
              <VariableChipEditor
                value={navmc10274.supplementalInfo}
                onChange={(v) => setNavmc10274Field('supplementalInfo', v)}
                placeholder="Full counseling statement (type @ or click + for variables)..."
                rows={12}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="proposedAction">13. Proposed/Recommended Action</Label>
              <VariableChipEditor
                value={navmc10274.proposedAction}
                onChange={(v) => setNavmc10274Field('proposedAction', v)}
                placeholder="e.g., 'Request entry of adverse Page 11 (6105) entry per MCO 1610.7A' (type @ or click + for variables)"
                rows={3}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* References Section */}
        <AccordionItem value="references" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">References & Distribution</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="references">10. References/Authority</Label>
              <div className="flex gap-1">
                <TextareaWithVariables
                  id="references"
                  value={navmc10274.references}
                  onValueChange={(v) => setNavmc10274Field('references', v)}
                  placeholder="e.g., MCO 1610.7A, MCO 1070.12K (type @ for variables)"
                  rows={2}
                  className="flex-1"
                  placeholders={NAVMC_10274_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setReferenceModalOpen(true)}
                  title="Browse Reference Library"
                  className="h-auto self-stretch"
                >
                  <Library className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="enclosures">11. Enclosures (if any)</Label>
              <InputWithVariables
                id="enclosures"
                value={navmc10274.enclosures}
                onValueChange={(v) => setNavmc10274Field('enclosures', v)}
                placeholder="e.g., (1) Previous counseling dated... (type @ for variables)"
                placeholders={NAVMC_10274_PLACEHOLDERS}
                commonVariables={COMMON_FORM_VARS}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="copyTo">9. Copy To (As required)</Label>
              <InputWithVariables
                id="copyTo"
                value={navmc10274.copyTo}
                onValueChange={(v) => setNavmc10274Field('copyTo', v)}
                placeholder="e.g., Marine's SRB, Company Office (type @ for variables)"
                placeholders={NAVMC_10274_PLACEHOLDERS}
                commonVariables={COMMON_FORM_VARS}
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Info box */}
      <div className="border rounded-md p-3 text-xs bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
        <div className="text-amber-700 dark:text-amber-400 font-medium mb-1">
          FOR OFFICIAL USE ONLY - Privacy Sensitive
        </div>
        <p className="text-amber-600 dark:text-amber-500">
          Any misuse or unauthorized disclosure can result in both civil and criminal penalties.
        </p>
      </div>

      {/* Modals */}
      <SSICLookupModal
        open={ssicModalOpen}
        onOpenChange={setSSICModalOpen}
        onSelect={handleSSICSelect}
      />

      <UnitLookupModal
        open={unitModalOpen}
        onOpenChange={setUnitModalOpen}
        onSelect={handleUnitSelect}
      />

      <FormReferenceLibraryModal
        open={referenceModalOpen}
        onOpenChange={setReferenceModalOpen}
        onSelect={handleReferenceSelect}
      />
    </div>
  );
}

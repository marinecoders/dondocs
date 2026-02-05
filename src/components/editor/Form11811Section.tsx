import { ClipboardList, RotateCcw, ChevronDown, Trash2, FileText } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
import { InputWithVariables } from '@/components/ui/variable-autocomplete';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';
import { useFormStore } from '@/stores/formStore';
import { NAVMC_118_11_PLACEHOLDERS } from '@/lib/constants';

// Common variables to show first in autocomplete
const COMMON_FORM_VARS = ['LAST_NAME', 'FIRST_NAME', 'NAME', 'EDIPI', 'ENTRY_DATE'];

export function Form11811Section() {
  const { navmc11811, setNavmc11811Field, resetNavmc11811, clearNavmc11811 } = useFormStore();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="h-5 w-5" />
          NAVMC 118(11) - Administrative Remarks
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
              <DropdownMenuItem onClick={resetNavmc11811}>
                <FileText className="h-4 w-4 mr-2" />
                Reset to Example
              </DropdownMenuItem>
              <DropdownMenuItem onClick={clearNavmc11811}>
                <Trash2 className="h-4 w-4 mr-2" />
                Clear All Fields
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Page 11 Entry (6105 Counseling) per MCO 1610.7A. Used for documenting formal counseling,
        adverse administrative remarks, and other official entries.
      </p>

      <Accordion type="multiple" defaultValue={['marine', 'content']} className="space-y-2">
        {/* Marine Identification */}
        <AccordionItem value="marine" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Marine Identification</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <InputWithVariables
                  id="lastName"
                  value={navmc11811.lastName}
                  onValueChange={(v) => setNavmc11811Field('lastName', v)}
                  placeholder="DOE (type @ for variables)"
                  placeholders={NAVMC_118_11_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <InputWithVariables
                  id="firstName"
                  value={navmc11811.firstName}
                  onValueChange={(v) => setNavmc11811Field('firstName', v)}
                  placeholder="JOHN (type @ for variables)"
                  placeholders={NAVMC_118_11_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="middleName">Middle Name</Label>
                <InputWithVariables
                  id="middleName"
                  value={navmc11811.middleName}
                  onValueChange={(v) => setNavmc11811Field('middleName', v)}
                  placeholder="ADAM (type @ for variables)"
                  placeholders={NAVMC_118_11_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edipi">EDIPI</Label>
                <InputWithVariables
                  id="edipi"
                  value={navmc11811.edipi}
                  onValueChange={(v) => setNavmc11811Field('edipi', v)}
                  placeholder="1234567890 (type @ for variables)"
                  maxLength={10}
                  placeholders={NAVMC_118_11_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entryDate">Entry Date</Label>
                <Input
                  id="entryDate"
                  type="date"
                  value={navmc11811.entryDate}
                  onChange={(e) => setNavmc11811Field('entryDate', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="box11">SRB Pg #</Label>
                <InputWithVariables
                  id="box11"
                  value={navmc11811.box11}
                  onValueChange={(v) => setNavmc11811Field('box11', v)}
                  placeholder="Page # (type @)"
                  maxLength={5}
                  placeholders={NAVMC_118_11_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Entry Content */}
        <AccordionItem value="content" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">6105 Entry Content</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="remarksText">Administrative Remarks (Left)</Label>
                <VariableChipEditor
                  value={navmc11811.remarksText}
                  onChange={(v) => setNavmc11811Field('remarksText', v)}
                  placeholder="Type @ or click + for variables. Example: On {{ENTRY_DATE}}, {{NAME}} [describe the incident]..."
                  rows={16}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="remarksTextRight">Administrative Remarks (Right)</Label>
                <VariableChipEditor
                  value={navmc11811.remarksTextRight || ''}
                  onChange={(v) => setNavmc11811Field('remarksTextRight', v)}
                  placeholder="[Continuation or additional entry...] (type @ or click + for variables)"
                  rows={16}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Include: incident description, date/location, standards violated, prior counseling (if any),
              expected corrective actions, and consequences of continued deficiency.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Info box */}
      <div className="border rounded-md p-3 text-xs bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
        <div className="text-amber-700 dark:text-amber-400 font-medium mb-1">
          FOUO - Privacy Sensitive When Filled In
        </div>
        <p className="text-amber-600 dark:text-amber-500">
          This form contains personally identifiable information (PII) and is For Official Use Only. 
          Ensure proper handling and storage per DoD Privacy Act guidelines.
        </p>
      </div>
    </div>
  );
}

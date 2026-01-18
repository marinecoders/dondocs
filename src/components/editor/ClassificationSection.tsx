import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Shield } from 'lucide-react';

const CLASSIFICATION_LEVELS = [
  { value: 'unclassified', label: 'Unclassified', color: 'text-green-600' },
  { value: 'cui', label: 'CUI (Controlled Unclassified Information)', color: 'text-purple-600' },
];

const CUI_CATEGORIES = [
  'Privacy',
  'Proprietary Business Information',
  'Legal',
  'Law Enforcement',
  'Export Control',
  'Financial',
  'Intelligence',
  'Critical Infrastructure',
  'Defense',
  'Other',
];

const DISTRIBUTION_STATEMENTS = [
  { value: 'A', label: 'A - Approved for public release' },
  { value: 'B', label: 'B - U.S. Government agencies only' },
  { value: 'C', label: 'C - U.S. Government agencies and contractors' },
  { value: 'D', label: 'D - DoD and U.S. DoD contractors only' },
  { value: 'E', label: 'E - DoD components only' },
  { value: 'F', label: 'F - Further dissemination only as directed' },
];

export function ClassificationSection() {
  const { formData, setField } = useDocumentStore();
  const classLevel = formData.classLevel || 'unclassified';

  const currentLevel = CLASSIFICATION_LEVELS.find((l) => l.value === classLevel);
  const isCUI = classLevel === 'cui';

  return (
    <Accordion type="single" collapsible defaultValue="classification">
      <AccordionItem value="classification">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Classification
            {classLevel !== 'unclassified' && (
              <span className={`text-xs font-medium ${currentLevel?.color}`}>
                ({currentLevel?.label})
              </span>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2">
            {/* Classification Level */}
            <div className="space-y-2">
              <Label htmlFor="classLevel">Classification Level</Label>
              <Select
                value={classLevel}
                onValueChange={(v) => setField('classLevel', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLASSIFICATION_LEVELS.map((level) => (
                    <SelectItem key={level.value} value={level.value}>
                      <span className={level.color}>{level.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* CUI Fields */}
            {isCUI && (
              <div className="space-y-4 p-3 rounded-md border bg-muted/30">
                <p className="text-sm font-medium text-purple-600">CUI Configuration</p>

                <div className="space-y-2">
                  <Label htmlFor="cuiControlledBy">Controlled By</Label>
                  <Input
                    id="cuiControlledBy"
                    value={formData.cuiControlledBy || ''}
                    onChange={(e) => setField('cuiControlledBy', e.target.value)}
                    placeholder="e.g., DoD"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cuiCategory">CUI Category</Label>
                  <Select
                    value={formData.cuiCategory || ''}
                    onValueChange={(v) => setField('cuiCategory', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CUI_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cuiDissemination">Dissemination Controls</Label>
                  <Input
                    id="cuiDissemination"
                    value={formData.cuiDissemination || ''}
                    onChange={(e) => setField('cuiDissemination', e.target.value)}
                    placeholder="e.g., NOFORN, REL TO USA, FVEY"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cuiDistStatement">Distribution Statement</Label>
                  <Select
                    value={formData.cuiDistStatement || ''}
                    onValueChange={(v) => setField('cuiDistStatement', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select statement..." />
                    </SelectTrigger>
                    <SelectContent>
                      {DISTRIBUTION_STATEMENTS.map((stmt) => (
                        <SelectItem key={stmt.value} value={stmt.value}>{stmt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

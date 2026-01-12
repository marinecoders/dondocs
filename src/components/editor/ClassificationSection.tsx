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
import { Shield, AlertTriangle } from 'lucide-react';

const CLASSIFICATION_LEVELS = [
  { value: 'unclassified', label: 'Unclassified', color: 'text-green-600' },
  { value: 'cui', label: 'CUI (Controlled Unclassified Information)', color: 'text-purple-600' },
  { value: 'confidential', label: 'CONFIDENTIAL', color: 'text-blue-600' },
  { value: 'secret', label: 'SECRET', color: 'text-red-600' },
  { value: 'top_secret', label: 'TOP SECRET', color: 'text-orange-600' },
  { value: 'top_secret_sci', label: 'TOP SECRET//SCI', color: 'text-orange-700' },
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
  const isClassified = ['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(classLevel);
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

            {/* Warning for classified documents */}
            {isClassified && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="text-sm text-destructive">
                  <p className="font-medium">Classified Document Warning</p>
                  <p className="text-xs mt-1">
                    This document will contain classified markings. Ensure proper handling
                    procedures are followed per applicable security regulations.
                  </p>
                </div>
              </div>
            )}

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

            {/* Classified Document Fields */}
            {isClassified && (
              <div className="space-y-4 p-3 rounded-md border bg-muted/30">
                <p className="text-sm font-medium text-red-600">Classification Details</p>

                <div className="space-y-2">
                  <Label htmlFor="classifiedBy">Classified By</Label>
                  <Input
                    id="classifiedBy"
                    value={formData.classifiedBy || ''}
                    onChange={(e) => setField('classifiedBy', e.target.value)}
                    placeholder="Name of original classification authority"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="derivedFrom">Derived From</Label>
                  <Input
                    id="derivedFrom"
                    value={formData.derivedFrom || ''}
                    onChange={(e) => setField('derivedFrom', e.target.value)}
                    placeholder="Source document or classification guide"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="declassifyOn">Declassify On</Label>
                  <Input
                    id="declassifyOn"
                    value={formData.declassifyOn || ''}
                    onChange={(e) => setField('declassifyOn', e.target.value)}
                    placeholder="e.g., 20351231 or 25X1"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="classReason">Reason for Classification</Label>
                  <Input
                    id="classReason"
                    value={formData.classReason || ''}
                    onChange={(e) => setField('classReason', e.target.value)}
                    placeholder="e.g., 1.4(a), 1.4(c)"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="classifiedPocEmail">Classification POC Email</Label>
                  <Input
                    id="classifiedPocEmail"
                    type="email"
                    value={formData.classifiedPocEmail || ''}
                    onChange={(e) => setField('classifiedPocEmail', e.target.value)}
                    placeholder="security.officer@usmc.mil"
                  />
                </div>
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

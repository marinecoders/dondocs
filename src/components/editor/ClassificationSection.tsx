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
import { Shield, AlertTriangle, Info } from 'lucide-react';
import { 
  getDomainClassificationRestriction, 
  getDomainRestrictionMessage,
  isClassificationAllowed,
  type ClassificationLevel 
} from '@/lib/domainClassification';
import { useEffect, useState } from 'react';
import { getClassificationConfig } from '@/config/classification';

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
  const [configOverride, setConfigOverride] = useState<{ restriction?: any; message?: string } | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Load config file override if available (async)
  useEffect(() => {
    getClassificationConfig().then((config) => {
      if (config) {
        setConfigOverride({
          restriction: {
            maxLevel: config.maxLevel,
            allowedLevels: config.allowedLevels,
          },
          message: config.overrideMessage,
        });
      }
      setConfigLoaded(true);
    });
  }, []);

  // Get domain-based restrictions (will use config override if available)
  const domainRestriction = configOverride?.restriction || getDomainClassificationRestriction();
  const restrictionMessage = configOverride?.message || getDomainRestrictionMessage();

  // Filter available classification levels based on domain
  const allowedLevels = CLASSIFICATION_LEVELS.filter((level) =>
    domainRestriction.allowedLevels.includes(level.value as ClassificationLevel)
  );

  // Check if current selection is allowed (custom is always allowed)
  const isCurrentLevelAllowed = classLevel === 'custom' ||
    domainRestriction.allowedLevels.includes(classLevel as ClassificationLevel);

  // If current level is not allowed, reset to highest allowed level
  // Wait for config to load first to avoid race condition
  useEffect(() => {
    if (!configLoaded) return;
    if (!isCurrentLevelAllowed && classLevel !== 'unclassified' && classLevel !== 'custom') {
      const highestAllowed = domainRestriction.allowedLevels[domainRestriction.allowedLevels.length - 1];
      setField('classLevel', highestAllowed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, isCurrentLevelAllowed, classLevel]);

  const currentLevel = CLASSIFICATION_LEVELS.find((l) => l.value === classLevel);
  const isClassified = ['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(classLevel);
  // Show CUI fields if classLevel is 'cui' OR if custom classification contains 'CUI'
  const isCUI = classLevel === 'cui' ||
    (classLevel === 'custom' && formData.customClassification?.toUpperCase().includes('CUI'));
  const isCustom = classLevel === 'custom';

  return (
    <Accordion type="single" collapsible defaultValue="classification">
      <AccordionItem value="classification">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Classification
            {classLevel !== 'unclassified' && (
              <span className={`text-xs font-medium ${classLevel === 'custom' ? 'text-gray-600' : currentLevel?.color}`}>
                ({classLevel === 'custom' ? 'Custom' : currentLevel?.label})
              </span>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2">
            {/* Domain Restriction Info */}
            <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-800 dark:text-blue-300">
                <p className="font-medium">Domain Restrictions</p>
                <p className="text-xs mt-1">{restrictionMessage}</p>
              </div>
            </div>

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
                  {allowedLevels.map((level) => (
                    <SelectItem key={level.value} value={level.value}>
                      <span className={level.color}>{level.label}</span>
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">
                    <span className="text-gray-600">Custom Classification</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom Classification Field */}
            {isCustom && (
              <div className="space-y-2">
                <Label htmlFor="customClassification">Custom Classification</Label>
                <Input
                  id="customClassification"
                  value={formData.customClassification || ''}
                  onChange={(e) => setField('customClassification', e.target.value)}
                  placeholder="e.g., FOR OFFICIAL USE ONLY, LIMITED DISTRIBUTION"
                />
                <p className="text-xs text-muted-foreground">
                  Enter a custom classification marking that will appear in the document header and footer.
                </p>
              </div>
            )}

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

          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

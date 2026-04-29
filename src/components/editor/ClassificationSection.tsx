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
import { Shield, AlertTriangle, Info, HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  getDomainClassificationRestriction,
  getDomainRestrictionMessage,
  type ClassificationLevel,
  type ClassificationRestriction,
} from '@/lib/domainClassification';
import { useEffect, useState } from 'react';
import { getClassificationConfig } from '@/config/classification';

/**
 * Official CNSI / ISOO marking colors per:
 *   - Executive Order 13526
 *   - 32 CFR Part 2001 §2001.23 / Part 2002.16
 *   - DoDM 5200.01 / DoDI 5200.48
 *   - CAPCO Register (ODNI Authorized Classification and Control Markings)
 *   - ISOO Implementing Directive (Classification Banner Color Codes)
 *
 * These are the canonical banner / portion-mark colors used on
 * classified national-security and CUI documents — applying them to
 * the in-app classification picker keeps the UI palette aligned with
 * what the rendered PDF banner will actually show on a marked
 * document. Hex codes match the dodcui.mil / ISOO published table:
 *
 *   UNCLASSIFIED       (U)        #007A33   green
 *   CUI                            #502B85   purple
 *   CONFIDENTIAL       (C)        #0033A0   blue
 *   SECRET             (S)        #C8102E   red
 *   TOP SECRET         (TS)       #FF8C00   orange
 *   TOP SECRET//SCI    (TS//SCI)  #FCE83A   yellow
 *
 * Note: per dodcui.mil, CUI is NOT a CNSI classification level — the
 * banner color is shared with CNSI markings only as a shorthand for
 * ISOO display purposes. CUI handling is governed by 32 CFR Part 2002.
 */
const CLASSIFICATION_LEVELS = [
  { value: 'unclassified', label: 'Unclassified', color: 'text-[#007A33] dark:text-[#3DBE6B]' },
  { value: 'cui', label: 'CUI (Controlled Unclassified Information)', color: 'text-[#502B85] dark:text-[#9572D4]' },
  { value: 'confidential', label: 'CONFIDENTIAL', color: 'text-[#0033A0] dark:text-[#5B7FD9]' },
  { value: 'secret', label: 'SECRET', color: 'text-[#C8102E] dark:text-[#E74C5C]' },
  { value: 'top_secret', label: 'TOP SECRET', color: 'text-[#FF8C00] dark:text-[#FFA940]' },
  // TS//SCI's official banner color is bright yellow #FCE83A, but yellow
  // text on white has very low contrast (~1.5:1, well below WCAG AA).
  // CAPCO banners use yellow as a BACKGROUND with black text — for our
  // text-mode picker we use a darker yellow/amber that's readable on
  // light backgrounds while still cueing the SCI banner's hue family.
  // The bright #FCE83A is restored where the color is used as a fill or
  // background tint (Shield icon fill at 20% opacity, preset button
  // background) — see the Shield style and CLASSIFICATION_PRESETS.
  { value: 'top_secret_sci', label: 'TOP SECRET//SCI', color: 'text-[#A8920E] dark:text-[#FCE83A]' },
];

/**
 * Quick-fill marking presets shown in the Custom Classification block.
 *
 * Each preset is a one-click shortcut that populates the
 * `customClassification` field with a standard marking string.
 * Background tint, border, and text color all use the official CNSI /
 * ISOO color codes (see CLASSIFICATION_LEVELS above for citations) so
 * the buttons read as miniature versions of the actual document
 * banner. Tailwind's `/N` opacity modifier produces the soft fill
 * (`/10` light theme, `/20` dark theme) without sacrificing contrast.
 *
 * For TOP SECRET//SCI specifically, CAPCO banners use yellow #FCE83A
 * as a BACKGROUND with BLACK text — replicated here.
 */
const CLASSIFICATION_PRESETS = [
  { value: 'UNCLASSIFIED',    label: 'Unclassified',    color: 'text-[#007A33] dark:text-[#3DBE6B]', bg: 'bg-[#007A33]/10 dark:bg-[#007A33]/20 border-[#007A33]/30 hover:bg-[#007A33]/20 dark:hover:bg-[#007A33]/30' },
  { value: 'CUI',             label: 'CUI',             color: 'text-[#502B85] dark:text-[#9572D4]', bg: 'bg-[#502B85]/10 dark:bg-[#502B85]/20 border-[#502B85]/30 hover:bg-[#502B85]/20 dark:hover:bg-[#502B85]/30' },
  { value: 'CONFIDENTIAL',    label: 'CONFIDENTIAL',    color: 'text-[#0033A0] dark:text-[#5B7FD9]', bg: 'bg-[#0033A0]/10 dark:bg-[#0033A0]/20 border-[#0033A0]/30 hover:bg-[#0033A0]/20 dark:hover:bg-[#0033A0]/30' },
  { value: 'SECRET',          label: 'SECRET',          color: 'text-[#C8102E] dark:text-[#E74C5C]', bg: 'bg-[#C8102E]/10 dark:bg-[#C8102E]/20 border-[#C8102E]/30 hover:bg-[#C8102E]/20 dark:hover:bg-[#C8102E]/30' },
  { value: 'TOP SECRET',      label: 'TOP SECRET',      color: 'text-[#FF8C00] dark:text-[#FFA940]', bg: 'bg-[#FF8C00]/10 dark:bg-[#FF8C00]/20 border-[#FF8C00]/30 hover:bg-[#FF8C00]/20 dark:hover:bg-[#FF8C00]/30' },
  // TS//SCI: CAPCO standard is yellow background with black text.
  { value: 'TOP SECRET//SCI', label: 'TOP SECRET//SCI', color: 'text-black dark:text-black', bg: 'bg-[#FCE83A] border-[#A8920E] hover:bg-[#FCE83A]/80 dark:bg-[#FCE83A] dark:hover:bg-[#FCE83A]/80' },
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
  const [configOverride, setConfigOverride] = useState<{ restriction?: ClassificationRestriction; message?: string } | null>(null);
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

  // Show classified warning/fields only for actual classified levels (not custom)
  const isClassified = ['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(classLevel);

  // Show CUI fields only for actual CUI level (not custom)
  const isCUI = classLevel === 'cui';

  const isCustom = classLevel === 'custom';

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="classification">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <Shield
              className={`h-4 w-4 ${classLevel === 'custom' ? 'text-gray-600' : currentLevel?.color || 'text-foreground'}`}
              style={{ fill: 'currentColor', fillOpacity: 0.2 }}
            />
            Classification
            <span className={`text-xs font-medium ${classLevel === 'custom' ? 'text-gray-600' : currentLevel?.color}`}>
              ({classLevel === 'custom' ? 'Custom' : currentLevel?.label})
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="font-medium mb-1">Classification Markings</p>
                  <p className="text-xs">
                    Set the security classification level for this document. Markings appear in the header and footer of every page per DoD 5200.01.
                  </p>
                  <ul className="text-xs mt-2 space-y-1 list-disc list-inside">
                    <li><strong>CUI:</strong> Adds controlled-by, category, and dissemination fields</li>
                    <li><strong>Classified:</strong> Adds classified-by, derived-from, reason, and declassify-on fields</li>
                    <li><strong>Portion marks:</strong> Set per-paragraph markings in the body editor</li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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

            {/* Custom Classification — single block containing the marking
                text plus every CUI and Classified field. Custom mode is the
                only entry point on non-government domains where the
                classified-level dropdown options are filtered out
                (`src/lib/domainClassification.ts`), so all marking-related
                inputs need to be reachable from one place here. */}
            {isCustom && (
              <div className="space-y-4 p-3 rounded-md border bg-muted/30">
                <p className="text-sm font-medium">Custom Classification</p>

                <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div className="text-sm text-amber-800 dark:text-amber-300">
                    <p className="font-medium">Classification handling — non-accredited system</p>
                    <p className="text-xs mt-1">
                      Per DoDM 5200.01 Vol 3 and EO 13526, classified
                      information (CONFIDENTIAL, SECRET, TOP SECRET, TS//SCI)
                      may only be processed on information systems accredited
                      for the corresponding classification level. Personal
                      computers and public-internet domains are not accredited
                      — that is why those options are absent from the
                      Classification Level dropdown above.
                    </p>
                    <p className="text-xs mt-2">
                      Use Custom Classification for non-standard, unclassified
                      markings (e.g., FOR OFFICIAL USE ONLY, LIMITED
                      DISTRIBUTION) or to format unclassified drafts that will
                      later be marked on accredited systems. Do not enter
                      classified content into this browser-based tool. You
                      remain responsible for proper handling per applicable
                      security regulations.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customClassification">Custom Classification Marking</Label>
                  <Input
                    id="customClassification"
                    value={formData.customClassification || ''}
                    onChange={(e) => setField('customClassification', e.target.value)}
                    placeholder="e.g., FOR OFFICIAL USE ONLY, LIMITED DISTRIBUTION"
                  />
                  <p className="text-xs text-muted-foreground">
                    Appears in the document header and footer. Fill any of the
                    fields below if your custom marking needs them; leave blank
                    otherwise.
                  </p>
                  <div className="pt-1">
                    <p className="text-xs text-muted-foreground mb-1.5">Quick fill (click to apply):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CLASSIFICATION_PRESETS.map((preset) => {
                        const active = formData.customClassification === preset.value;
                        return (
                          <button
                            key={preset.value}
                            type="button"
                            onClick={() => setField('customClassification', preset.value)}
                            className={`px-2 py-0.5 text-xs font-medium rounded-md border transition-colors ${preset.color} ${preset.bg} ${active ? 'ring-2 ring-offset-1 ring-offset-background ring-current' : ''}`}
                            title={`Set marking to "${preset.value}"`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customCuiControlledBy">Controlled By</Label>
                  <Input
                    id="customCuiControlledBy"
                    value={formData.cuiControlledBy || ''}
                    onChange={(e) => setField('cuiControlledBy', e.target.value)}
                    placeholder="e.g., DoD"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customCuiCategory">CUI Category</Label>
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
                  <Label htmlFor="customCuiDissemination">Dissemination Controls</Label>
                  <Input
                    id="customCuiDissemination"
                    value={formData.cuiDissemination || ''}
                    onChange={(e) => setField('cuiDissemination', e.target.value)}
                    placeholder="e.g., NOFORN, REL TO USA, FVEY"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customCuiDistStatement">Distribution Statement</Label>
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

                <div className="space-y-2">
                  <Label htmlFor="customClassifiedBy">Classified By</Label>
                  <Input
                    id="customClassifiedBy"
                    value={formData.classifiedBy || ''}
                    onChange={(e) => setField('classifiedBy', e.target.value)}
                    placeholder="e.g., John A. Smith, OCA"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customDerivedFrom">Derived From</Label>
                  <Input
                    id="customDerivedFrom"
                    value={formData.derivedFrom || ''}
                    onChange={(e) => setField('derivedFrom', e.target.value)}
                    placeholder="e.g., SECNAVINST 5510.36"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customClassReason">Reason</Label>
                  <Input
                    id="customClassReason"
                    value={formData.classReason || ''}
                    onChange={(e) => setField('classReason', e.target.value)}
                    placeholder="e.g., 1.4(a), 1.4(c), 1.4(g) — EO 13526 §1.4 classification reason"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customDeclassifyOn">Declassify On</Label>
                  <Input
                    id="customDeclassifyOn"
                    value={formData.declassifyOn || ''}
                    onChange={(e) => setField('declassifyOn', e.target.value)}
                    placeholder="e.g., 25X1, 20501231, or specific event"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customClassifiedPocEmail">Classified POC Email</Label>
                  <Input
                    id="customClassifiedPocEmail"
                    type="email"
                    value={formData.classifiedPocEmail || ''}
                    onChange={(e) => setField('classifiedPocEmail', e.target.value)}
                    placeholder="john.doe@usmc.mil"
                  />
                </div>
              </div>
            )}

            {/* CUI Fields — only when CUI is the selected level */}
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

            {/* Classified Fields — only when an actual classified level is
                selected (Confidential/Secret/Top Secret/Top Secret//SCI).
                Per DoD 5200.01 these accompany every classified document.
                On non-government domains where these levels are filtered
                out, use Custom Classification — the equivalent fields are
                exposed there. */}
            {isClassified && (
              <div className="space-y-4 p-3 rounded-md border bg-muted/30">
                <p className="text-sm font-medium text-destructive">Classified Configuration</p>

                <div className="space-y-2">
                  <Label htmlFor="classifiedBy">Classified By</Label>
                  <Input
                    id="classifiedBy"
                    value={formData.classifiedBy || ''}
                    onChange={(e) => setField('classifiedBy', e.target.value)}
                    placeholder="e.g., John A. Smith, OCA"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="derivedFrom">Derived From</Label>
                  <Input
                    id="derivedFrom"
                    value={formData.derivedFrom || ''}
                    onChange={(e) => setField('derivedFrom', e.target.value)}
                    placeholder="e.g., SECNAVINST 5510.36"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="classReason">Reason</Label>
                  <Input
                    id="classReason"
                    value={formData.classReason || ''}
                    onChange={(e) => setField('classReason', e.target.value)}
                    placeholder="e.g., 1.4(a), 1.4(c), 1.4(g) — EO 13526 §1.4 classification reason"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="declassifyOn">Declassify On</Label>
                  <Input
                    id="declassifyOn"
                    value={formData.declassifyOn || ''}
                    onChange={(e) => setField('declassifyOn', e.target.value)}
                    placeholder="e.g., 25X1, 20501231, or specific event"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="classifiedPocEmail">Classified POC Email</Label>
                  <Input
                    id="classifiedPocEmail"
                    type="email"
                    value={formData.classifiedPocEmail || ''}
                    onChange={(e) => setField('classifiedPocEmail', e.target.value)}
                    placeholder="john.doe@usmc.mil"
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

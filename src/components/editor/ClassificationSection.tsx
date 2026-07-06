import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from '@/components/ui/select';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, } from '@/components/ui/accordion';
import { useDocumentStore } from '@/stores/documentStore';
import { Shield, AlertTriangle, Info } from 'lucide-react';
import { HelpTip } from '@/components/ui/help-tip';
import { Notice } from '@/components/ui/notice';
import {
  getDomainClassificationRestriction,
  getDomainRestrictionMessage,
  type ClassificationLevel,
  type ClassificationRestriction,
} from '@/lib/domainClassification';
import { useEffect, useState } from 'react';
import { getClassificationConfig } from '@/config/classification';

// Official CNSI/ISOO banner colors (EO 13526, 32 CFR 2001/2002, DoDM 5200.01,
// CAPCO Register, ISOO directive). Hex codes match the dodcui.mil/ISOO table:
//   UNCLASSIFIED  #007A33  CUI  #502B85  CONFIDENTIAL  #0033A0
//   SECRET  #C8102E  TOP SECRET  #FF8C00  TOP SECRET//SCI  #FCE83A
// CUI is not a CNSI level; it shares a banner color for display only and is
// governed by 32 CFR Part 2002.
const CLASSIFICATION_LEVELS = [
  { value: 'unclassified', label: 'Unclassified', color: 'text-[#007A33] dark:text-[#3DBE6B]' },
  { value: 'cui', label: 'CUI (Controlled Unclassified Information)', color: 'text-[#502B85] dark:text-[#9572D4]' },
  { value: 'confidential', label: 'CONFIDENTIAL', color: 'text-[#0033A0] dark:text-[#5B7FD9]' },
  { value: 'secret', label: 'SECRET', color: 'text-[#C8102E] dark:text-[#E74C5C]' },
  // TOP SECRET's banner orange (#FF8C00, 2.3:1) and the TS//SCI amber
  // (#A8920E, 3.0:1) fail WCAG AA as text on the light card — on the very
  // labels that must be unmissable. Text uses darkened variants (≥4.5:1 on the
  // card AND on the /10–/20 tints); the bright banner colors stay for
  // fills/tints only. Dark-mode variants sit on the deep canvas and pass as-is.
  { value: 'top_secret', label: 'TOP SECRET', color: 'text-[#B45309] dark:text-[#FFA940]' },
  { value: 'top_secret_sci', label: 'TOP SECRET//SCI', color: 'text-[#756808] dark:text-[#FCE83A]' },
];

// Quick-fill presets for the Custom Classification field. Tinted backgrounds use
// the CNSI/ISOO banner colors so each button reads as a mini banner; the TOP
// SECRET / SCI label text uses the darkened AA-safe variants from above.
// Custom-mode quick-fill markings. Deliberately UNCLASSIFIED-only: this is a
// browser-based tool that is NOT accredited for classified processing, and the
// custom-mode warning says as much. The classified levels (CONFIDENTIAL, SECRET,
// TOP SECRET, TS//SCI) are intentionally absent — they were previously offered
// here as one-click presets, which let an unclassified document be stamped with
// a classified banner and bypassed the domain-accreditation gate that removes
// those levels from the Classification Level dropdown. Classified levels remain
// selectable ONLY via that gated dropdown, on accredited domains.
const CLASSIFICATION_PRESETS = [
  { value: 'UNCLASSIFIED',         label: 'Unclassified',         color: 'text-[#007A33] dark:text-[#3DBE6B]', bg: 'bg-[#007A33]/10 dark:bg-[#007A33]/20 border-[#007A33]/30 hover:bg-[#007A33]/20 dark:hover:bg-[#007A33]/30' },
  { value: 'CUI',                  label: 'CUI',                  color: 'text-[#502B85] dark:text-[#9572D4]', bg: 'bg-[#502B85]/10 dark:bg-[#502B85]/20 border-[#502B85]/30 hover:bg-[#502B85]/20 dark:hover:bg-[#502B85]/30' },
  { value: 'FOR OFFICIAL USE ONLY', label: 'FOR OFFICIAL USE ONLY', color: 'text-[#502B85] dark:text-[#9572D4]', bg: 'bg-[#502B85]/10 dark:bg-[#502B85]/20 border-[#502B85]/30 hover:bg-[#502B85]/20 dark:hover:bg-[#502B85]/30' },
];

// Official CUI banner color (#502B85 / dark #9572D4), matching the level/preset
// swatches above — not a generic purple.
const CUI_TEXT_COLOR = 'text-[#502B85] dark:text-[#9572D4]';

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

  // Only surface the "Domain Restrictions" banner when a domain actually narrows
  // the level list — otherwise it's noise on the default (unrestricted) panel.
  const isDomainRestricted = allowedLevels.length < CLASSIFICATION_LEVELS.length;

  // Check if current selection is allowed (custom is always allowed)
  const isCurrentLevelAllowed = classLevel === 'custom' ||
    domainRestriction.allowedLevels.includes(classLevel as ClassificationLevel);

  // If the current level isn't allowed, reset to the highest allowed one.
  // Wait for config to load first.
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

  // Both POC-email inputs bind the same field and only one shows at a time, so
  // one validity check covers both. Flag a non-empty value that isn't a basic
  // address; an empty field is a normal "not filled in yet" state.
  const pocEmail = (formData.classifiedPocEmail || '').trim();
  const pocEmailInvalid = pocEmail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pocEmail);

  return (
    <Accordion data-tour="classification" type="single" collapsible>
      <AccordionItem value="classification">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <Shield
              aria-hidden="true"
              className={`h-4 w-4 ${classLevel === 'custom' ? 'text-muted-foreground' : currentLevel?.color || 'text-foreground'}`}
              style={{ fill: 'currentColor', fillOpacity: 0.2 }}
            />
            Classification
            <span className={`text-xs font-medium ${classLevel === 'custom' ? 'text-muted-foreground' : currentLevel?.color}`}>
              ({classLevel === 'custom' ? 'Custom' : currentLevel?.label})
            </span>
            <HelpTip>
              <p className="font-medium mb-1">Classification Markings</p>
              <p className="text-xs">
                Set the security classification level for this document. Markings appear in the header and footer of every page per DoD 5200.01.
              </p>
              <ul className="text-xs mt-2 space-y-1 list-disc list-inside">
                <li><strong>CUI:</strong> Adds controlled-by, category, and dissemination fields</li>
                <li><strong>Classified:</strong> Adds classified-by, derived-from, reason, and declassify-on fields</li>
                <li><strong>Portion marks:</strong> Set per-paragraph markings in the body editor</li>
              </ul>
            </HelpTip>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground -mt-1">Security markings stamped top and bottom.</p>
            {/* Domain Restriction Info — only when the active domain narrows the
                level list, so the default panel stays clean like the design. */}
            {isDomainRestricted && (
              <div className="flex items-start gap-2 border-l-2 border-info/40 pl-3">
                <Info aria-hidden="true" className="h-4 w-4 text-info mt-0.5 shrink-0" />
                <div className="text-sm text-info">
                  <p className="font-medium"><span className="sr-only">Important: </span>Domain Restrictions</p>
                  <p className="text-xs mt-1">{restrictionMessage}</p>
                </div>
              </div>
            )}

            {/* Classification Level */}
            <div data-tour="classification-level" className="space-y-2">
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
                    <span className="text-muted-foreground">Custom Classification</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Warning for classified documents */}
            {isClassified && (
              <Notice variant="error" className="flex items-start gap-2">
                <AlertTriangle aria-hidden="true" className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="text-sm text-destructive">
                  <p className="font-medium"><span className="sr-only">Warning: </span>Classified Document Warning</p>
                  <p className="text-xs mt-1">
                    This document will contain classified markings. Ensure proper handling
                    procedures are followed per applicable security regulations.
                  </p>
                </div>
              </Notice>
            )}

            {/* Custom mode holds the marking text plus all CUI/Classified
                fields in one block: on non-government domains the classified
                dropdown options are filtered out, so this is the only place
                those inputs are reachable. */}
            {isCustom && (
              <div className="space-y-4 p-3 rounded-md border bg-muted/30">
                <p className="text-sm font-medium">Custom Classification</p>

                <Notice variant="warning" className="flex items-start gap-2">
                  <AlertTriangle aria-hidden="true" className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <div className="text-sm text-warning">
                    <p className="font-medium"><span className="sr-only">Warning: </span>Classification handling — non-accredited system</p>
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
                </Notice>

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
                            className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${preset.color} ${preset.bg} ${active ? 'ring-2 ring-offset-1 ring-offset-background ring-current' : ''}`}
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
                      <SelectValue placeholder="Select category…" />
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
                      <SelectValue placeholder="Select statement…" />
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
                    aria-invalid={pocEmailInvalid || undefined}
                    aria-describedby={pocEmailInvalid ? 'customClassifiedPocEmail-error' : undefined}
                  />
                  {pocEmailInvalid && (
                    <p id="customClassifiedPocEmail-error" role="alert" className="text-xs text-destructive">
                      Enter a valid email address (e.g. john.doe@usmc.mil).
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* CUI fields, shown only when CUI is the selected level. */}
            {isCUI && (
              <div className="space-y-4 p-3 rounded-md border bg-muted/30">
                <p className={`text-sm font-medium ${CUI_TEXT_COLOR}`}>CUI Configuration</p>

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
                      <SelectValue placeholder="Select category…" />
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
                      <SelectValue placeholder="Select statement…" />
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

            {/* Classified fields, shown only for an actual classified level.
                Per DoD 5200.01 these accompany every classified document. On
                non-government domains the equivalent fields live in Custom. */}
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
                    aria-invalid={pocEmailInvalid || undefined}
                    aria-describedby={pocEmailInvalid ? 'classifiedPocEmail-error' : undefined}
                  />
                  {pocEmailInvalid && (
                    <p id="classifiedPocEmail-error" role="alert" className="text-xs text-destructive">
                      Enter a valid email address (e.g. john.doe@usmc.mil).
                    </p>
                  )}
                </div>
              </div>
            )}

          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

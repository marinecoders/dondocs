import { useState, useMemo, useCallback } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, } from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove, } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BookOpen, Plus, Trash2, AlertCircle, GripVertical, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { InputWithVariables } from '@/components/ui/variable-autocomplete';
import { HelpTip } from '@/components/ui/help-tip';
import { IconTip } from '@/components/ui/icon-tip';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { unfilled } from '@/lib/requiredField';
import { RequiredMark } from '@/components/ui/required-mark';
import { SSICLookupModal } from '@/components/modals/SSICLookupModal';
import { UnitLookupModal } from '@/components/modals/UnitLookupModal';
import { expandUnitName, insertUnitInto, type UnitInfo } from '@/data/unitDirectory';
import type { DocTypeConfig } from '@/types/document';

interface AddressingSectionProps {
  config: DocTypeConfig;
}

interface SortableViaItemProps {
  id: string;
  index: number;
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  onLookup: () => void;
  canRemove: boolean;
}

function SortableViaItem({ id, index, value, onChange, onRemove, onLookup, canRemove }: SortableViaItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Drag to reorder via routing ${index + 1}`}
        title="Drag to reorder"
        className="cursor-grab touch-none rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Badge variant="secondary" className="shrink-0 min-w-[32px] justify-center tnum">
        ({index + 1})
      </Badge>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Commanding Officer, 6th Marine Regiment"
        className="flex-1"
      />
      <IconTip label="Look up a unit">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onLookup}
          className="shrink-0"
        >
          <Building2 className="h-4 w-4" />
        </Button>
      </IconTip>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Remove via routing ${index + 1}`}
        className="shrink-0 text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function AddressingSection({ config }: AddressingSectionProps) {
  const { formData, setField, documentMode } = useDocumentStore();
  const docType = useDocumentStore((s) => s.docType);
  const validationVisible = useUIStore((s) => s.validationVisible);
  const [ssicModalOpen, setSSICModalOpen] = useState(false);
  // Unit-directory lookup target: 'to' | a Via row index | null (closed). One
  // modal serves both the To field and each Via row.
  const [unitLookup, setUnitLookup] = useState<'to' | number | null>(null);

  const handleUnitSelect = (unit: UnitInfo) => {
    const name = expandUnitName(unit.name);
    const fd = useDocumentStore.getState().formData;
    if (unitLookup === 'to') {
      setField('to', insertUnitInto(fd.to ?? '', name));
    } else if (typeof unitLookup === 'number') {
      const lines = (fd.via ?? '').split('\n');
      lines[unitLookup] = insertUnitInto(lines[unitLookup] ?? '', name);
      setField('via', lines.join('\n'));
    }
    setUnitLookup(null);
  };

  // Check compliance requirements for business letters
  const isCompliantMode = documentMode === 'compliant';
  const requiresSalutation = isCompliantMode && config.compliance.requiresSalutation;
  const dateFormat = isCompliantMode ? config.compliance.dateFormat : 'military';
  const isSSICOptional = isCompliantMode && config.optionalSSIC;

  // Endorsements (same_page / new_page) require a position-in-chain
  // ordinal AND a basic-letter identifier per SECNAV M-5216.5 Ch 9 §2.1.b.
  // Render dedicated UI when this doc type is selected.
  const isEndorsement = docType === 'same_page_endorsement' || docType === 'new_page_endorsement';
  const isSamePageEndorsement = docType === 'same_page_endorsement';

  const handleSSICSelect = (code: string) => {
    setField('ssic', code);
  };

  // Parse via string into array (split by newlines, keep empty for editing)
  const viaLines = useMemo(() => {
    if (!formData.via) return [''];
    const lines = formData.via.split('\n');
    return lines.length > 0 ? lines : [''];
  }, [formData.via]);

  // Update via field from array
  const updateViaLines = useCallback((lines: string[]) => {
    setField('via', lines.join('\n'));
  }, [setField]);

  const addViaLine = useCallback(() => {
    updateViaLines([...viaLines, '']);
  }, [viaLines, updateViaLines]);

  const removeViaLine = useCallback((index: number) => {
    const newLines = viaLines.filter((_, i) => i !== index);
    updateViaLines(newLines.length > 0 ? newLines : ['']);
  }, [viaLines, updateViaLines]);

  const updateViaLine = useCallback((index: number, value: string) => {
    const newLines = [...viaLines];
    newLines[index] = value;
    updateViaLines(newLines);
  }, [viaLines, updateViaLines]);

  // Drag and drop sensors for via reordering
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleViaDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = parseInt(String(active.id).replace('via-', ''));
      const newIndex = parseInt(String(over.id).replace('via-', ''));
      const reordered = arrayMove(viaLines, oldIndex, newIndex);
      updateViaLines(reordered);
    }
  }, [viaLines, updateViaLines]);

  return (
    <>
      <SSICLookupModal
        open={ssicModalOpen}
        onOpenChange={setSSICModalOpen}
        onSelect={handleSSICSelect}
      />
      <UnitLookupModal
        open={unitLookup !== null}
        onOpenChange={(open) => {
          if (!open) setUnitLookup(null);
        }}
        onSelect={handleUnitSelect}
      />

      <Accordion type="single" collapsible defaultValue="addressing">
        <AccordionItem value="addressing">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              Document Information
              <HelpTip>
                <p className="font-medium mb-1">Document Information</p>
                <p className="text-xs">
                  Core addressing fields required by SECNAV M-5216.5. These form the header block of your correspondence.
                </p>
                <ul className="text-xs mt-2 space-y-1 list-disc list-inside">
                  <li><strong>SSIC:</strong> Standard Subject Identification Code — categorizes the document topic{isSSICOptional && ' (not required for this type)'}</li>
                  <li><strong>From/To:</strong> Originating and receiving commands or individuals</li>
                  <li><strong>Via:</strong> Intermediate routing (chain of command) — optional</li>
                  <li><strong>Subject:</strong> Brief description, auto-uppercased per regulation</li>
                </ul>
              </HelpTip>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <p className="text-xs text-muted-foreground -mt-1">From, To, Via, Subject, and identifying symbols.</p>
              {/* Date Only - for business letters (no SSIC/Serial) */}
              {config.dateOnly && (
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <DatePicker
                    id="date"
                    value={formData.date || ''}
                    onChange={(value) => setField('date', value)}
                    dateFormat={dateFormat}
                  />
                </div>
              )}

              {/* SSIC / Serial / Date - for standard documents */}
              {/* Always show when not dateOnly; gray out SSIC/Serial when config.ssic is false */}
              {!config.dateOnly && (
                <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                  <div className={`space-y-2 ${!config.ssic ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                    <Label htmlFor="ssic">
                      SSIC
                      {!config.ssic && <span className="text-xs font-normal text-muted-foreground ml-1">(N/A)</span>}
                      {config.ssic && isSSICOptional && <span className="text-xs font-normal text-muted-foreground ml-1">(optional)</span>}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="ssic"
                        value={formData.ssic || ''}
                        onChange={(e) => setField('ssic', e.target.value)}
                        placeholder="5216"
                        className="flex-1"
                      />
                      <IconTip label="Browse SSIC codes">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setSSICModalOpen(true)}
                        >
                          <BookOpen className="h-4 w-4" />
                        </Button>
                      </IconTip>
                    </div>
                  </div>
                <div className={`space-y-2 ${!config.ssic ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                  <Label htmlFor="serial">
                    Serial
                    {!config.ssic && <span className="text-xs font-normal text-muted-foreground ml-1">(N/A)</span>}
                    {config.ssic && isCompliantMode && <span className="text-xs font-normal text-muted-foreground ml-1">(optional)</span>}
                  </Label>
                  <Input
                    id="serial"
                    value={formData.serial || ''}
                    onChange={(e) => setField('serial', e.target.value)}
                    placeholder="001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <DatePicker
                    id="date"
                    value={formData.date || ''}
                    onChange={(value) => setField('date', value)}
                    dateFormat={dateFormat}
                  />
                </div>
              </div>

              {/* In Reply Refer To */}
              <div className={`space-y-2 ${!config.ssic ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="inReplyTo"
                    checked={formData.inReplyTo || false}
                    onCheckedChange={(checked) => setField('inReplyTo', checked === true)}
                  />
                  <Label htmlFor="inReplyTo" className="cursor-pointer">
                    In Reply Refer To
                  </Label>
                </div>
                {formData.inReplyTo && (
                  <Input
                    value={formData.inReplyToText || ''}
                    onChange={(e) => setField('inReplyToText', e.target.value)}
                    placeholder="Reference letter/document (e.g., CO ltr 5216 Ser 001 of 1 Jan 25)"
                  />
                )}
              </div>
              </>
            )}

            {/* Memorandum For (mf): the addressee is embedded in the title line
                ("MEMORANDUM FOR [addressee]"), so this doc type has no From/To
                block — but the generators still read the addressee from `to`.
                Without this field the defining line of the document rendered
                blank (docs/KNOWN_ISSUES.md, now resolved). */}
            {docType === 'mf' && (
              <div className="space-y-2">
                <Label htmlFor="to">
                  Memorandum For <RequiredMark />
                </Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <InputWithVariables
                      id="to"
                      value={formData.to || ''}
                      onValueChange={(v) => setField('to', v)}
                      aria-invalid={validationVisible && unfilled(formData.to) ? true : undefined}
                      placeholder="Distribution List, or the receiving office/official"
                    />
                  </div>
                  <IconTip label="Look up a unit">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setUnitLookup('to')}
                      className="shrink-0"
                    >
                      <Building2 className="h-4 w-4" />
                    </Button>
                  </IconTip>
                </div>
                <p className="text-xs text-muted-foreground">
                  Completes the title line: MEMORANDUM FOR [addressee] (SECNAV M-5216.5 Ch 10).
                </p>
              </div>
            )}

            {/* Recipient Address - for business letters (multi-line address block) */}
            {config.recipientAddress && (
              <div className="space-y-2">
                <Label htmlFor="to">Recipient Address</Label>
                <Textarea
                  id="to"
                  value={formData.to || ''}
                  onChange={(e) => setField('to', e.target.value)}
                  aria-invalid={validationVisible && unfilled(formData.to) ? true : undefined}
                  placeholder="Mr. John Smith&#10;Director of Operations&#10;ABC Company&#10;123 Main Street&#10;City, State ZIP"
                  className="min-h-[100px]"
                  rows={5}
                />
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Each line in this field will appear on a separate line in the PDF
                </p>
              </div>
            )}

            {/* From / To */}
            {config.fromTo && (
              // Full-width stacked (From over To), matching the design — command
              // names are long, so each gets its own row rather than a cramped
              // two-up grid.
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="from">From</Label>
                  <InputWithVariables
                    id="from"
                    value={formData.from || ''}
                    onValueChange={(v) => setField('from', v)}
                    aria-invalid={validationVisible && unfilled(formData.from) ? true : undefined}
                    placeholder="Commanding Officer… (type @ for variables)"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="to">To</Label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <InputWithVariables
                        id="to"
                        value={formData.to || ''}
                        onValueChange={(v) => setField('to', v)}
                        aria-invalid={validationVisible && unfilled(formData.to) ? true : undefined}
                        placeholder="Commanding General… (type @ for variables)"
                      />
                    </div>
                    <IconTip label="Look up a unit">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setUnitLookup('to')}
                        className="shrink-0"
                      >
                        <Building2 className="h-4 w-4" />
                      </Button>
                    </IconTip>
                  </div>
                </div>
              </div>
            )}

            {/* Via */}
            {config.via && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Via</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addViaLine}
                    disabled={viaLines.length >= 4}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add via
                  </Button>
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleViaDragEnd}
                >
                  <SortableContext
                    items={viaLines.map((_, i) => `via-${i}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {viaLines.map((line, index) => (
                        <SortableViaItem
                          key={`via-${index}`}
                          id={`via-${index}`}
                          index={index}
                          value={line}
                          onChange={(value) => updateViaLine(index, value)}
                          onRemove={() => removeViaLine(index)}
                          onLookup={() => setUnitLookup(index)}
                          canRemove={viaLines.length > 1 || !!line}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                {viaLines.length >= 4 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Maximum of 4 via addressees supported
                  </p>
                )}
              </div>
            )}

            {/* Salutation - Required for business letters in compliant mode */}
            {requiresSalutation && (
              <div className="space-y-2">
                <Label htmlFor="salutation">Salutation<RequiredMark /></Label>
                <Input
                  id="salutation"
                  value={formData.salutation || ''}
                  onChange={(e) => setField('salutation', e.target.value)}
                  placeholder="Dear Sir or Madam:"
                  aria-invalid={validationVisible && unfilled(formData.salutation) ? true : undefined}
                  aria-describedby={validationVisible && unfilled(formData.salutation) ? 'salutation-error' : undefined}
                />
                {validationVisible && unfilled(formData.salutation) && (
                  <p id="salutation-error" role="alert" className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Per SECNAV M-5216.5 Ch 11: Business letters require a salutation
                  </p>
                )}
              </div>
            )}

            {/* Endorsement ordinal + basic-letter id now live in their own
                "Basic Letter" rail section (EndorsementBasicLetterSection). */}

            {/* Subject — endorsements use the basic letter's subject when
                rendered (same-page omits it; new-page repeats the basic
                letter subject per Ch 9 §1). For non-endorsements the user
                types the actual subject of this document. */}
            <div className="space-y-2">
              <Label htmlFor="subject">
                {isEndorsement ? "Subject (basic letter's subject)" : 'Subject'}
              </Label>
              <InputWithVariables
                id="subject"
                value={formData.subject || ''}
                onValueChange={(v) => setField('subject', v)}
                aria-invalid={validationVisible && unfilled(formData.subject) ? true : undefined}
                placeholder={
                  isEndorsement
                    ? 'Subject of the basic letter being endorsed…'
                    : 'SUBJECT LINE… (type @ for variables)'
                }
                className="uppercase"
              />
            </div>

            {isSamePageEndorsement && (
              <div className="flex items-start space-x-2 pt-1">
                <Checkbox
                  id="includeEndorsementSubject"
                  className="mt-0.5"
                  checked={formData.includeEndorsementSubject || false}
                  onCheckedChange={(checked) => setField('includeEndorsementSubject', !!checked)}
                />
                <div className="space-y-0.5">
                  <Label htmlFor="includeEndorsementSubject" className="text-sm font-normal cursor-pointer">
                    Include the subject line
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    SECNAV M-5216.5 Ch 9 lets a same-page endorsement leave out the subject when the
                    whole page will be photocopied. Turn this on if it will not be.
                  </p>
                </div>
              </div>
            )}

            {/* Subject underline option */}
            <div className="flex items-center space-x-2 pt-1">
              <Checkbox
                id="underlineSubject"
                checked={formData.underlineSubject || false}
                onCheckedChange={(checked) => setField('underlineSubject', !!checked)}
              />
              <Label htmlFor="underlineSubject" className="text-sm font-normal cursor-pointer">
                Underline subject line
              </Label>
            </div>

            {/* Continuation page subject - only show for doc types with subject */}
            {!config?.skipSubject && (
              <div className="flex items-center space-x-2 pt-1">
                <Checkbox
                  id="showSubjectOnContinuation"
                  checked={formData.showSubjectOnContinuation || false}
                  onCheckedChange={(checked) => setField('showSubjectOnContinuation', !!checked)}
                />
                <Label htmlFor="showSubjectOnContinuation" className="text-sm font-normal cursor-pointer">
                  Show subject line on continuation pages
                </Label>
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
    </>
  );
}

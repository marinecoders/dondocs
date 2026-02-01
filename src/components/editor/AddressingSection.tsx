import { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BookOpen, Plus, Trash2, AlertCircle, GripVertical } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
import { useDocumentStore } from '@/stores/documentStore';
import { SSICLookupModal } from '@/components/modals/SSICLookupModal';
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
  canRemove: boolean;
}

function SortableViaItem({ id, index, value, onChange, onRemove, canRemove }: SortableViaItemProps) {
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
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        type="button"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Badge variant="secondary" className="shrink-0 min-w-[36px] justify-center">
        ({index + 1})
      </Badge>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Commanding Officer, 6th Marine Regiment"
        className="flex-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={!canRemove}
        className="shrink-0 text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function AddressingSection({ config }: AddressingSectionProps) {
  const { formData, setField, documentMode } = useDocumentStore();
  const [ssicModalOpen, setSSICModalOpen] = useState(false);

  // Check compliance requirements for business letters
  const isCompliantMode = documentMode === 'compliant';
  const requiresSalutation = isCompliantMode && config.compliance.requiresSalutation;
  const dateFormat = isCompliantMode ? config.compliance.dateFormat : 'military';

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

      <Accordion type="single" collapsible defaultValue="addressing">
        <AccordionItem value="addressing">
          <AccordionTrigger>Document Information</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
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
              {config.ssic && !config.dateOnly && (
                <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ssic">SSIC</Label>
                    <div className="flex gap-1">
                      <Input
                        id="ssic"
                        value={formData.ssic || ''}
                        onChange={(e) => setField('ssic', e.target.value)}
                        placeholder="5216"
                        className="flex-1"
                      />
                      <Button
                        type="button"
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
                  <Label htmlFor="serial">Serial</Label>
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
              <div className="space-y-2">
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

            {/* Recipient Address - for business letters (multi-line address block) */}
            {config.recipientAddress && (
              <div className="space-y-2">
                <Label htmlFor="to">Recipient Address</Label>
                <textarea
                  id="to"
                  value={formData.to || ''}
                  onChange={(e) => setField('to', e.target.value)}
                  placeholder="Mr. John Smith&#10;Director of Operations&#10;ABC Company&#10;123 Main Street&#10;City, State ZIP"
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="space-y-2">
                  <Label htmlFor="from">From</Label>
                  <InputWithVariables
                    id="from"
                    value={formData.from || ''}
                    onValueChange={(v) => setField('from', v)}
                    placeholder="Commanding Officer... (type @ for variables)"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="to">To</Label>
                  <InputWithVariables
                    id="to"
                    value={formData.to || ''}
                    onValueChange={(v) => setField('to', v)}
                    placeholder="Commanding General... (type @ for variables)"
                  />
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
                    Add Via
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
                <div className="flex items-center gap-2">
                  <Label htmlFor="salutation">Salutation</Label>
                  <span className="text-xs text-destructive">* Required</span>
                </div>
                <Input
                  id="salutation"
                  value={formData.salutation || ''}
                  onChange={(e) => setField('salutation', e.target.value)}
                  placeholder="Dear Sir or Madam:"
                  className={!formData.salutation?.trim() ? 'border-destructive' : ''}
                />
                {!formData.salutation?.trim() && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Per SECNAV M-5216.5 Ch 11: Business letters require a salutation
                  </p>
                )}
              </div>
            )}

            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <InputWithVariables
                id="subject"
                value={formData.subject || ''}
                onValueChange={(v) => setField('subject', v)}
                placeholder="SUBJECT LINE... (type @ for variables)"
                className="uppercase"
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
    </>
  );
}

import { useCallback, useState } from 'react';
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
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2, Upload, FileText, X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import type { Enclosure, EnclosurePageStyle } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';

interface SortableEnclosureProps {
  enclosure: Enclosure;
  index: number;
  onUpdateTitle: (title: string) => void;
  onAttachFile: (file: File) => void;
  onRemoveFile: () => void;
  onRemove: () => void;
  onUpdatePageStyle: (style: EnclosurePageStyle) => void;
  onUpdateCoverPage: (hasCoverPage: boolean) => void;
  onUpdateCoverDescription: (description: string) => void;
}

function SortableEnclosure({
  enclosure,
  index,
  onUpdateTitle,
  onAttachFile,
  onRemoveFile,
  onRemove,
  onUpdatePageStyle,
  onUpdateCoverPage,
  onUpdateCoverDescription,
}: SortableEnclosureProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `encl-${index}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      onAttachFile(file);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-card border border-border rounded-lg p-3 mb-2 ${
        isDragging ? 'opacity-50 shadow-lg' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-2 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Number badge */}
        <Badge variant="secondary" className="mt-2 min-w-[32px] justify-center">
          ({index + 1})
        </Badge>

        {/* Content */}
        <div className="flex-1 space-y-2">
          <Input
            value={enclosure.title}
            onChange={(e) => onUpdateTitle(e.target.value)}
            placeholder="Enclosure title..."
          />

          {/* PDF attachment section */}
          {enclosure.file ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 bg-secondary/30 rounded text-sm">
                <FileText className="h-4 w-4 text-primary" />
                <span className="flex-1 truncate">{enclosure.file.name}</span>
                <span className="text-muted-foreground">
                  {(enclosure.file.size / 1024).toFixed(1)} KB
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRemoveFile}
                  className="h-6 w-6 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Page Style:</Label>
                <Select
                  value={enclosure.pageStyle || 'border'}
                  onValueChange={(v) => onUpdatePageStyle(v as EnclosurePageStyle)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="border">85% with Border</SelectItem>
                    <SelectItem value="fullpage">Full Page (No Margins)</SelectItem>
                    <SelectItem value="fit">Fit to Margins</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <label className="flex items-center gap-2 p-2 border border-dashed border-border rounded cursor-pointer hover:bg-secondary/30 transition-colors">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Attach PDF (optional)</span>
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          )}

          {/* Cover/placeholder page option - always visible */}
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id={`cover-${index}`}
              checked={enclosure.hasCoverPage || false}
              onCheckedChange={(checked) => onUpdateCoverPage(checked === true)}
            />
            <Label htmlFor={`cover-${index}`} className="text-xs text-muted-foreground cursor-pointer">
              {enclosure.file ? 'Add cover page before PDF' : 'Add placeholder / cover page'}
            </Label>
          </div>
          {enclosure.hasCoverPage && (
            <Textarea
              placeholder="Optional description for page..."
              value={enclosure.coverPageDescription || ''}
              onChange={(e) => onUpdateCoverDescription(e.target.value)}
              className="text-xs min-h-[60px]"
            />
          )}
        </div>

        {/* Remove button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function EnclosuresManager() {
  const {
    documentMode,
    docType,
    enclosures,
    formData,
    setField,
    addEnclosure,
    updateEnclosure,
    removeEnclosure,
    reorderEnclosures,
  } = useDocumentStore();

  // Get compliance settings
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;
  const isCompliantMode = documentMode === 'compliant';
  const enclosuresNotAllowed = isCompliantMode && !config.compliance.allowEnclosures;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = parseInt(String(active.id).replace('encl-', ''));
      const newIndex = parseInt(String(over.id).replace('encl-', ''));
      reorderEnclosures(oldIndex, newIndex);
    }
  };

  const handleAttachFile = useCallback(async (index: number, file: File) => {
    const data = await file.arrayBuffer();
    updateEnclosure(index, {
      file: {
        name: file.name,
        size: file.size,
        data,
      },
    });
  }, [updateEnclosure]);

  const handleUploadNewEnclosure = useCallback(async (file: File) => {
    // Extract filename without extension for the title
    const title = file.name.replace(/\.pdf$/i, '');
    const data = await file.arrayBuffer();
    addEnclosure(title, {
      name: file.name,
      size: file.size,
      data,
    });
  }, [addEnclosure]);

  // Drag and drop state
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    const pdfFiles = files.filter((file) => file.type === 'application/pdf');

    pdfFiles.forEach((file) => {
      handleUploadNewEnclosure(file);
    });
  }, [handleUploadNewEnclosure]);

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="enclosures">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            Enclosures
            <Badge variant="secondary" className="min-w-[28px] justify-center">
              {enclosures.length}
            </Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="pt-2">
            {/* Compliance restriction - hide everything when not allowed */}
            {enclosuresNotAllowed ? (
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-amber-800 dark:text-amber-200">
                  <span className="font-medium">Per {config.regulations.ref}:</span>{' '}
                  Business letters do not include formal enclosure listings. Enclosures should be mentioned within the body text instead.
                </div>
              </div>
            ) : (
              <>
                {/* Hyperlinks toggle - only show when there are enclosures */}
                {enclosures.length > 0 && (
                  <div className="mb-3 pb-3 border-b border-border space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="includeEnclosureHyperlinks"
                        checked={formData.includeHyperlinks || false}
                        onCheckedChange={(checked) => setField('includeHyperlinks', !!checked)}
                      />
                      <Label htmlFor="includeEnclosureHyperlinks" className="text-sm font-normal cursor-pointer">
                        Include hyperlinks in PDF
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      When enabled, clicking "Encl (1)" in the letter jumps directly to that enclosure's pages. Great for lengthy annexes or SOPs.
                    </p>
                  </div>
                )}

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={enclosures.map((_, i) => `encl-${i}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    {enclosures.map((encl, index) => (
                      <SortableEnclosure
                        key={`encl-${index}`}
                        enclosure={encl}
                        index={index}
                        onUpdateTitle={(title) => updateEnclosure(index, { title })}
                        onAttachFile={(file) => handleAttachFile(index, file)}
                        onRemoveFile={() => updateEnclosure(index, { file: undefined })}
                        onRemove={() => removeEnclosure(index)}
                        onUpdatePageStyle={(pageStyle) => updateEnclosure(index, { pageStyle })}
                        onUpdateCoverPage={(hasCoverPage) => updateEnclosure(index, { hasCoverPage })}
                        onUpdateCoverDescription={(coverPageDescription) => updateEnclosure(index, { coverPageDescription })}
                      />
                    ))}
                  </SortableContext>
                </DndContext>

                <div className="space-y-2 mt-2">
                  <Button
                    variant="outline"
                    onClick={() => addEnclosure('')}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Enclosure
                  </Button>

                  {/* Drop zone for PDFs */}
                  <label
                    className={`flex flex-col items-center justify-center gap-2 p-4 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                      isDraggingOver
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50 hover:bg-secondary/30'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <Upload className={`h-6 w-6 ${isDraggingOver ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className={`text-sm ${isDraggingOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                      {isDraggingOver ? 'Drop PDF here' : 'Drag & drop PDF or click to browse'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        files.forEach((file) => {
                          if (file.type === 'application/pdf') {
                            handleUploadNewEnclosure(file);
                          }
                        });
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

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
import { GripVertical, Plus, Trash2, Library, Link, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import type { Reference } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';

interface SortableReferenceProps {
  reference: Reference;
  index: number;
  onUpdateTitle: (title: string) => void;
  onUpdateUrl: (url: string) => void;
  onRemove: () => void;
}

function SortableReference({
  reference,
  index,
  onUpdateTitle,
  onUpdateUrl,
  onRemove,
}: SortableReferenceProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `ref-${index}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
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

        {/* Letter badge */}
        <Badge variant="secondary" className="mt-2 min-w-[32px] justify-center">
          ({reference.letter})
        </Badge>

        {/* Content */}
        <div className="flex-1 space-y-2">
          <Input
            value={reference.title}
            onChange={(e) => onUpdateTitle(e.target.value)}
            placeholder="Reference title..."
          />
          <div className="flex items-center gap-2">
            <Link className="h-4 w-4 text-muted-foreground" />
            <Input
              value={reference.url || ''}
              onChange={(e) => onUpdateUrl(e.target.value)}
              placeholder="URL (optional)"
              className="text-sm"
            />
          </div>
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

export function ReferencesManager() {
  const {
    documentMode,
    docType,
    references,
    formData,
    setField,
    addReference,
    updateReference,
    removeReference,
    reorderReferences,
  } = useDocumentStore();
  const { setReferenceLibraryOpen } = useUIStore();

  // Get compliance settings
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;
  const isCompliantMode = documentMode === 'compliant';
  const referencesNotAllowed = isCompliantMode && !config.compliance.allowReferences;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = parseInt(String(active.id).replace('ref-', ''));
      const newIndex = parseInt(String(over.id).replace('ref-', ''));
      reorderReferences(oldIndex, newIndex);
    }
  };

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="references">
        <AccordionTrigger>
          References
          {references.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {references.length}
            </Badge>
          )}
        </AccordionTrigger>
        <AccordionContent>
          <div className="pt-2">
            {/* Compliance warning for business letters */}
            {referencesNotAllowed && (
              <div className="flex items-start gap-2 p-3 mb-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-amber-800 dark:text-amber-200">
                  <span className="font-medium">Per {config.regulations.ref}:</span>{' '}
                  Business letters do not include formal reference lines. References should be mentioned within the body text instead.
                </div>
              </div>
            )}
            {/* Hyperlinks toggle */}
            <div className="mb-3 pb-3 border-b border-border space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="includeHyperlinks"
                  checked={formData.includeHyperlinks || false}
                  onCheckedChange={(checked) => setField('includeHyperlinks', !!checked)}
                />
                <Label htmlFor="includeHyperlinks" className="text-sm font-normal cursor-pointer">
                  Include hyperlinks to references and enclosures in PDF
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                When enabled, the URL field below each reference becomes a clickable hyperlink in the generated PDF.
                Enter the full URL (e.g., https://example.com/document.pdf) to link to external documents or resources.
              </p>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={references.map((_, i) => `ref-${i}`)}
                strategy={verticalListSortingStrategy}
              >
                {references.map((ref, index) => (
                  <SortableReference
                    key={`ref-${index}`}
                    reference={ref}
                    index={index}
                    onUpdateTitle={(title) => updateReference(index, { title })}
                    onUpdateUrl={(url) => updateReference(index, { url })}
                    onRemove={() => removeReference(index)}
                  />
                ))}
              </SortableContext>
            </DndContext>

            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                onClick={() => addReference('')}
                className="flex-1"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Reference
              </Button>
              <Button
                variant="outline"
                onClick={() => setReferenceLibraryOpen(true)}
              >
                <Library className="h-4 w-4 mr-2" />
                Library
              </Button>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

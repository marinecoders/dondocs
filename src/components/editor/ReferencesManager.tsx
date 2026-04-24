import { memo } from 'react';
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
import { GripVertical, Plus, Trash2, Library, Link, AlertTriangle, HelpCircle, Info } from 'lucide-react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import type { Reference } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';

interface SortableReferenceProps {
  reference: Reference;
  index: number;
}

// Memoized so typing in reference N doesn't force a re-render of references
// 1..N-1. Store setters are stable and pulled via selectors inside, so the
// parent doesn't need to create fresh callback closures per row each render.
const SortableReference = memo(function SortableReference({
  reference,
  index,
}: SortableReferenceProps) {
  const updateReference = useDocumentStore((s) => s.updateReference);
  const removeReference = useDocumentStore((s) => s.removeReference);

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
            onChange={(e) => updateReference(index, { title: e.target.value })}
            placeholder="Reference title..."
          />
          <div className="flex items-center gap-2">
            <Link className="h-4 w-4 text-muted-foreground" />
            <Input
              value={reference.url || ''}
              onChange={(e) => updateReference(index, { url: e.target.value })}
              placeholder="URL (optional)"
              className="text-sm"
            />
          </div>
        </div>

        {/* Remove button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => removeReference(index)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});

export function ReferencesManager() {
  // Individual selectors so the manager only re-renders when one of these
  // specific slices changes. Setters used only by child rows are pulled
  // inside those rows via their own selectors.
  const documentMode = useDocumentStore((s) => s.documentMode);
  const docType = useDocumentStore((s) => s.docType);
  const references = useDocumentStore((s) => s.references);
  const formData = useDocumentStore((s) => s.formData);
  const setField = useDocumentStore((s) => s.setField);
  const addReference = useDocumentStore((s) => s.addReference);
  const reorderReferences = useDocumentStore((s) => s.reorderReferences);
  const setReferenceLibraryOpen = useUIStore((s) => s.setReferenceLibraryOpen);

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
          <span className="flex items-center gap-2">
            <span className={referencesNotAllowed ? 'text-muted-foreground' : ''}>References</span>
            <Badge variant="secondary" className="min-w-[28px] justify-center">
              {references.length}
            </Badge>
            {referencesNotAllowed && (
              <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <Info className="h-3 w-3" />
                Not used by this document type
              </span>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="font-medium mb-1">References</p>
                  <p className="text-xs">
                    Cite directives, orders, or prior correspondence that authorize or relate to this document. References appear as lettered items — (a), (b), (c) — before the body.
                  </p>
                  <ul className="text-xs mt-2 space-y-1 list-disc list-inside">
                    <li><strong>Drag to reorder:</strong> References auto-letter based on position</li>
                    <li><strong>URLs:</strong> Add a link to make the reference clickable in PDF</li>
                    <li><strong>Library:</strong> Browse 107 common military references to insert</li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="pt-2">
            {/* Compliance restriction notice */}
            {referencesNotAllowed && (
              <div className="flex items-start gap-2 p-3 mb-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-amber-800 dark:text-amber-200">
                  <span className="font-medium">Per {config.regulations.ref}:</span>{' '}
                  This document type does not include formal reference lines. References should be mentioned within the body text instead.
                  {references.length > 0 && (
                    <span className="block mt-1 text-xs">Your {references.length} reference{references.length !== 1 ? 's are' : ' is'} preserved and will reappear when you switch to a document type that uses them.</span>
                  )}
                </div>
              </div>
            )}

            <div className={referencesNotAllowed ? 'opacity-50 pointer-events-none select-none' : ''}>
              {/* Hyperlinks toggle - only show when there are references */}
              {references.length > 0 && (
                <div className="mb-3 pb-3 border-b border-border space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="includeHyperlinks"
                      checked={formData.includeHyperlinks || false}
                      onCheckedChange={(checked) => setField('includeHyperlinks', !!checked)}
                    />
                    <Label htmlFor="includeHyperlinks" className="text-sm font-normal cursor-pointer">
                      Include hyperlinks in PDF
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground pl-6">
                    When enabled, references with URLs become clickable hyperlinks in the PDF. Example: Link "MCO 1500.52" directly to marines.mil/directives.
                  </p>
                </div>
              )}

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
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

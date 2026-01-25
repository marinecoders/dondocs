import { useMemo } from 'react';
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
import { GripVertical, Plus, Trash2, ChevronRight, ChevronLeft, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';
import { useDocumentStore } from '@/stores/documentStore';
import type { Paragraph, PortionMarking } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { AlertTriangle } from 'lucide-react';

const PORTION_MARKING_OPTIONS: { value: PortionMarking; label: string; color: string }[] = [
  { value: 'U', label: '(U)', color: 'text-green-600' },
  { value: 'CUI', label: '(CUI)', color: 'text-purple-600' },
  { value: 'FOUO', label: '(FOUO)', color: 'text-amber-600' },
  { value: 'C', label: '(C)', color: 'text-blue-600' },
  { value: 'S', label: '(S)', color: 'text-red-600' },
  { value: 'TS', label: '(TS)', color: 'text-orange-600' },
];

const LEVEL_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-orange-500',
  'bg-red-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-cyan-500',
];

// Count words in text (handles empty strings gracefully)
function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  // Remove LaTeX formatting commands and count remaining words
  const cleanText = text.replace(/\\(textbf|textit|underline)\{([^}]*)\}/g, '$2');
  return cleanText.trim().split(/\s+/).length;
}

// Level labels reference (used by getParagraphLabel)
// ['1.', 'a.', '(1)', '(a)', '1.', 'a.', '(1)', '(a)']

function getParagraphLabel(level: number, count: number): string {
  const patterns = [
    (n: number) => `${n}.`,
    (n: number) => `${String.fromCharCode(96 + n)}.`,
    (n: number) => `(${n})`,
    (n: number) => `(${String.fromCharCode(96 + n)})`,
  ];
  const pattern = patterns[level % 4];
  return pattern(count);
}

interface SortableParagraphProps {
  paragraph: Paragraph;
  index: number;
  label: string;
  showPortionMarking: boolean;
  disableIndent: boolean;  // True when numbered paragraphs are disabled (business letters, endorsements)
  onUpdate: (text: string) => void;
  onUpdateHeader: (header: string) => void;
  onUpdatePortionMarking: (marking: PortionMarking | undefined) => void;
  onRemove: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onAddAfter: () => void;
}

function SortableParagraph({
  paragraph,
  index,
  label,
  showPortionMarking,
  disableIndent,
  onUpdate,
  onUpdateHeader,
  onUpdatePortionMarking,
  onRemove,
  onIndent,
  onOutdent,
  onAddAfter,
}: SortableParagraphProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `para-${index}` });

  const wordCount = useMemo(() => countWords(paragraph.text), [paragraph.text]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginLeft: `${paragraph.level * 24}px`,
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

        {/* Level badge */}
        <Badge
          variant="outline"
          className={`mt-2 ${LEVEL_COLORS[paragraph.level]} text-white border-0 text-xs min-w-[32px] justify-center`}
        >
          {label}
        </Badge>

        {/* Content */}
        <div className="flex-1">
          {/* Header input - optional paragraph heading per SECNAV Ch 7 ¶13d */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Header:</span>
            <Input
              value={paragraph.header || ''}
              onChange={(e) => onUpdateHeader(e.target.value)}
              placeholder="Optional heading (auto-underlined)"
              className="h-7 text-sm flex-1"
            />
            {paragraph.header && (
              <span className="text-xs text-muted-foreground italic whitespace-nowrap">
                → <span className="underline">{paragraph.header}</span>
              </span>
            )}
          </div>

          <VariableChipEditor
            value={paragraph.text}
            onChange={onUpdate}
            placeholder="Enter paragraph content... (type @ for variables)"
            rows={3}
          />

          {/* Actions */}
          <div className="flex items-center gap-1 mt-2">
            {!disableIndent && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOutdent}
                  disabled={paragraph.level === 0}
                  title="Outdent (Shift+Tab)"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onIndent}
                  disabled={paragraph.level >= 7}
                  title="Indent (Tab)"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onAddAfter}
              title="Add paragraph after"
            >
              <ArrowDown className="h-4 w-4 mr-1" />
              <Plus className="h-3 w-3" />
            </Button>

            {/* Portion Marking */}
            {showPortionMarking && (
              <Select
                value={paragraph.portionMarking || ''}
                onValueChange={(v) => onUpdatePortionMarking(v as PortionMarking || undefined)}
              >
                <SelectTrigger className="h-7 w-[70px] text-xs">
                  <SelectValue placeholder="Mark" />
                </SelectTrigger>
                <SelectContent>
                  {PORTION_MARKING_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className={opt.color}>{opt.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="flex-1" />
            <span className="text-xs text-muted-foreground mr-2">
              {wordCount} {wordCount === 1 ? 'word' : 'words'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              className="text-destructive hover:text-destructive"
              title="Remove paragraph"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ParagraphsEditor() {
  const {
    documentMode,
    docType,
    formData,
    paragraphs,
    addParagraph,
    updateParagraph,
    removeParagraph,
    reorderParagraphs,
    indentParagraph,
    outdentParagraph,
  } = useDocumentStore();

  // Show portion marking when document has classification
  const showPortionMarking = formData.classLevel && formData.classLevel !== 'unclassified';

  // Get compliance settings for the current document type
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;
  const isCompliantMode = documentMode === 'compliant';
  const disableNumberedParagraphs = isCompliantMode && !config.compliance.numberedParagraphs;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Calculate labels for each paragraph
  const labels = calculateLabels(paragraphs);

  // Calculate total word count
  const totalWords = useMemo(() => {
    return paragraphs.reduce((sum, para) => sum + countWords(para.text), 0);
  }, [paragraphs]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = parseInt(String(active.id).replace('para-', ''));
      const newIndex = parseInt(String(over.id).replace('para-', ''));
      reorderParagraphs(oldIndex, newIndex);
    }
  };

  return (
    <Accordion type="single" collapsible defaultValue="paragraphs">
      <AccordionItem value="paragraphs">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <span>Body Paragraphs</span>
            <span className="text-xs text-muted-foreground font-normal">
              ({totalWords} {totalWords === 1 ? 'word' : 'words'})
            </span>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          {/* Variable hint banner */}
          <div className="px-3 py-2.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm mb-3">
            <div className="flex items-start gap-2">
              <span className="text-blue-600 dark:text-blue-400 text-lg leading-none mt-0.5">@</span>
              <div className="flex-1">
                <p className="font-medium text-blue-700 dark:text-blue-300">Variables for Batch Documents</p>
                <p className="text-blue-600 dark:text-blue-400 text-xs mt-0.5">
                  Type <code className="bg-blue-100 dark:bg-blue-900 px-1 py-0.5 rounded font-mono">@</code> followed by any name to create variables. Custom variables auto-suggest once created.
                  Use <strong>B</strong>/<strong>I</strong>/<strong>U</strong> for formatting.
                </p>
              </div>
            </div>
          </div>

          {/* Compliance warning for document types that don't use numbered paragraphs */}
          {disableNumberedParagraphs && (
            <div className="flex items-start gap-2 p-3 mb-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-amber-800 dark:text-amber-200">
                <span className="font-medium">Per {config.regulations.ref}:</span>{' '}
                {docType === 'business_letter'
                  ? 'Business letters do not use numbered paragraphs. Use 0.5" paragraph indentation instead.'
                  : 'Endorsements continue the basic letter\'s paragraph sequence and do not restart numbering.'}
              </div>
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={paragraphs.map((_, i) => `para-${i}`)}
              strategy={verticalListSortingStrategy}
            >
              {paragraphs.map((para, index) => (
                <SortableParagraph
                  key={`para-${index}`}
                  paragraph={para}
                  index={index}
                  label={disableNumberedParagraphs ? '' : labels[index]}
                  showPortionMarking={!!showPortionMarking}
                  disableIndent={disableNumberedParagraphs}
                  onUpdate={(text) => updateParagraph(index, { text })}
                  onUpdateHeader={(header) => updateParagraph(index, { header })}
                  onUpdatePortionMarking={(marking) => updateParagraph(index, { portionMarking: marking })}
                  onRemove={() => removeParagraph(index)}
                  onIndent={() => indentParagraph(index)}
                  onOutdent={() => outdentParagraph(index)}
                  onAddAfter={() => addParagraph('', para.level, index)}
                />
              ))}
            </SortableContext>
          </DndContext>

          <Button
            variant="outline"
            onClick={() => addParagraph('', 0)}
            className="w-full mt-2"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Paragraph
          </Button>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function calculateLabels(paragraphs: Paragraph[]): string[] {
  const labels: string[] = [];
  const counters = [0, 0, 0, 0, 0, 0, 0, 0];

  for (const para of paragraphs) {
    // Reset counters for deeper levels
    for (let i = para.level + 1; i < 8; i++) {
      counters[i] = 0;
    }
    counters[para.level]++;
    labels.push(getParagraphLabel(para.level, counters[para.level]));
  }

  return labels;
}

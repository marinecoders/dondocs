import { memo, useMemo } from 'react';
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
import { GripVertical, Plus, Trash2, ChevronRight, ChevronLeft, ArrowDown, HelpCircle } from 'lucide-react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Per-paragraph portion-mark colors aligned with the official CNSI / ISOO
// banner palette (see CLASSIFICATION_LEVELS in ClassificationSection.tsx
// for the citation block — EO 13526, 32 CFR 2001/2002, DoDM 5200.01,
// CAPCO Register, ISOO Implementing Directive). Each level uses the
// official code in light mode and a brighter readable variant in dark
// mode so the contrast holds in either theme.
//
// FOUO was deprecated in favor of CUI per DoDI 5200.48 (2020), but
// many legacy documents still use it; rendered here in the same purple
// as CUI to signal the equivalence while keeping the marking selectable
// for backwards compatibility.
const PORTION_MARKING_OPTIONS: { value: PortionMarking; label: string; color: string }[] = [
  { value: 'U',    label: '(U)',    color: 'text-[#007A33] dark:text-[#3DBE6B]' },
  { value: 'CUI',  label: '(CUI)',  color: 'text-[#502B85] dark:text-[#9572D4]' },
  { value: 'FOUO', label: '(FOUO)', color: 'text-[#502B85] dark:text-[#9572D4]' },
  { value: 'C',    label: '(C)',    color: 'text-[#0033A0] dark:text-[#5B7FD9]' },
  { value: 'S',    label: '(S)',    color: 'text-[#C8102E] dark:text-[#E74C5C]' },
  { value: 'TS',   label: '(TS)',   color: 'text-[#FF8C00] dark:text-[#FFA940]' },
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
}

// Memoized so that typing in paragraph N doesn't force re-render of paragraphs
// 1..N-1. The props are all primitives/stable refs except `paragraph` itself,
// which only changes when that specific row's data changes — so default shallow
// equality is sufficient. Store setters are pulled inline via selectors rather
// than passed as callback props so the parent doesn't re-create closures per
// row on every render (which would defeat memoization).
const SortableParagraph = memo(function SortableParagraph({
  paragraph,
  index,
  label,
  showPortionMarking,
  disableIndent,
}: SortableParagraphProps) {
  const updateParagraph = useDocumentStore((s) => s.updateParagraph);
  const removeParagraph = useDocumentStore((s) => s.removeParagraph);
  const indentParagraph = useDocumentStore((s) => s.indentParagraph);
  const outdentParagraph = useDocumentStore((s) => s.outdentParagraph);
  const addParagraph = useDocumentStore((s) => s.addParagraph);

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
              onChange={(e) => updateParagraph(index, { header: e.target.value })}
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
            onChange={(text) => updateParagraph(index, { text })}
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
                  onClick={() => outdentParagraph(index)}
                  disabled={paragraph.level === 0}
                  title="Outdent (Shift+Tab)"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => indentParagraph(index)}
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
              onClick={() => addParagraph('', paragraph.level, index)}
              title="Add paragraph after"
            >
              <ArrowDown className="h-4 w-4 mr-1" />
              <Plus className="h-3 w-3" />
            </Button>

            {/* Portion Marking */}
            {showPortionMarking && (
              <Select
                value={paragraph.portionMarking || ''}
                onValueChange={(v) => updateParagraph(index, { portionMarking: (v as PortionMarking) || undefined })}
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
              onClick={() => removeParagraph(index)}
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
});

export function ParagraphsEditor() {
  // Individual selectors so the editor only re-renders when one of these
  // specific slices changes. The child row components pull their own setters
  // via selectors, so the parent no longer needs to own them.
  const documentMode = useDocumentStore((s) => s.documentMode);
  const docType = useDocumentStore((s) => s.docType);
  const formData = useDocumentStore((s) => s.formData);
  const paragraphs = useDocumentStore((s) => s.paragraphs);
  const addParagraph = useDocumentStore((s) => s.addParagraph);
  const reorderParagraphs = useDocumentStore((s) => s.reorderParagraphs);

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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="font-medium mb-1">Body Paragraphs</p>
                  <p className="text-xs">
                    The main content of your correspondence. Paragraphs are auto-numbered per SECNAV M-5216.5 (1., 2., 3. at level 0; a., b., c. at level 1; etc.).
                  </p>
                  <ul className="text-xs mt-2 space-y-1 list-disc list-inside">
                    <li><strong>Indent/Outdent:</strong> Use arrows to create sub-paragraphs (up to 4 levels)</li>
                    <li><strong>Drag to reorder:</strong> Numbering updates automatically</li>
                    <li><strong>Rich text:</strong> Supports bold, italic, and underline formatting</li>
                    <li><strong>Variables:</strong> Type {"{"} to insert dynamic fields like date or unit name</li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          {/* Compliance warning for document types that don't use numbered paragraphs */}
          {disableNumberedParagraphs && (
            <div className="flex items-start gap-2 p-3 mb-3 bg-destructive/5 border border-destructive/20 rounded-lg text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
              <div className="text-foreground">
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

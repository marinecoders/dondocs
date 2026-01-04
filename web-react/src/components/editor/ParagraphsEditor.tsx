import { useRef, useCallback, useMemo } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { RichTextToolbar, applyFormat } from './RichTextToolbar';
import { useDocumentStore } from '@/stores/documentStore';
import type { Paragraph } from '@/types/document';

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
  onUpdate: (text: string) => void;
  onRemove: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onAddAfter: () => void;
}

function SortableParagraph({
  paragraph,
  index,
  label,
  onUpdate,
  onRemove,
  onIndent,
  onOutdent,
  onAddAfter,
}: SortableParagraphProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const handleFormat = useCallback((format: 'bold' | 'italic' | 'underline') => {
    if (!textareaRef.current) return;
    const newText = applyFormat(textareaRef.current, format);
    onUpdate(newText);
  }, [onUpdate]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        onOutdent();
      } else {
        onIndent();
      }
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

        {/* Level badge */}
        <Badge
          variant="outline"
          className={`mt-2 ${LEVEL_COLORS[paragraph.level]} text-white border-0 text-xs min-w-[32px] justify-center`}
        >
          {label}
        </Badge>

        {/* Content */}
        <div className="flex-1">
          <RichTextToolbar onFormat={handleFormat} />
          <Textarea
            ref={textareaRef}
            value={paragraph.text}
            onChange={(e) => onUpdate(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter paragraph content..."
            rows={3}
            className="resize-none"
          />

          {/* Actions */}
          <div className="flex items-center gap-1 mt-2">
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
            <Button
              variant="ghost"
              size="sm"
              onClick={onAddAfter}
              title="Add paragraph after"
            >
              <ArrowDown className="h-4 w-4 mr-1" />
              <Plus className="h-3 w-3" />
            </Button>
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
    paragraphs,
    addParagraph,
    updateParagraph,
    removeParagraph,
    reorderParagraphs,
    indentParagraph,
    outdentParagraph,
  } = useDocumentStore();

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
          <div className="pt-2">
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
                    label={labels[index]}
                    onUpdate={(text) => updateParagraph(index, { text })}
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
          </div>
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

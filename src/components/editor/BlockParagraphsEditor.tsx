import { memo, useCallback, useMemo, useState } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, } from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, Plus, Trash2, ChevronRight, ChevronLeft, ArrowUp, ArrowDown, AlertTriangle, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconTip } from '@/components/ui/icon-tip';
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';
import { HelpTip } from '@/components/ui/help-tip';
import { useDocumentStore } from '@/stores/documentStore';
import { useSnippetsStore } from '@/stores/snippetsStore';
import { showAppAlert } from '@/stores/alertStore';
import { DOC_TYPE_CONFIG, type PortionMarking } from '@/types/document';
import { calculateLabels, canIndentAt } from '@/lib/paragraphUtils';
import { cn } from '@/lib/utils';

// Per-paragraph portion marks (official CNSI/ISOO palette; brighter variants in
// dark mode). The gutter chip opens a menu to pick any marking directly — no
// more clicking through the whole cycle to step back one level.
const PORTION_MARKS: { value: PortionMarking; label: string; name: string; color: string }[] = [
  { value: 'U', label: '(U)', name: 'Unclassified', color: 'text-[#007A33] dark:text-[#3DBE6B]' },
  { value: 'CUI', label: '(CUI)', name: 'Controlled Unclassified', color: 'text-[#502B85] dark:text-[#9572D4]' },
  { value: 'C', label: '(C)', name: 'Confidential', color: 'text-[#0033A0] dark:text-[#5B7FD9]' },
  { value: 'S', label: '(S)', name: 'Secret', color: 'text-[#C8102E] dark:text-[#E74C5C]' },
  { value: 'TS', label: '(TS)', name: 'Top Secret', color: 'text-[#FF8C00] dark:text-[#FFA940]' },
];

function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  const clean = text
    .replace(/\{\{[A-Z0-9_]+\}\}/g, 'x')
    .replace(/\*\*|__|\*/g, '')
    .replace(/\\(textbf|textit|underline)\{([^}]*)\}/g, '$2');
  return clean.trim().split(/\s+/).length;
}

interface BlockRowProps {
  index: number;
  level: number;
  text: string;
  header: string | undefined;
  portionMarking: PortionMarking | undefined;
  label: string;
  autoFocus: boolean;
  showPortionMarking: boolean;
  disableIndent: boolean;
  /** Whether a deeper indent is currently legal (≤ one level below the block
   *  above). Drives the button's disabled state; the store also enforces it. */
  canIndent: boolean;
  requestFocus: (index: number) => void;
}

// Memoized so typing in one block doesn't re-render the others. The block-nav
// callbacks read the live store via getState(), so they don't need to be passed
// as (identity-changing) props — only the small set of primitives above.
const BlockRow = memo(function BlockRow({
  index,
  level,
  text,
  header,
  portionMarking,
  label,
  autoFocus,
  showPortionMarking,
  disableIndent,
  canIndent,
  requestFocus,
}: BlockRowProps) {
  const updateParagraph = useDocumentStore((s) => s.updateParagraph);
  const removeParagraph = useDocumentStore((s) => s.removeParagraph);
  const indentParagraph = useDocumentStore((s) => s.indentParagraph);
  const outdentParagraph = useDocumentStore((s) => s.outdentParagraph);
  const addParagraph = useDocumentStore((s) => s.addParagraph);
  const insertParagraphs = useDocumentStore((s) => s.insertParagraphs);
  const reorderParagraphs = useDocumentStore((s) => s.reorderParagraphs);

  // Derive header-input visibility from the prop plus a local "user clicked
  // + heading" flag, rather than seeding state once. Deriving means a header
  // populated externally — e.g. a Backspace-merge moving a heading up into this
  // (headerless) block — shows immediately, without a setState-in-effect.
  const [wantsHeader, setWantsHeader] = useState(false);
  const showHeader = !!header || wantsHeader;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `block-${index}`,
  });

  const onEnter = useCallback(() => {
    addParagraph('', level, index);
    requestFocus(index + 1);
  }, [addParagraph, level, index, requestFocus]);

  const onMove = useCallback(
    (dir: -1 | 1) => {
      const total = useDocumentStore.getState().paragraphs.length;
      const j = index + dir;
      if (j < 0 || j >= total) return;
      reorderParagraphs(index, j);
      requestFocus(j);
    },
    [reorderParagraphs, index, requestFocus]
  );

  // A multi-paragraph paste becomes real blocks. If this block is empty, the
  // first segment fills it and the rest follow; otherwise the existing text is
  // kept and every segment is inserted after it (never clobbers work).
  const onSplitPaste = useCallback(
    (segments: string[]) => {
      const empty = !(useDocumentStore.getState().paragraphs[index]?.text ?? '').trim();
      if (empty) {
        updateParagraph(index, { text: segments[0] });
        if (segments.length > 1) insertParagraphs(index, segments.slice(1), level);
        requestFocus(index + segments.length - 1);
      } else {
        insertParagraphs(index, segments, level);
        requestFocus(index + segments.length);
      }
    },
    [index, level, updateParagraph, insertParagraphs, requestFocus]
  );

  // Backspace at the very start of the block: empty block removes itself, an
  // indented block outdents, otherwise its text merges into the previous block —
  // mirroring how a printed paragraph collapses upward.
  const onBackspaceAtStart = useCallback((): boolean => {
    const paras = useDocumentStore.getState().paragraphs;
    const me = paras[index];
    if (!me) return false;
    if (!me.text.trim()) {
      if (paras.length > 1) {
        removeParagraph(index);
        requestFocus(Math.max(0, index - 1));
        return true;
      }
      return false; // never delete the last remaining block
    }
    if (index > 0) {
      const prev = paras[index - 1];
      updateParagraph(index - 1, {
        text: prev.text + me.text,
        // Keep the absorbed block's heading/portion mark if the target doesn't
        // already carry one, rather than silently dropping them on merge.
        header: prev.header || me.header,
        portionMarking: prev.portionMarking ?? me.portionMarking,
      });
      removeParagraph(index);
      requestFocus(index - 1);
      return true;
    }
    if (me.level > 0) {
      outdentParagraph(index);
      return true;
    }
    return false;
  }, [index, removeParagraph, updateParagraph, outdentParagraph, requestFocus]);

  // Fall back to rendering the raw stored value (never the (U) palette default),
  // so a marking outside the palette is shown honestly rather than mislabeled.
  const mark =
    PORTION_MARKS.find((m) => m.value === (portionMarking ?? 'U')) ??
    { value: portionMarking as PortionMarking, label: `(${portionMarking})`, name: String(portionMarking), color: PORTION_MARKS[1].color };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginLeft: `${level * 24}px`,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative grid grid-cols-[34px_1fr] items-start gap-1 py-1.5',
        index === 0 ? '' : 'border-t border-border/45',
        isDragging && 'opacity-60'
      )}
    >
      {/* Drag handle — revealed on row hover/focus, sits in the left margin. */}
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        title="Drag to reorder"
        className="absolute -left-5 top-1.5 cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70 focus-visible:opacity-100"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Gutter label — tabular, serif, like the printed page. The label pattern
          cycles every 4 levels (1./a./(1)/(a)); per SECNAV Ch 7 the deeper
          levels 4–7 repeat those patterns but underlined, which is exactly what
          the LaTeX/PDF renders — mirror it here so "(a)" at level 3 and level 7
          aren't indistinguishable in the editor. */}
      <div className="select-none pt-0.5 pr-2.5 text-right font-serif text-[15px] leading-relaxed text-muted-foreground tnum">
        <span className={level >= 4 ? 'underline' : undefined}>{label}</span>
      </div>

      <div className="min-w-0">
        {showHeader && (
          <Input
            value={header || ''}
            autoFocus={!header}
            onChange={(e) => updateParagraph(index, { header: e.target.value })}
            onBlur={() => {
              if (!header) setWantsHeader(false);
            }}
            placeholder="Heading"
            className="mb-1 h-7 border-none bg-transparent px-0 font-serif text-[15px] font-semibold underline shadow-none focus-visible:ring-0"
          />
        )}
        <div className="flex items-baseline gap-1">
          {showPortionMarking && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Portion marking: ${mark.name}. Change`}
                  title="Set portion marking"
                  className={cn(
                    'shrink-0 rounded-sm font-serif text-[15px] font-semibold outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    mark.color
                  )}
                >
                  {mark.label}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuRadioGroup
                  value={portionMarking ?? 'U'}
                  onValueChange={(v) => updateParagraph(index, { portionMarking: v as PortionMarking })}
                >
                  {PORTION_MARKS.map((m) => (
                    <DropdownMenuRadioItem key={m.value} value={m.value} className="gap-2">
                      <span className={cn('w-12 shrink-0 font-serif font-semibold', m.color)}>{m.label}</span>
                      <span className="text-muted-foreground">{m.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="min-w-0 flex-1 font-serif text-[15px]">
            <VariableChipEditor
              blockMode
              autoFocus={autoFocus}
              value={text}
              onChange={(t) => updateParagraph(index, { text: t })}
              placeholder="Type your paragraph…  ⏎ new · ⇥ indent · @ insert"
              onEnterBlock={onEnter}
              onIndentBlock={disableIndent ? undefined : () => indentParagraph(index)}
              onOutdentBlock={disableIndent ? undefined : () => outdentParagraph(index)}
              onBackspaceAtStart={onBackspaceAtStart}
              onMoveBlock={onMove}
              onSplitPaste={onSplitPaste}
            />
          </div>
        </div>

        {/* Hover controls — kept out of the way until you reach for them.
            Order matches the prototype: + heading, nest, move, then the
            per-paragraph word count and delete. */}
        <div className="mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {!showHeader && (
            <button
              type="button"
              onClick={() => setWantsHeader(true)}
              title="Add heading"
              className="h-6 rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              + heading
            </button>
          )}
          {!disableIndent && (
            <>
              <IconTip label="Outdent (Shift+Tab)">
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={level === 0} onClick={() => outdentParagraph(index)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
              </IconTip>
              <IconTip label="Indent (Tab)">
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!canIndent} onClick={() => indentParagraph(index)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </IconTip>
            </>
          )}
          <IconTip label="Move up (⌘↑)">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMove(-1)}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          </IconTip>
          <IconTip label="Move down (⌘↓)">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMove(1)}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </IconTip>
          <div className="flex-1" />
          <span className="mr-0.5 text-2xs text-muted-foreground tnum">{countWords(text)} w</span>
          <IconTip label="Delete paragraph">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => {
                const total = useDocumentStore.getState().paragraphs.length;
                if (total <= 1) {
                  updateParagraph(index, { text: '', header: '' });
                } else {
                  removeParagraph(index);
                  requestFocus(Math.max(0, index - 1));
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </IconTip>
        </div>
      </div>
    </div>
  );
});

export function BlockParagraphsEditor() {
  const documentMode = useDocumentStore((s) => s.documentMode);
  const docType = useDocumentStore((s) => s.docType);
  const classLevel = useDocumentStore((s) => s.formData.classLevel);
  const paragraphs = useDocumentStore((s) => s.paragraphs);
  const addParagraph = useDocumentStore((s) => s.addParagraph);
  const reorderParagraphs = useDocumentStore((s) => s.reorderParagraphs);

  const snippets = useSnippetsStore((s) => s.snippets);
  const addSnippet = useSnippetsStore((s) => s.addSnippet);
  const deleteSnippet = useSnippetsStore((s) => s.deleteSnippet);
  const [clausesOpen, setClausesOpen] = useState(false);

  // Which block to focus next (after add / merge / move). A plain index; the row
  // whose index matches autofocuses its editor on mount.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const requestFocus = useCallback((i: number) => setFocusIndex(i), []);

  // Insert a saved clause as a new top-level paragraph at the end, then focus it.
  const insertClause = useCallback(
    (text: string) => {
      const count = useDocumentStore.getState().paragraphs.length;
      addParagraph(text, 0, count - 1);
      requestFocus(count);
      setClausesOpen(false);
    },
    [addParagraph, requestFocus]
  );

  // Save the last non-empty paragraph as a reusable clause (auto-named).
  const lastNonEmpty = useMemo(
    () => [...paragraphs].reverse().find((p) => p.text.trim())?.text ?? '',
    [paragraphs]
  );

  const showPortionMarking = !!classLevel && classLevel !== 'unclassified';
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;
  const disableNumbered = documentMode === 'compliant' && !config.compliance.numberedParagraphs;

  const labels = useMemo(() => calculateLabels(paragraphs), [paragraphs]);
  const totalWords = useMemo(() => paragraphs.reduce((sum, p) => sum + countWords(p.text), 0), [paragraphs]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const from = parseInt(String(active.id).replace('block-', ''), 10);
      const to = parseInt(String(over.id).replace('block-', ''), 10);
      reorderParagraphs(from, to);
    }
  };

  return (
    <Accordion type="single" collapsible defaultValue="paragraphs">
      <AccordionItem value="paragraphs">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <span>Body Paragraphs</span>
            <span className="text-xs font-normal text-muted-foreground tnum">
              ({totalWords} {totalWords === 1 ? 'word' : 'words'})
            </span>
            <HelpTip>
              <p className="mb-1 font-medium">Block editor</p>
              <p className="text-xs">Paragraphs flow like the printed letter, auto-numbered per SECNAV M-5216.5.</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
                <li><strong>⏎</strong> new paragraph · <strong>⇥ / ⇧⇥</strong> indent / outdent</li>
                <li><strong>⌫</strong> at the start merges into the one above</li>
                <li><strong>⌘↑ / ⌘↓</strong> move · drag the handle to reorder</li>
                <li><strong>@</strong> inserts a variable · <strong>⌘B / I / U</strong> formats</li>
              </ul>
            </HelpTip>
          </div>
        </AccordionTrigger>
        <AccordionContent>
      <p className="mb-3 text-xs text-muted-foreground">Flows like the letter. ⏎ new · ⇥ indent · @ insert · drag to reorder.</p>
      {disableNumbered && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <span className="font-medium">Per {config.regulations.ref}:</span>{' '}
            {docType === 'business_letter'
              ? 'Business letters do not use numbered paragraphs. Use 0.5" paragraph indentation instead.'
              : "Endorsements continue the basic letter's paragraph sequence and do not restart numbering."}
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={paragraphs.map((_, i) => `block-${i}`)} strategy={verticalListSortingStrategy}>
          {paragraphs.map((p, i) => (
            <BlockRow
              key={`block-${i}`}
              index={i}
              level={p.level}
              text={p.text}
              header={p.header}
              portionMarking={p.portionMarking}
              label={disableNumbered ? '' : labels[i]}
              autoFocus={focusIndex === i}
              showPortionMarking={showPortionMarking}
              disableIndent={disableNumbered}
              canIndent={canIndentAt(paragraphs, i)}
              requestFocus={requestFocus}
            />
          ))}
        </SortableContext>
      </DndContext>

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          className="border-dashed"
          onClick={() => {
            addParagraph('', 0, paragraphs.length - 1);
            requestFocus(paragraphs.length);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add paragraph
        </Button>

        {/* Reusable clause library — insert a saved clause or save one. */}
        <Popover open={clausesOpen} onOpenChange={setClausesOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <Library className="mr-1.5 h-4 w-4" />
              Clauses
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0">
            <div className="border-b border-border px-3 py-2 text-2xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Insert a clause
            </div>
            <ul className="max-h-64 overflow-y-auto p-1">
              {snippets.length === 0 ? (
                <li className="px-2 py-3 text-center text-xs text-muted-foreground">No clauses saved yet.</li>
              ) : (
                snippets.map((sn) => (
                  <li key={sn.id} className="group flex items-start gap-1 rounded-md hover:bg-muted/60">
                    <button
                      type="button"
                      onClick={() => insertClause(sn.text)}
                      className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <span className="block truncate text-sm text-foreground">{sn.name}</span>
                      <span className="block truncate text-2xs text-muted-foreground">{sn.text}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSnippet(sn.id)}
                      aria-label={`Delete clause ${sn.name}`}
                      className="mt-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 outline-none transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="border-t border-border p-1">
              <button
                type="button"
                disabled={!lastNonEmpty}
                onClick={() => {
                  // compressedLocalStorage rethrows on quota; zustand applies the
                  // add in memory before the write, so warn instead of throwing to
                  // the ErrorBoundary. Still close the popover either way.
                  try {
                    addSnippet('', lastNonEmpty);
                  } catch (err) {
                    console.error('Failed to save clause (storage may be full)', err);
                    showAppAlert({
                      title: "Couldn't save this clause",
                      message:
                        "Your browser's local storage is full. Delete a few documents or clauses, then try again.",
                    });
                  }
                  setClausesOpen(false);
                }}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Save last paragraph as a clause
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex-1" />
        <span className="text-xs text-muted-foreground tnum">
          {paragraphs.length} {paragraphs.length === 1 ? 'paragraph' : 'paragraphs'} · {totalWords} words
        </span>
      </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

import type { ReactNode } from 'react';
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
import { GripVertical } from 'lucide-react';

/**
 * Drag-to-reorder wrapper for a form's signature blocks, matching the
 * References / Enclosures / Addressing pattern (dnd-kit + a grip handle). Order
 * is meaningful — it's the top-to-bottom signing order the generator prints —
 * so users can rearrange counselor / Marine / witness without deleting and
 * re-adding. The dnd-kit KeyboardSensor makes the handle keyboard-operable
 * (focus it, Space to lift, arrows to move), so reordering isn't mouse-only.
 *
 * The block card body stays per-form (the two NAVMC sections render different
 * inputs); this only supplies the sortable shell and the handle to its left.
 */

const ID_PREFIX = 'sig-';

export function SortableSignatureList({
  count,
  onReorder,
  className,
  children,
}: {
  count: number;
  onReorder: (oldIndex: number, newIndex: number) => void;
  /** Spacing class for the inner wrapper so each form keeps its own gap. */
  className?: string;
  children: ReactNode;
}) {
  const sensors = useSensors(
    // A small distance threshold so a touch-scroll that happens to start on
    // the handle doesn't turn into an accidental drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = Number(String(active.id).replace(ID_PREFIX, ''));
    const newIndex = Number(String(over.id).replace(ID_PREFIX, ''));
    onReorder(oldIndex, newIndex);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={Array.from({ length: count }, (_, i) => `${ID_PREFIX}${i}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

export function SortableSignatureItem({
  index,
  label,
  showHandle,
  children,
}: {
  index: number;
  /** Human label for the drag handle's aria-label, e.g. "signature block 2". */
  label: string;
  /** Hide the handle when there's nothing to reorder (a lone block). */
  showHandle: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${ID_PREFIX}${index}`,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-50' : undefined}>
      <div className="flex items-start gap-2">
        {showHandle && (
          <button
            type="button"
            aria-label={`Drag to reorder ${label}`}
            {...attributes}
            {...listeners}
            // p-1 pads the hit area for touch without growing the icon; mt-2
            // (+4px padding) keeps the glyph at the same visual height as the
            // old mt-3.
            className="mt-2 cursor-grab touch-none rounded-sm p-1 text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

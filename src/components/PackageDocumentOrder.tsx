import { type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, type CollisionDetection, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

// The document list is sticky inside a scrolling dialog. Its rows can stay put
// while the dialog scrolls, so use their on-screen positions for pointer drops.
const documentUnderPointer: CollisionDetection = args => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const { x, y } = args.pointerCoordinates;
  for (const target of args.droppableContainers) {
    const rect = target.node.current?.getBoundingClientRect();
    if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return [{ id: target.id }];
  }
  return [];
};

export function PackageDocumentOrder({ ids, labels, disabled, onMove, children }: {
  ids: string[]; labels: ReadonlyMap<string, string>; disabled: boolean; onMove(from: string, to: string): void; children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const name = (id: string | number) => labels.get(String(id)) ?? 'Document';
  return <DndContext sensors={sensors} accessibility={{ announcements: {
    onDragStart: ({ active }) => 'Moving ' + name(active.id) + '.',
    onDragOver: ({ over }) => over ? 'Drop at position ' + (ids.indexOf(String(over.id)) + 1) + ', ' + name(over.id) + '.' : 'Outside the document list.',
    onDragEnd: ({ active, over }) => over ? name(active.id) + ' dropped at position ' + (ids.indexOf(String(over.id)) + 1) + '.' : 'Order unchanged.',
    onDragCancel: () => 'Order unchanged.',
  } }} collisionDetection={documentUnderPointer} onDragEnd={({ active, over }) => {
    if (!disabled && over && active.id !== over.id) onMove(String(active.id), String(over.id));
  }}><SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext></DndContext>;
}

export function PackageOrderRow({ id, label, disabled, children }: { id: string; label: string; disabled: boolean; children: ReactNode }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
  return <div ref={setNodeRef}><div data-package-reordering={isDragging || undefined} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`flex items-center rounded-md bg-background ${isDragging ? 'relative z-10 shadow-md ring-1 ring-border' : ''}`}>
    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={'Reorder ' + label}
      disabled={disabled} className="shrink-0 touch-none cursor-grab rounded p-1.5 text-muted-foreground hover:bg-accent focus-visible:ring-2 active:cursor-grabbing">
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
    {children}
  </div></div>;
}

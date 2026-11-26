import { createContext, useContext, useState, type ReactNode, type KeyboardEvent } from 'react';
import { DndContext, PointerSensor, closestCenter, type CollisionDetection, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
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

const KeyboardOrder = createContext<{
  ids: string[];
  labels: ReadonlyMap<string, string>;
  move(from: string, to: string, keyboard: boolean): void;
} | null>(null);

export function PackageDocumentOrder({ ids, labels, disabled, onMove, children }: {
  ids: string[]; labels: ReadonlyMap<string, string>; disabled: boolean; onMove(from: string, to: string, keyboard: boolean): void; children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const name = (id: string | number) => labels.get(String(id)) ?? 'Document';
  return <KeyboardOrder.Provider value={{ ids, labels, move: onMove }}><DndContext sensors={sensors} accessibility={{ announcements: {
    onDragStart: ({ active }) => 'Moving ' + name(active.id) + '.',
    onDragOver: ({ over }) => over ? 'Drop at position ' + (ids.indexOf(String(over.id)) + 1) + ', ' + name(over.id) + '.' : 'Outside the document list.',
    onDragEnd: ({ active, over }) => over ? name(active.id) + ' dropped at position ' + (ids.indexOf(String(over.id)) + 1) + '.' : 'Order unchanged.',
    onDragCancel: () => 'Order unchanged.',
  } }} collisionDetection={documentUnderPointer} onDragEnd={({ active, over }) => {
    if (!disabled && over && active.id !== over.id) onMove(String(active.id), String(over.id), false);
  }}><SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext></DndContext></KeyboardOrder.Provider>;
}

export function PackageOrderRow({ id, label, disabled, children }: { id: string; label: string; disabled: boolean; children: ReactNode }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
  const order = useContext(KeyboardOrder);
  const [position, setPosition] = useState<number | null>(null);
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!order || disabled) return;
    const activate = event.key === ' ' || event.key === 'Enter';
    if (!activate && (position === null || !['ArrowUp', 'ArrowDown', 'Escape'].includes(event.key))) return;
    event.preventDefault();
    event.stopPropagation();
    if (activate) {
      if (event.repeat) return;
      if (position === null) setPosition(order.ids.indexOf(id));
      else {
        setPosition(null);
        const target = order.ids[position];
        if (target && target !== id) order.move(id, target, true);
      }
    } else if (event.key === 'Escape') setPosition(null);
    else setPosition(current => Math.max(0, Math.min(order.ids.length - 1, (current ?? 0) + (event.key === 'ArrowDown' ? 1 : -1))));
  }
  return <div ref={setNodeRef}><div data-package-reordering={isDragging || position !== null || undefined} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`flex items-center rounded-md bg-background ${isDragging ? 'relative z-10 shadow-md ring-1 ring-border' : ''}`}>
    <button type="button" ref={setActivatorNodeRef} data-package-order-handle={id} {...attributes} {...listeners} onKeyDown={keyDown} onBlur={() => setPosition(null)}
      aria-pressed={position !== null || isDragging} aria-label={'Reorder ' + label}
      disabled={disabled} className="shrink-0 touch-none cursor-grab rounded p-1.5 text-muted-foreground hover:bg-accent focus-visible:ring-2 active:cursor-grabbing">
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
    {children}
  </div>
    {position !== null && order && <p className="px-2 py-1 text-xs text-muted-foreground" role="status">Drop at position {position + 1}, {order.labels.get(order.ids[position])}.</p>}
  </div>;
}

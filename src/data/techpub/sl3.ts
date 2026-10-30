import { z } from 'zod';
import type { Paragraph } from '@/types/document';

export const SL3_PORTIONS = ['U', 'CUI', 'FOUO', 'C', 'S', 'TS'] as const;
const portion = z.enum(SL3_PORTIONS).default('U');

export const SL3_CATEGORIES = {
  ssri: 'Supply System Responsibility Items',
  collateral: 'Collateral Materiel',
  uuri: 'Using Unit Responsibility Items',
} as const;

export const sl3Schema = z.object({
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  technicalData: z.string().default(''),
  technicalPortion: portion,
  sequencingNote: z.string().default(''),
  sequencingPortion: portion,
  showFigureReference: z.boolean().default(false),
  showModel: z.boolean().default(false),
  endItemFigureId: z.string().default(''),
  notes: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
        portionMarking: portion,
      }),
    )
    .default([]),
  components: z
    .array(
      z.object({
        id: z.string().min(1),
        portionMarking: portion,
        category: z.enum(['ssri', 'collateral', 'uuri']),
        parentId: z.string().default(''),
        nomenclature: z.string().default(''),
        description: z.string().default(''),
        nsn: z.string().default(''),
        tamcn: z.string().default(''),
        idNumber: z.string().default(''),
        partNumber: z.string().default(''),
        cage: z.string().default(''),
        unit: z.string().default('EA'),
        quantity: z.string().default(''),
        model: z.string().default(''),
        figureReference: z.string().default(''),
        figureId: z.string().default(''),
        noteIds: z.array(z.string()).default([]),
        serialized: z.boolean().default(false),
      }),
    )
    .default([]),
});

export type Sl3Data = z.infer<typeof sl3Schema>;
export type Sl3Component = Sl3Data['components'][number];
export const emptySl3 = (): Sl3Data => sl3Schema.parse({});
export const newSl3Component = (id: string): Sl3Component =>
  sl3Schema.shape.components.unwrap().element.parse({ id, category: 'ssri' });

/** Include structured text in publication-wide classification checks. */
export function sl3Portions(data: Sl3Data): Paragraph[] {
  return [
    {
      text: data.technicalData,
      level: 0,
      portionMarking: data.technicalPortion,
    },
    {
      text: data.sequencingNote,
      level: 0,
      portionMarking: data.sequencingPortion,
    },
    ...data.notes.map((note) => ({
      text: note.text,
      level: 0,
      portionMarking: note.portionMarking,
    })),
    ...data.components.map((item) => ({
      text: JSON.stringify(item),
      level: 0,
      portionMarking: item.portionMarking,
    })),
  ];
}

/** Category ordering is fixed; author order within each category is preserved. */
export function orderedSl3Components(data: Sl3Data): Sl3Component[] {
  return Object.keys(SL3_CATEGORIES).flatMap((category) =>
    data.components.filter((item) => item.category === category),
  );
}

/** Illustrations are numbered by their first use in the publication. */
export function sl3FigureIds(data: Sl3Data): string[] {
  return [
    ...new Set(
      [
        data.endItemFigureId,
        ...orderedSl3Components(data).map((item) => item.figureId),
      ].filter(Boolean),
    ),
  ];
}

export function sl3GroupIds(id: string, items: Sl3Component[]): Set<string> {
  const group = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items)
      if (group.has(item.parentId) && !group.has(item.id)) {
        group.add(item.id);
        changed = true;
      }
  }
  return group;
}

/** Move the entire subtree so its children cannot be stranded by reordering. */
export function moveSl3Group(
  data: Sl3Data,
  id: string,
  direction: -1 | 1,
): Sl3Component[] {
  const items = orderedSl3Components(data);
  const item = items.find((p) => p.id === id);
  if (!item) return items;
  const siblings = items.filter(
    (p) => p.parentId === item.parentId && p.category === item.category,
  );
  const target = siblings[siblings.indexOf(item) + direction];
  if (!target) return items;
  const group = sl3GroupIds(id, items),
    targetGroup = sl3GroupIds(target.id, items);
  const remaining = items.filter((p) => !group.has(p.id));
  const at =
    direction < 0
      ? remaining.findIndex((p) => p.id === target.id)
      : remaining.reduce(
          (last, p, i) => (targetGroup.has(p.id) ? i + 1 : last),
          0,
        );
  remaining.splice(at, 0, ...items.filter((p) => group.has(p.id)));
  return remaining;
}

export function assignSl3Parent(
  data: Sl3Data,
  id: string,
  parentId: string,
): Sl3Component[] {
  const items = orderedSl3Components(data);
  const item = items.find((p) => p.id === id);
  if (!item) return items;
  const group = sl3GroupIds(id, items);
  if (!canAssignSl3Parent(data, id, parentId)) return items;
  let target = items.find((p) => p.id === parentId);
  if (parentId && (!target || target.category !== item.category)) return items;
  if (!parentId) {
    target = item;
    const seen = new Set<string>();
    while (target.parentId && !seen.has(target.id)) {
      seen.add(target.id);
      const parent = items.find((p) => p.id === target!.parentId);
      if (!parent) break;
      target = parent;
    }
  }
  const remaining = items.filter((p) => !group.has(p.id));
  const targetGroup = target
    ? sl3GroupIds(target.id, items)
    : new Set<string>();
  const at = remaining.reduce(
    (last, p, i) => (targetGroup.has(p.id) ? i + 1 : last),
    remaining.findIndex((p) => p.category === item.category),
  );
  remaining.splice(
    Math.max(0, at),
    0,
    ...items
      .filter((p) => group.has(p.id))
      .map((p) => (p.id === id ? { ...p, parentId } : p)),
  );
  return remaining;
}

export function canAssignSl3Parent(
  data: Sl3Data,
  id: string,
  parentId: string,
): boolean {
  const items = orderedSl3Components(data);
  const item = items.find((p) => p.id === id);
  if (!item) return false;
  const group = sl3GroupIds(id, items);
  const parent = items.find((p) => p.id === parentId);
  if (
    parentId &&
    (!parent || parent.category !== item.category || group.has(parentId))
  )
    return false;
  const originalDepth = sl3Depth(item, items);
  const height = Math.max(
    ...items
      .filter((p) => group.has(p.id))
      .map((p) => sl3Depth(p, items) - originalDepth),
  );
  return (parent ? sl3Depth(parent, items) + 1 : 0) + height <= 2;
}

export function sl3Depth(
  item: Sl3Component,
  components: Sl3Component[],
): number {
  const seen = new Set([item.id]);
  let depth = 0;
  while (item.parentId) {
    const parent = components.find((p) => p.id === item.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    depth++;
    item = parent;
  }
  return depth;
}

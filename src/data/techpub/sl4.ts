import { z } from 'zod';
import type { Paragraph } from '@/types/document';
import { sl3Schema } from './sl3';

const portion = z.enum(['U', 'CUI', 'FOUO', 'C', 'S', 'TS']).default('U');
const id = z.string().trim().min(1);

export const sl4PartSchema = z.object({
  kind: z.literal('part'),
  id,
  portionMarking: portion,
  parentId: z.string().trim().default(''),
  nomenclature: z.string().default(''),
  description: z.string().default(''),
  smr: z.string().default(''),
  nsn: z.string().default(''),
  cage: z.string().default(''),
  partNumber: z.string().default(''),
  mandatoryReplacement: z.boolean().default(false),
  economicReplacement: z.boolean().default(false),
  unit: z.string().default('EA'),
  quantityPerApplication: z.string().default(''),
  // Consolidated equipment quantity is entered by the author, not calculated.
  quantityPerEquipment: z.string().default(''),
  // An author decision; an SMR string alone is not used to infer this status.
  maintenancePart: z.boolean().optional(),
  isKit: z.boolean().default(false),
  relationship: z.object({
    kind: z.enum(['same_as', 'fabricated_from', 'assembled_from']),
    itemIds: z.array(id),
  }).strict().optional(),
  figureId: z.string().trim().default(''),
  circuitSymbols: z.array(z.string()).default([]),
}).strict();

export const sl4RowSchema = z.discriminatedUnion('kind', [
  sl4PartSchema,
  z.object({ kind: z.literal('heading'), id, text: z.string(), majorCombination: z.boolean().optional(), portionMarking: portion }).strict(),
  z.object({ kind: z.literal('blank'), id }).strict(),
]);

/** Draft content only. Cover/authentication remain shared publication fields. */
export const sl4Schema = z.object({
  sourceManual: z.string().default(''),
  standaloneRationale: z.string().default(''),
  cutoffDate: z.string().default(''),
  contextPortion: portion,
  definitions: sl3Schema.shape.definitions,
  artwork: sl3Schema.shape.artwork,
  rowsPerSheet: z.number().int().min(1).max(18).default(18),
  indexRowsPerPanel: z.number().int().min(1).max(55).default(55),
  endItemFigureId: z.string().trim().default(''),
  circuitIndex: z.object({
    mode: z.enum(['not_applicable', 'include', 'omitted_excessive']).default('not_applicable'),
    reason: z.string().default(''),
  }).strict().prefault({}),
  cages: z.array(z.object({
    id,
    code: z.string(),
    name: z.string(),
    address: z.string().default(''),
    portionMarking: portion,
  }).strict()).default([]),
  notes: z.array(z.object({ id, text: z.string(), portionMarking: portion }).strict()).default([]),
  revisions: z.array(z.object({
    id,
    revision: z.string(),
    date: z.string(),
    description: z.string(),
    enteredBy: z.string(),
    portionMarking: portion,
  }).strict()).default([]),
  rows: z.array(sl4RowSchema).default([]),
}).strict();

export type Sl4Data = z.infer<typeof sl4Schema>;
export type Sl4Part = z.infer<typeof sl4PartSchema>;
export type Sl4Row = z.infer<typeof sl4RowSchema>;
export const emptySl4 = (): Sl4Data => sl4Schema.parse({});
export const newSl4Part = (partId: string): Sl4Part => sl4PartSchema.parse({ kind: 'part', id: partId });
export const SL4_NSN_PATTERN = /^(\d{13}|\d{4}-\d{2}-\d{3}-\d{4})$/;

/** Author order is the top-down breakdown; headings/blanks have no item number. */
export function numberedSl4Parts(rows: readonly Sl4Row[]) {
  return rows.filter((row): row is Sl4Part => row.kind === 'part')
    .map((part, index) => ({ ...part, itemNumber: index + 1 }));
}

/** Include every structured text block in whole-publication classification checks. */
export function sl4Portions(data: Sl4Data, paragraphs: Paragraph[] = []): Paragraph[] {
  return [
    ...[data.sourceManual, data.standaloneRationale, data.cutoffDate, data.circuitIndex.reason]
      .map((text) => ({ text, level: 0, portionMarking: data.contextPortion })),
    ...[...data.definitions, ...data.cages, ...data.notes, ...data.revisions, ...data.rows.filter((row) => row.kind !== 'blank')]
      .map((block) => ({ text: JSON.stringify(block), level: 0, portionMarking: block.portionMarking })),
    ...data.artwork.map((artwork) => ({ text: artwork.labels.map((label) => label.text).join(' '), level: 0,
      portionMarking: paragraphs.find((p) => p.referenceId === artwork.figureId)?.figure?.portionMarking ?? data.contextPortion })),
  ];
}

export function sl4FigureIds(data: Sl4Data): string[] {
  return [...new Set([data.endItemFigureId, ...data.rows.flatMap((row) => row.kind === 'part' ? [row.figureId] : [])].filter(Boolean))];
}

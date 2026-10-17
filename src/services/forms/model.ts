import { z } from 'zod';
import { assertFormConfig, type FormConfig, type FormValues, type FormRows } from '@/types/formConfig';

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => !Object.hasOwn(Object.prototype, value), 'Reserved object property');
const box = z.object({ left: z.number().nonnegative(), top: z.number().positive(), width: z.number().positive(), height: z.number().positive() }).strict();
const option = z.object({ id: z.string().min(1), label: z.string().min(1), legacyKey: z.string().optional() }).strict();
const field = z.object({
  kind: z.enum(['text', 'identifier', 'date', 'decimal', 'boolean', 'singleChoice', 'multipleChoice', 'signature']),
  label: z.string().min(1), requiredAt: z.enum(['export', 'sign']).optional(),
  options: z.array(option).optional(), multiline: z.boolean().optional(),
  sourceIds: z.array(z.string()).optional(), legacyKeys: z.array(z.string()).optional(),
}).strict();
const placement = z.object({
  fieldId: id, optionId: z.string().min(1).optional(), page: z.number().int().positive(), box,
  appearance: z.enum(['text', 'mark']), overflow: z.enum(['error', 'shrink']).default('shrink'),
  dateFormat: z.enum(['iso', 'mdy', 'dmy']).optional(),
}).strict();
const page = z.object({
  file: z.string().regex(/^[A-Za-z0-9_.-]+\.pdf$/),
  width: z.number().positive(), height: z.number().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export const formDefinitionSchema = z.object({
  schemaVersion: z.literal(2), formId: id, label: z.string().min(1),
  definitionRevision: z.string().min(1), templateRevision: z.string().min(1),
  directory: z.string().min(1).refine(v => !v.startsWith('/') && !v.split('/').some(s => !s || s === '..' || s === '.')),
  pages: z.array(page).min(1), fields: z.record(id, field),
  placements: z.array(placement),
  sections: z.array(z.object({ id, title: z.string().min(1), fields: z.array(id), editor: z.enum(['list', 'checklist']).optional() }).strict()),
  rowGroups: z.record(id, z.object({
    title: z.string().min(1), columns: z.record(id, field),
    legacyKeys: z.array(z.string()).optional(),
    // Each printed row has its own placements, including irregular tables.
    rows: z.array(z.array(placement).min(1)).min(1),
    editor: z.enum(['grid', 'cards']).optional(),
  }).strict()),
}).strict();
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type AnswerField = z.infer<typeof field>;
export type Placement = z.infer<typeof placement>;
export type Answer = string | boolean | string[];
export type Answers = Record<string, Answer>;
export interface AnswerRow { id: string; answers: Answers }
export type AnswerRows = Record<string, AnswerRow[]>;
export interface FormInstance {
  definition: FormDefinition;
  answers: Answers;
  rows: AnswerRows;
  answerRevision: number;
}
export interface FormDiagnostic { path: string; code: string; message: string; severity: 'error' | 'warning' }

export function compileFormDefinition(input: unknown): FormDefinition {
  const d = formDefinitionSchema.parse(input);
  const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
  if (d.formId === 'navmc_10274' || d.formId === 'navmc_118_11') fail('formId', 'reserved for a built-in form');
  if (!Object.keys(d.fields).length && !Object.keys(d.rowGroups).length) fail('fields', 'form has no answers');
  if (new Set(d.pages.map(p => p.file)).size !== d.pages.length) fail('pages', 'duplicate page filename');
  const checkFields = (fields: Record<string, AnswerField>, path: string) => {
    for (const [key, f] of Object.entries(fields)) {
      const choices = f.kind === 'singleChoice' || f.kind === 'multipleChoice';
      if (choices !== Boolean(f.options?.length)) fail(`${path}.${key}`, 'choices require options; other fields cannot have options');
      if (f.options && new Set(f.options.map(o => o.id)).size !== f.options.length) fail(`${path}.${key}`, 'duplicate option IDs');
      if (f.kind === 'signature' && f.requiredAt === 'export') fail(`${path}.${key}`, 'signatures are required at signing');
    }
  };
  const checkPlacements = (items: Placement[], fields: Record<string, AnswerField>, path: string) => {
    for (const [i, p] of items.entries()) {
      const f = fields[p.fieldId];
      if (!Object.hasOwn(fields, p.fieldId)) fail(`${path}.${i}`, 'unknown field');
      const pg = d.pages[p.page - 1];
      if (!pg) fail(`${path}.${i}`, 'unknown page');
      const outsidePage = p.box.left + p.box.width > pg.width + 0.1
        || p.box.top > pg.height + 0.1
        || p.box.top - p.box.height < -0.1;
      if (outsidePage) fail(`${path}.${i}`, 'box outside page');
      if (p.optionId && !f.options?.some(o => o.id === p.optionId)) fail(`${path}.${i}`, 'unknown option');
      if (p.appearance === 'mark' && f.kind !== 'boolean' && !p.optionId) fail(`${path}.${i}`, 'choice marks require an option');
      if (p.optionId && p.appearance !== 'mark') fail(`${path}.${i}`, 'option placements must be marks');
      if (p.dateFormat && f.kind !== 'date') fail(`${path}.${i}`, 'date formatting requires a date field');
    }
    for (const [key, f] of Object.entries(fields)) {
      if (f.kind === 'signature') continue;
      const bound = items.filter(p => p.fieldId === key);
      if (!bound.length) fail(path, `${key} has no placement`);
      if (f.options && bound.every(p => p.appearance === 'mark')) {
        for (const o of f.options) if (!bound.some(p => p.optionId === o.id)) fail(path, `${key}.${o.id} has no placement`);
      }
    }
  };
  checkFields(d.fields, 'fields');
  checkPlacements(d.placements, d.fields, 'placements');
  const listed = new Set<string>();
  const sections = new Set<string>();
  for (const s of d.sections) {
    if (s.id === 'type') fail('sections', 'type is reserved for document navigation');
    if (sections.has(s.id)) fail('sections', 'duplicate section ID');
    sections.add(s.id);
    for (const key of s.fields) {
      if (!Object.hasOwn(d.fields, key) || listed.has(key)) fail(`sections.${s.id}`, `unknown or repeated field ${key}`);
      listed.add(key);
    }
  }
  for (const key of Object.keys(d.fields)) if (!listed.has(key)) fail('sections', `${key} is not editable`);
  for (const [key, g] of Object.entries(d.rowGroups)) {
    if (key === 'type' || Object.hasOwn(d.fields, key)) fail('rowGroups', 'row group conflicts with a field or document navigation');
    if (sections.has(key)) fail('rowGroups', 'row group conflicts with section ID');
    if (!Object.keys(g.columns).length) fail(`rowGroups.${key}`, 'row group has no columns');
    checkFields(g.columns, `rowGroups.${key}`);
    for (const [i, row] of g.rows.entries()) checkPlacements(row, g.columns, `rowGroups.${key}.${i}`);
  }
  return d;
}

function isEmptyAnswer(value: Answer | undefined): boolean {
  return value === undefined
    || (typeof value === 'string' && !value.trim())
    || (Array.isArray(value) && value.length === 0);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function validateAnswers(d: FormDefinition, answers: Answers, rows: AnswerRows, requireComplete = true): FormDiagnostic[] {
  const diagnostics: FormDiagnostic[] = [];
  const error = (path: string, code: string, message: string) => {
    diagnostics.push({ path, code, message, severity: 'error' });
  };
  const check = (fields: Record<string, AnswerField>, values: Answers, prefix: string) => {
    for (const key of Object.keys(values)) {
      if (!Object.hasOwn(fields, key)) error(prefix + key, 'unknown-answer', 'Unknown field');
    }
    for (const [key, field] of Object.entries(fields)) {
      const value = values[key];
      const path = prefix + key;
      if (isEmptyAnswer(value)) {
        if (requireComplete && field.requiredAt === 'export') {
          error(path, 'required', `${field.label} is required`);
        }
        continue;
      }
      if (field.kind === 'signature') {
        error(path, 'signature', 'Sign after export');
        continue;
      }
      if (field.kind === 'boolean') {
        if (typeof value !== 'boolean') error(path, 'type', 'Expected yes or no');
        continue;
      }
      const isOption = (value: string) => field.options?.some(option => option.id === value);
      if (field.kind === 'multipleChoice') {
        const valid = Array.isArray(value)
          && new Set(value).size === value.length
          && value.every(isOption);
        if (!valid) error(path, 'option', 'Invalid selection');
        continue;
      }
      if (typeof value !== 'string') {
        error(path, 'type', 'Expected text');
        continue;
      }
      if (field.kind === 'singleChoice' && !isOption(value)) {
        error(path, 'option', 'Invalid selection');
      }
      if (field.kind === 'decimal' && !/^-?\d+(\.\d+)?$/.test(value)) {
        error(path, 'decimal', 'Enter a decimal number');
      }
      if (field.kind === 'date' && !isValidDate(value)) {
        error(path, 'date', 'Enter a valid date');
      }
    }
  };
  check(d.fields, answers, '');
  for (const key of Object.keys(rows)) {
    if (!Object.hasOwn(d.rowGroups, key)) error(key, 'unknown-group', 'Unknown row group');
  }
  const rowIds = new Set<string>();
  for (const [key, group] of Object.entries(d.rowGroups)) {
    const entries = rows[key] ?? [];
    if (entries.length > group.rows.length) error(key, 'capacity', `The form holds ${group.rows.length} rows`);
    entries.forEach((row, index) => {
      if (!row.id || rowIds.has(row.id)) {
        error(`${key}.${index}`, 'row-id', 'Missing or duplicate row ID');
      }
      rowIds.add(row.id);
      check(group.columns, row.answers, `${key}.${index}.`);
    });
  }
  return diagnostics;
}

export function diagnosticText(d: FormDefinition, diagnostic: FormDiagnostic): string {
  const [key, row, column] = diagnostic.path.split('.');
  let label = 'Saved answer';
  if (Object.hasOwn(d.rowGroups, key)) {
    const group = d.rowGroups[key];
    const parts = [group.title];
    if (row !== undefined) parts.push(`row ${Number(row) + 1}`);
    if (Object.hasOwn(group.columns, column)) parts.push(group.columns[column].label);
    label = parts.join(', ');
  } else if (Object.hasOwn(d.fields, key)) {
    label = d.fields[key].label;
  }
  return `${label}: ${diagnostic.message}`;
}

export function formErrorSections(instance: FormInstance): string[] {
  const definition = instance.definition;
  const sections = new Set<string>();
  for (const error of validateAnswers(definition, instance.answers, instance.rows)) {
    const key = error.path.split('.')[0];
    if (Object.hasOwn(definition.rowGroups, key)) {
      sections.add(key);
    } else {
      const section = definition.sections.find(section => section.fields.includes(key));
      sections.add(section?.id ?? 'type');
    }
  }
  return [...sections];
}

export function adaptLegacyForm(config: FormConfig, sizes?: Array<{ width: number; height: number }>): FormDefinition {
  const c = assertFormConfig(config, config.id);
  const fields: FormDefinition['fields'] = {};
  const placements: Placement[] = [];
  const keys = new Map<string, string>();
  const convert = (f: FormConfig['fields'][string]): AnswerField => ({
    kind: f.type === 'checkbox' || f.type === 'radio' ? 'boolean' : f.type === 'choice' && f.options?.length ? 'singleChoice' : f.type === 'choice' ? 'text' : f.type,
    label: f.label || 'Field', multiline: f.multiline, sourceIds: f.sourceIds ?? (f.sourceId ? [f.sourceId] : undefined),
    requiredAt: f.required ? f.type === 'signature' ? 'sign' : 'export' : undefined,
    options: f.options?.map((label, i) => ({ id: f.optionIds?.[i] ?? label, label })),
  });
  for (const [key, f] of Object.entries(c.fields)) {
    const fieldId = f.type === 'radio' && f.group ? `radio_${Object.keys(c.fields).findIndex(k => c.fields[k].group === f.group)}` : key;
    keys.set(key, fieldId);
    if (f.type === 'radio' && f.group) {
      fields[fieldId] ??= { kind: 'singleChoice', label: f.groupLabel || f.group, options: [], sourceIds: [f.group] };
      fields[fieldId].options!.push({ id: f.sourceId ?? key, label: f.label || key, legacyKey: key });
      if (f.required) fields[fieldId].requiredAt = 'export';
    } else fields[fieldId] = { ...convert(f), legacyKeys: [key] };
    placements.push({ fieldId, optionId: f.type === 'radio' && f.group ? f.sourceId ?? key : undefined, page: f.page, box: f.box, appearance: f.type === 'radio' || f.type === 'checkbox' ? 'mark' : 'text', overflow: 'shrink' });
  }
  const listed = new Set<string>();
  const sections = c.sections.map((s, i) => ({ id: `section_${i}`, title: s.title, editor: s.editor, fields: s.fields.map(k => keys.get(k)!).filter(k => { if (listed.has(k)) return false; listed.add(k); return true; }) }));
  const missing = Object.keys(fields).filter(k => !listed.has(k));
  if (missing.length) sections.push({ id: 'unlisted', title: 'Other fields', fields: missing, editor: 'list' });
  const rowGroups: FormDefinition['rowGroups'] = {};
  for (const [key, g] of Object.entries(c.rowGroups ?? {})) rowGroups[key] = {
    title: g.title, editor: g.editor, legacyKeys: [key], columns: Object.fromEntries(Object.entries(g.columns).map(([k, f]) => [k, { ...convert(f), legacyKeys: [k] }])),
    rows: Array.from({ length: g.count }, (_, i) => Object.entries(g.columns).map(([fieldId, f]) => ({ fieldId, page: g.page, box: g.placements?.[i]?.[fieldId] ?? { ...f.box, top: f.box.top - g.rowStride * i }, appearance: f.type === 'checkbox' || f.type === 'radio' ? 'mark' : 'text', overflow: 'shrink' }))),
  };
  return compileFormDefinition({ schemaVersion: 2, formId: c.id, label: c.label, directory: c.directory, definitionRevision: 'legacy', templateRevision: 'legacy', pages: c.pages.map((file, i) => ({ file, ...(sizes?.[i] ?? { width: 612, height: 792 }) })), fields, placements, sections, rowGroups });
}

export function migrateLegacyAnswers(d: FormDefinition, values: FormValues, rows: FormRows): { answers: Answers; rows: AnswerRows } {
  const migrate = (fields: Record<string, AnswerField>, source: FormValues): Answers => {
    const result: Answers = {};
    const known = new Set(Object.entries(fields).flatMap(([key, f]) => [key, ...(f.legacyKeys ?? []), ...(f.options ?? []).flatMap(o => o.legacyKey ? [o.legacyKey] : [])]));
    for (const [key, value] of Object.entries(source)) if (!known.has(key) && value !== '') throw new Error(`No migration for legacy answer ${key}`);
    for (const [key, f] of Object.entries(fields)) {
      if (f.kind === 'signature') continue;
      if (f.options?.some(o => o.legacyKey)) {
        const picked = f.options.filter(o => source[o.legacyKey ?? o.id] === true);
        if (picked.length > 1) throw new Error(`${f.label}: conflicting legacy radio answers`);
        if (picked[0]) result[key] = picked[0].id;
      } else if (source[key] !== undefined || f.legacyKeys?.some(k => source[k] !== undefined)) {
        const value = source[key] ?? source[f.legacyKeys!.find(k => source[k] !== undefined)!];
        result[key] = f.kind === 'singleChoice' ? f.options?.find(o => o.label === value)?.id ?? String(value) : value;
      }
    }
    return result;
  };
  const migratedRows: AnswerRows = {};
  for (const [key, entries] of Object.entries(rows)) {
    const target = Object.keys(d.rowGroups).find(k => k === key || d.rowGroups[k].legacyKeys?.includes(key));
    if (!target) { if (entries.length) throw new Error(`No migration for row group ${key}`); continue; }
    if (migratedRows[target]) throw new Error(`Ambiguous migration for row group ${key}`);
    migratedRows[target] = entries.map((v, i) => ({ id: `legacy_${key}_${i}`, answers: migrate(d.rowGroups[target].columns, v) }));
  }
  return { answers: migrate(d.fields, values), rows: migratedRows };
}

const answerSchema = z.union([z.string(), z.boolean(), z.array(z.string())]);
const answersSchema = z.record(z.string(), answerSchema);
const savedRowSchema = z.object({
  id: z.string().min(1),
  answers: answersSchema,
}).strict();
const formInstanceSchema = z.object({
  definition: z.unknown(),
  answers: answersSchema,
  rows: z.record(z.string(), z.array(savedRowSchema)),
  answerRevision: z.number().int().nonnegative(),
}).strict();

export function parseFormInstance(value: unknown): FormInstance {
  const raw = formInstanceSchema.parse(value);
  const definition = compileFormDefinition(raw.definition);
  return { ...raw, definition };
}

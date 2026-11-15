import type { SerializedSession } from '@/stores/documentStore';
import {
  parseFormInstance, diagnosticText, validateAnswers,
  type Answer, type AnswerField, type AnswerRows, type FormDefinition, type FormInstance,
} from '@/services/forms/model';

export const MAX_CONFIGURED_BATCH_REPEAT_BYTES = 256 * 1024;
export const MAX_CONFIGURED_BATCH_REPEAT_CELLS = 2000;
export const MAX_CONFIGURED_BATCH_REPEAT_ROWS = 200;
export const MAX_CONFIGURED_BATCH_REPEAT_TOTAL_BYTES = 1024 * 1024;

export interface ConfiguredBatchField {
  id: string;
  label: string;
  kind: AnswerField['kind'] | 'rows';
  guidance: string;
}
export interface ConfiguredBatchMapping {
  fields: ConfiguredBatchField[];
  issues: string[];
}

/** Roster values are explicit answers; another person's saved values are never defaults. */
export function configuredBatchMapping(instance: FormInstance): ConfiguredBatchMapping {
  const fields: ConfiguredBatchField[] = [];
  const issues: string[] = [];
  let validated: FormInstance;
  try {
    validated = parseFormInstance(instance);
  } catch {
    return { fields, issues: ['The selected form is incomplete or invalid. Open a valid form and start a new batch before mapping a roster.'] };
  }
  const definition = validated.definition;
  for (const [id, field] of Object.entries(definition.fields)) {
    if (field.kind === 'signature') {
      const answer = validated.answers[id];
      if (answer !== undefined && answer !== '') issues.push(`${field.label}: clear the signature answer and sign each PDF after export.`);
      continue;
    }
    const guidance = field.kind === 'date' ? 'YYYY-MM-DD'
      : field.kind === 'decimal' ? 'Decimal number, without commas'
      : field.kind === 'boolean' ? 'yes / no or true / false'
      : field.kind === 'singleChoice' ? field.options!.map(option => `${option.label} (${option.id})`).join('; ')
      : field.kind === 'multipleChoice' ? `JSON array of option IDs or unique labels, for example ${JSON.stringify(field.options!.slice(0, 2).map(option => option.id))}; [] selects none. Options: ${field.options!.map(option => `${option.label} (${option.id})`).join('; ')}`
      : field.kind === 'identifier' ? 'Text; retain leading zeros' : 'Text';
    fields.push({ id, label: field.label, kind: field.kind, guidance });
  }
  for (const [id, group] of Object.entries(definition.rowGroups)) {
    for (const row of validated.rows[id] ?? [])
      for (const [columnId, field] of Object.entries(group.columns))
        if (field.kind === 'signature' && row.answers[columnId] !== undefined && row.answers[columnId] !== '')
          issues.push(`${group.title}, ${field.label}: clear the signature answer and sign each PDF after export.`);
    const columns = Object.entries(group.columns).filter(([, field]) => field.kind !== 'signature');
    if (!columns.length) continue;
    fields.push({ id, label: group.title, kind: 'rows', guidance: `JSON array of row objects; at most ${Math.min(group.rows.length, MAX_CONFIGURED_BATCH_REPEAT_ROWS)} rows. Columns: ${columns.map(([key, field]) => `${key} (${field.label}: ${field.kind}${field.options ? `; ${field.options.map(option => `${option.label}=${option.id}`).join(', ')}` : ''})`).join('; ')}. Text, identifiers, dates, decimals and single choices use strings; booleans use true/false; multiple selections use string arrays. Blank or [] supplies no rows. Signature columns stay blank.` });
  }
  if (!fields.length) issues.push('This form has no supported roster fields.');
  return { fields, issues };
}

function resolveChoice(field: AnswerField, value: string): string {
  const exact = field.options!.find(option => option.id === value);
  if (exact) return exact.id;
  const labels = field.options!.filter(option => option.label.toLocaleLowerCase() === value.toLocaleLowerCase());
  if (labels.length === 1) return labels[0].id;
  throw new Error('Enter an option ID or an unambiguous option label');
}

/** Parse one roster cell using the same answer types as the individual form editor. */
export function parseConfiguredBatchAnswer(field: AnswerField, raw: string): Answer {
  const value = raw.trim();
  if (field.kind === 'boolean') {
    if (/^(true|yes)$/i.test(value)) return true;
    if (/^(false|no)$/i.test(value)) return false;
    throw new Error('Enter yes, no, true, or false');
  }
  if (field.kind === 'singleChoice') {
    return resolveChoice(field, value);
  }
  if (field.kind === 'multipleChoice') {
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch { throw new Error('Enter a JSON array of option IDs or unique labels, such as ["first","second"]'); }
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
      throw new Error('Enter a JSON array containing only option IDs or unique labels as strings');
    }
    if (parsed.length > field.options!.length) throw new Error(`Select at most ${field.options!.length} distinct options`);
    const selected = parsed.map(item => resolveChoice(field, item));
    if (new Set(selected).size !== selected.length) throw new Error('Select each option only once');
    return selected;
  }
  // Text spacing is user content. Typed values and identifiers have surrounding whitespace removed.
  return field.kind === 'text' ? raw : value;
}

/** JSON.parse alone silently replaces duplicate object keys, including escaped keys. */
function assertDistinctObjectKeys(raw: string): void {
  const stack: Array<{ object: boolean; keys: Set<string>; key: boolean }> = [];
  for (const match of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\],:]/gs)) {
    const token = match[0];
    if (token === '{' || token === '[') stack.push({ object: token === '{', keys: new Set(), key: true });
    else if (token === '}' || token === ']') stack.pop();
    else {
      const current = stack.at(-1);
      if (current?.object && token === ',') current.key = true;
      else if (current?.object && current.key && token.startsWith('"')) {
        const key = JSON.parse(token) as string;
        if (current.keys.has(key)) throw new Error(`Duplicate row column: ${key}`);
        current.keys.add(key);current.key = false;
      }
    }
  }
}

/** One roster cell contains explicit rows; source answers and row IDs are never copied. */
export function parseConfiguredBatchRows(groupId: string, group: FormDefinition['rowGroups'][string], raw: string): AnswerRows[string] {
  if (new TextEncoder().encode(raw).byteLength > MAX_CONFIGURED_BATCH_REPEAT_BYTES)
    throw new Error('Repeating-row cells are limited to 256 KiB.');
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error('Enter a JSON array of row objects, such as [{"name":"Example"}]'); }
  if (!Array.isArray(value)) throw new Error('Enter a JSON array of row objects');
  const capacity = Math.min(group.rows.length, MAX_CONFIGURED_BATCH_REPEAT_ROWS);
  if (value.length > capacity) throw new Error(`The form holds at most ${capacity} roster rows; no rows were dropped`);
  assertDistinctObjectKeys(raw);
  let cells = 0;
  return value.map((row: unknown, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Row ${index + 1}: enter an answer object`);
    const answers: FormInstance['answers'] = {};
    for (const [id, answer] of Object.entries(row)) {
      if (!Object.hasOwn(group.columns, id)) throw new Error(`Row ${index + 1}: unknown column ${id}`);
      const field = group.columns[id];
      if (field.kind === 'signature') throw new Error(`Row ${index + 1}, ${field.label}: sign after export; signature columns cannot be mapped`);
      if (++cells > MAX_CONFIGURED_BATCH_REPEAT_CELLS) throw new Error(`Repeating-row cells support at most ${MAX_CONFIGURED_BATCH_REPEAT_CELLS} answers`);
      const correctType = field.kind === 'boolean' ? typeof answer === 'boolean'
        : field.kind === 'multipleChoice' ? Array.isArray(answer) && answer.every(item => typeof item === 'string')
        : typeof answer === 'string';
      if (!correctType) throw new Error(`Row ${index + 1}, ${field.label}: expected ${field.kind === 'boolean' ? 'true or false' : field.kind === 'multipleChoice' ? 'an array of option strings' : 'a string'}`);
      if (typeof answer === 'string' && !answer.trim()) continue;
      try { answers[id] = parseConfiguredBatchAnswer(field, typeof answer === 'string' ? answer : JSON.stringify(answer)); }
      catch (cause) { throw new Error(`Row ${index + 1}, ${field.label}: ${cause instanceof Error ? cause.message : 'Invalid answer'}`, { cause }); }
    }
    return { id: `batch_${groupId}_${index}`, answers };
  });
}

/** Render a normalized row summary only after the complete group passes validation. */
export function configuredBatchRowsPreview(definition: FormDefinition | undefined, groupId: string, raw: string): string | undefined {
  const group = definition?.rowGroups[groupId];
  if (!group || !raw.trim()) return undefined;
  try {
    const rows = parseConfiguredBatchRows(groupId, group, raw);
    if (validateAnswers(definition!, {}, { [groupId]: rows }).some(issue => issue.path.startsWith(`${groupId}.`) || issue.path === groupId)) return undefined;
    return rows.length ? rows.map((row, index) => `Row ${index + 1}: ${Object.entries(row.answers).map(([id, answer]) => {
      const field = group.columns[id];
      const selection = typeof answer === 'string' ? answer : JSON.stringify(answer);
      const value = field.kind === 'multipleChoice' ? configuredBatchSelectionPreview(field, selection) ?? ''
        : field.kind === 'singleChoice' ? `${field.options!.find(option => option.id === answer)!.label} (${answer})` : String(answer);
      return `${field.label}: ${value}`;
    }).join('; ') || 'No answers'}`).join(' | ') : 'No rows';
  } catch { return undefined; }
}

/** Invalid cells have row diagnostics instead of a misleading partial selection preview. */
export function configuredBatchSelectionPreview(field: AnswerField | undefined, raw: string): string | undefined {
  if (field?.kind !== 'multipleChoice' || typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const selected = parseConfiguredBatchAnswer(field, raw) as string[];
    return selected.length ? selected.map(id => `${field.options!.find(option => option.id === id)!.label} (${id})`).join('; ') : 'None';
  } catch { return undefined; }
}

/** Reuse one compiled field inventory while reviewing many roster rows. */
export function reviewConfiguredBatchRow(instance: FormInstance, values: Readonly<Record<string, string>>, mapping: ConfiguredBatchMapping = configuredBatchMapping(instance)): {
  answers: FormInstance['answers'];
  rows: AnswerRows;
  issues: string[];
} {
  const answers: FormInstance['answers'] = {};
  const rows: AnswerRows = {};
  const issues = [...mapping.issues];
  if (issues.length) return { answers, rows, issues };
  const repeatBytes = mapping.fields.filter(field => field.kind === 'rows').reduce((total, field) => total + (typeof values[field.id] === 'string' ? new TextEncoder().encode(values[field.id]).byteLength : 0), 0);
  if (repeatBytes > MAX_CONFIGURED_BATCH_REPEAT_TOTAL_BYTES) return { answers, rows, issues: ['A form supports at most 1 MiB of repeating-row input.'] };
  const fieldIds = new Set(mapping.fields.map(field => field.id));
  for (const key of Object.keys(values)) {
    if (!fieldIds.has(key)) issues.push(`Unknown roster field: ${key}`);
  }
  for (const field of mapping.fields) {
    const raw = Object.hasOwn(values, field.id) ? values[field.id] : '';
    if (typeof raw !== 'string') {
      issues.push(`${field.label}: Enter text in the roster cell`);
      continue;
    }
    if (!raw.trim()) continue;
    try {
      if (field.kind === 'rows') rows[field.id] = parseConfiguredBatchRows(field.id, instance.definition.rowGroups[field.id], raw);
      else answers[field.id] = parseConfiguredBatchAnswer(instance.definition.fields[field.id], raw);
    } catch (error) {
      issues.push(`${field.label}: ${error instanceof Error ? error.message : 'Invalid roster value'}`);
    }
  }
  const totalRows = Object.values(rows).reduce((total, group) => total + group.length, 0);
  if (totalRows > MAX_CONFIGURED_BATCH_REPEAT_ROWS) issues.push(`A form supports at most ${MAX_CONFIGURED_BATCH_REPEAT_ROWS} repeating rows`);
  const totalCells = Object.values(rows).flat().reduce((total, row) => total + Object.keys(row.answers).length, 0);
  if (totalCells > MAX_CONFIGURED_BATCH_REPEAT_CELLS) issues.push(`A form supports at most ${MAX_CONFIGURED_BATCH_REPEAT_CELLS} repeating-row answers`);
  issues.push(...validateAnswers(instance.definition, answers, rows).map(issue => diagnosticText(instance.definition, issue)));
  return { answers, rows, issues };
}

/** Cache immutable row objects without making React render hooks mutate their inputs. */
export function createConfiguredBatchRowReviewer(instance: FormInstance, mapping: ConfiguredBatchMapping): (row: { values: Record<string, string> }) => string[] {
  const cache = new WeakMap<object, string[]>();
  return row => {
    let issues = cache.get(row);
    if (!issues) {
      issues = reviewConfiguredBatchRow(instance, row.values, mapping).issues;
      cache.set(row, issues);
    }
    return issues;
  };
}

export function mapConfiguredBatchRow(instance: FormInstance, values: Readonly<Record<string, string>>): {
  instance: FormInstance;
  issues: string[];
} {
  const reviewed = reviewConfiguredBatchRow(instance, values);
  return {
    instance: { definition: structuredClone(instance.definition), answers: reviewed.answers, rows: reviewed.rows, answerRevision: instance.answerRevision + 1 },
    issues: reviewed.issues,
  };
}

export function applyConfiguredBatchRow(source: SerializedSession, values: Readonly<Record<string, string>>): SerializedSession {
  if (source.documentCategory !== 'forms' || !source.genericForm) throw new Error('Select a configured form before mapping a roster.');
  const mapped = mapConfiguredBatchRow(source.genericForm, values);
  if (mapped.issues.length) throw new Error(mapped.issues.join('\n'));
  return { ...structuredClone(source), genericForm: mapped.instance };
}

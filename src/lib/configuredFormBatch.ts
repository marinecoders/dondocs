import type { SerializedSession } from '@/stores/documentStore';
import {
  parseFormInstance, diagnosticText, validateAnswers,
  type Answer, type AnswerField, type FormInstance,
} from '@/services/forms/model';

export interface ConfiguredBatchField {
  id: string;
  label: string;
  kind: AnswerField['kind'];
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
  if (Object.keys(definition.rowGroups).length || Object.keys(validated.rows).length) {
    issues.push('Batch generation does not support repeating rows. Prepare this form individually.');
  }
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
  issues: string[];
} {
  const answers: FormInstance['answers'] = {};
  const issues = [...mapping.issues];
  if (issues.length) return { answers, issues };
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
      answers[field.id] = parseConfiguredBatchAnswer(instance.definition.fields[field.id], raw);
    } catch (error) {
      issues.push(`${field.label}: ${error instanceof Error ? error.message : 'Invalid roster value'}`);
    }
  }
  issues.push(...validateAnswers(instance.definition, answers, {}).map(issue => diagnosticText(instance.definition, issue)));
  return { answers, issues };
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
    instance: { definition: structuredClone(instance.definition), answers: reviewed.answers, rows: {}, answerRevision: instance.answerRevision + 1 },
    issues: reviewed.issues,
  };
}

export function applyConfiguredBatchRow(source: SerializedSession, values: Readonly<Record<string, string>>): SerializedSession {
  if (source.documentCategory !== 'forms' || !source.genericForm) throw new Error('Select a configured form before mapping a roster.');
  const mapped = mapConfiguredBatchRow(source.genericForm, values);
  if (mapped.issues.length) throw new Error(mapped.issues.join('\n'));
  return { ...structuredClone(source), genericForm: mapped.instance };
}

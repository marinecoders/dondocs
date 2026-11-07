import type { DocumentSnapshot } from '@/stores/historyStore';
import type { SerializedSession } from '@/stores/documentStore';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { parseFormInstance, type AnswerField, type FormInstance } from '@/services/forms/model';
import { canAppendEndorsement } from './appendedEndorsement';
import { captureDocumentRevision, copyCapturedDocument, copyCapturedSession, type CapturedDocument } from './capturedDocument';
import { projectSharedSession } from './documentSerialization';
import { ASSET_FIELD_POLICIES, DOCUMENT_FIELD_POLICIES, type FieldPolicies, type FieldRule } from './documentFieldPolicies';

export type FieldProjection = 'draft' | 'output' | 'share' | 'backup' | 'search' | 'substitution';
export type FieldPath = readonly (string | number)[];
export interface DocumentTextField {
  readonly path: FieldPath;
  readonly text: string;
  readonly label: string;
  readonly role: 'text' | 'control' | 'asset-name' | 'unknown';
  readonly datePurpose?: 'document';
}
/** A data port, with no editor actions or persistence methods. */
export type DocumentFieldSource = Pick<DocumentSnapshot, 'docType' | 'formData'>
  & Partial<Omit<DocumentSnapshot, 'docType' | 'formData'>>;

const technicalTypes = new Set(['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter']);
const executiveFields = new Set(['memorandumFor', 'attnLine', 'throughLine', 'coordination', 'preparedBy']);
const publicationFields = new Set(['publicationSigningDate', 'publicationClosedDates', 'nomenclature', 'publicationType',
  'controllingOffice', 'miUrgency', 'miCompletionDate', 'shortTitle', 'pcn', 'supersedure', 'exportRestricted', 'distReason', 'distDate']);
const letterheadFields = new Set(['department', 'unitLine1', 'unitLine2', 'unitAddress', 'sealType', 'letterheadColor', 'inReplyToText']);
const answerPolicies = {
  text: 'text', identifier: 'text', date: 'text', decimal: 'text', boolean: 'control',
  singleChoice: 'control', multipleChoice: 'control', signature: 'control',
} satisfies Record<AnswerField['kind'], 'text' | 'control'>;
const formPolicies = {
  definition: 'metadata', answerRevision: 'metadata', answers: 'answers', rows: 'rows',
} satisfies Record<keyof FormInstance, 'metadata' | 'answers' | 'rows'>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)
    ? value as Record<string, unknown> : undefined;
}
function owns(object: object, key: PropertyKey): boolean { return Object.hasOwn(object, key); }
function fieldLabel(path: FieldPath): string {
  const [root, index, key] = path;
  if (root === 'formData' && typeof index === 'string') {
    if (index === 'additionalEndorsements' && typeof key === 'number') return `Endorsement ${key + 2}: ${String(path[3])}`;
    if (index.startsWith('endorsement')) return `Endorsement 1: ${index}`;
    return `Form: ${index}${path.length > 2 ? ` / ${path.slice(2).map(part => typeof part === 'number' ? part + 1 : part).join(' / ')}` : ''}`;
  }
  if (typeof index === 'number') {
    if (root === 'paragraphs') {
      if (key === 'tableFootnotes' && typeof path[3] === 'number') return `Paragraph ${index + 1} footnote ${path[3] + 1}`;
      return `Paragraph ${index + 1}${key === 'header' ? ' heading' : ''}`;
    }
    if (root === 'references') return `Reference ${index + 1}${key === 'url' ? ' URL' : ''}`;
    if (root === 'copyTos') return `Copy To ${index + 1}`;
    if (root === 'distributions') return `Distribution ${index + 1}`;
    if (root === 'enclosures') return `Enclosure ${index + 1}${key === 'coverPageDescription' ? ' cover page' : ''}`;
  }
  return path.map(part => typeof part === 'number' ? String(part + 1) : part.replace(/([a-z])([A-Z])/g, '$1 $2')).join(' / ');
}

/** Select document-kind fields; format-specific output support remains a separate contract. */
function active(source: DocumentFieldSource, path: FieldPath, projection: FieldProjection): boolean {
  if (projection === 'draft' || projection === 'share' || projection === 'backup') return true;
  const root = path[0];
  if (source.documentCategory === 'forms') {
    if (root === 'docType' || root === 'formType' || root === 'documentCategory') return true;
    if (source.genericForm) return root === 'genericForm';
    if (root !== 'forms') return false;
    return path.length < 2 || path[1] === 'includeCoverPage' || path[1] === (source.formType === 'navmc_118_11' ? 'navmc11811' : 'navmc10274');
  }
  if (root === 'forms' || root === 'genericForm') return false;
  const config = owns(DOC_TYPE_CONFIG, source.docType) ? DOC_TYPE_CONFIG[source.docType] : undefined;
  if (!config) throw new Error(`Unknown document type: ${source.docType}`);
  const technical = technicalTypes.has(source.docType);
  if (root === 'paragraphs' && path[2] === 'figure' && projection !== 'search') return technical;
  if (source.docType === 'sl4' && projection !== 'search' && ['references', 'enclosures', 'copyTos', 'distributions'].includes(String(root))) return false;
  if (root === 'endItems') return technical;
  if (root === 'publicationTables') return source.docType === 'i_type';
  if (root === 'paragraphs' && ['sl3', 'sl4'].includes(source.docType) && typeof path[1] === 'number') {
    return Boolean(source.paragraphs?.[path[1]]?.figure);
  }
  if (source.docType === 'tm_ietm_front_matter' && ['paragraphs', 'references', 'enclosures', 'copyTos', 'distributions'].includes(String(root))) return false;
  if (root !== 'formData' || typeof path[1] !== 'string') return true;
  const key = path[1];
  if (key === 'manualFrontMatter') return source.docType === 'tm_ietm_front_matter';
  if (key === 'sl3' || key === 'sl4') return source.docType === key;
  if (key === 'body' && projection !== 'search') return false;
  if (publicationFields.has(key)) return technical;
  if (letterheadFields.has(key)) return config.letterhead || technical;
  if (/^(senior|junior)/.test(key) || key === 'moaSubject') return config.uiMode === 'moa';
  if (key.startsWith('jointMemo')) return config.uiMode === 'joint_memo';
  if (key.startsWith('joint')) return config.uiMode === 'joint' || config.uiMode === 'joint_memo';
  if (executiveFields.has(key)) return config.uiMode === 'executive';
  if (key === 'salutation' || key === 'complimentaryClose') return config.uiMode === 'business';
  if (key === 'endorsementOrdinal' || key.startsWith('basicLetter')) return source.docType.endsWith('_endorsement');
  if (key.startsWith('endorsement') || key === 'additionalEndorsements') {
    return canAppendEndorsement(source.docType) && (projection === 'search' || source.formData.appendEndorsement === true);
  }
  return true;
}

/** Inspect only this supplied revision. Returned paths and values cannot alias its objects. */
export function documentTextFields(source: DocumentFieldSource, projection: FieldProjection): readonly DocumentTextField[] {
  const fields: DocumentTextField[] = [];
  const transfer = projection === 'draft' || projection === 'share' || projection === 'backup';
  const ancestors = new WeakSet<object>();
  const emit = (value: string, path: FieldPath, role: DocumentTextField['role'], label = fieldLabel(path), datePurpose?: 'document') => {
    if (!active(source, path, projection)) return;
    if (projection === 'substitution' && role !== 'text') return;
    if ((projection === 'search' || projection === 'output') && role !== 'text') {
      const visibleChoice = projection === 'search' && role === 'control' && !['style', 'type'].includes(String(path[path.length - 1]));
      if (!visibleChoice && !(projection === 'search' && role === 'asset-name')) return;
    }
    fields.push(Object.freeze({ path: Object.freeze([...path]), text: value, label, role, ...(datePurpose ? { datePurpose } : {}) }));
  };
  const enter = (value: object, path: FieldPath, visit: () => void) => {
    if (path.length > 50 || ancestors.has(value)) throw new Error('Document fields contain a cycle or exceed the supported depth');
    ancestors.add(value);
    try { visit(); } finally { ancestors.delete(value); }
  };
  // Preserve unknown legacy data, but never infer that it is safe to transform.
  const unknown = (value: unknown, path: FieldPath, role: 'unknown' | 'control' = 'unknown') => {
    if (!transfer) return;
    if (typeof value === 'string') {
      if (!value.startsWith('data:image/')) emit(value, path, role);
      return;
    }
    if (!value || typeof value !== 'object' || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return;
    enter(value, path, () => {
      for (const [key, child] of Object.entries(value)) {
        unknown(child, [...path, Array.isArray(value) ? Number(key) : key], role);
      }
    });
  };
  const walkObject = (value: Record<string, unknown>, policies: FieldPolicies, path: FieldPath) => {
    for (const [key, child] of Object.entries(value)) {
      const next = [...path, key];
      if (owns(policies, key)) walk(child, policies[key], next);
      else unknown(child, next);
    }
  };
  const formAnswer = (value: unknown, field: AnswerField | undefined, path: FieldPath, location?: string) => {
    if (!field) { unknown(value, path); return; }
    const displayLabel = location ? `${location}: ${field.label}` : field.label;
    const freeText = answerPolicies[field.kind] === 'text';
    if (freeText && typeof value === 'string') { emit(value, path, 'text', displayLabel); return; }
    if (projection === 'search' && field.kind === 'boolean' && typeof value === 'boolean') {
      emit(value ? 'Yes' : 'No', path, 'text', displayLabel);
      return;
    }
    // Choice IDs are structural. Search/output inspect the displayed labels.
    if ((projection === 'search' || projection === 'output') && field.options) {
      const selected = Array.isArray(value) ? value : [value];
      selected.forEach((answer, index) => {
        const label = field.options?.find(option => option.id === answer)?.label
          ?? (projection === 'search' && typeof answer === 'string' ? answer : undefined);
        if (label) emit(label, Array.isArray(value) ? [...path, index] : path, 'text', displayLabel);
      });
    } else walk(value, Array.isArray(value) ? { items: 'control' } : 'control', path);
  };
  const walkForm = (value: unknown, path: FieldPath) => {
    const form = parseFormInstance(value);
    if (projection === 'search') {
      emit(form.definition.label, [...path, 'definition', 'label'], 'text', 'Form');
      for (const [key, field] of Object.entries(form.definition.fields)) {
        emit(field.label, [...path, 'definition', 'fields', key, 'label'], 'text', field.label);
      }
      for (const [group, config] of Object.entries(form.definition.rowGroups)) {
        emit(config.title, [...path, 'definition', 'rowGroups', group, 'title'], 'text', config.title);
        for (const [key, field] of Object.entries(config.columns)) {
          emit(field.label, [...path, 'definition', 'rowGroups', group, 'columns', key, 'label'], 'text', field.label);
        }
      }
    }
    for (const [key, value] of Object.entries(form)) {
      if (formPolicies[key as keyof FormInstance] === 'metadata') unknown(value, [...path, key], 'control');
    }
    for (const [key, answer] of Object.entries(form.answers)) {
      formAnswer(answer, owns(form.definition.fields, key) ? form.definition.fields[key] : undefined, [...path, 'answers', key]);
    }
    for (const [group, rows] of Object.entries(form.rows)) {
      rows.forEach((row, index) => {
        for (const [key, answer] of Object.entries(row.answers)) {
          const columns = owns(form.definition.rowGroups, group) ? form.definition.rowGroups[group].columns : undefined;
          const groupTitle = owns(form.definition.rowGroups, group) ? form.definition.rowGroups[group].title : group;
          formAnswer(answer, columns && owns(columns, key) ? columns[key] : undefined,
            [...path, 'rows', group, index, 'answers', key], `${groupTitle} row ${index + 1}`);
        }
      });
    }
  };
  const walk = (value: unknown, rule: FieldRule, path: FieldPath): void => {
    if (value === undefined || value === null || !active(source, path, projection)) return;
    if (rule === 'text' || rule === 'control' || rule === 'document-date') {
      if (typeof value === 'string') emit(value, path, rule === 'document-date' ? 'text' : rule, undefined, rule === 'document-date' ? 'document' : undefined);
      else if (transfer) unknown(value, path);
      return;
    }
    if (rule === 'label') {
      if (typeof value === 'string' && projection !== 'output' && projection !== 'substitution') emit(value, path, 'asset-name');
      return;
    }
    if (rule === 'identity') {
      if (transfer && typeof value === 'string') emit(value, path, 'control');
      return;
    }
    if (rule === 'binary' || rule === 'value') return;
    if (rule === 'asset') {
      const asset = record(value);
      if (transfer && asset) {
        enter(asset, path, () => walkObject(asset, ASSET_FIELD_POLICIES, path));
      }
      return;
    }
    if (rule === 'form') { walkForm(value, path); return; }
    if (typeof value !== 'object') { unknown(value, path); return; }
    enter(value, path, () => {
      if ('items' in rule) {
        if (!Array.isArray(value)) throw new Error(`Expected a field array at ${path.join('.')}`);
        value.forEach((child, index) => walk(child, rule.items, [...path, index]));
        return;
      }
      const data = record(value);
      if (!data) throw new Error(`Expected field data at ${path.join('.')}`);
      if ('entries' in rule) {
        for (const [key, child] of Object.entries(data)) walk(child, rule.entries, [...path, key]);
      } else if ('fields' in rule) walkObject(data, rule.fields, path);
      else {
        const variant = data.kind;
        if (typeof variant !== 'string' || !owns(rule.variants, variant)) throw new Error(`Unknown field variant at ${path.join('.')}`);
        walkObject(data, rule.variants[variant], path);
      }
    });
  };
  walkObject(source as unknown as Record<string, unknown>, DOCUMENT_FIELD_POLICIES, []);
  return Object.freeze(fields);
}

export function capturedTextFields(captured: CapturedDocument, projection: FieldProjection): readonly DocumentTextField[] {
  const session = copyCapturedSession(captured);
  return documentTextFields(projection === 'share' ? projectSharedSession(session) : session, projection);
}

function replaceText(source: object, fields: readonly DocumentTextField[], transform: (field: DocumentTextField) => string): void {
  for (const field of fields) {
    let parent: Record<string | number, unknown> = source as Record<string | number, unknown>;
    for (const segment of field.path.slice(0, -1)) {
      if (!owns(parent, segment) || !parent[segment] || typeof parent[segment] !== 'object') throw new Error('Field path does not belong to this document');
      parent = parent[segment] as Record<string | number, unknown>;
    }
    const key = field.path[field.path.length - 1];
    if (!owns(parent, key) || typeof parent[key] !== 'string') throw new Error('Field is not editable text');
    const text = transform(field);
    if (typeof text !== 'string') throw new Error('A document text transform must return a string');
    parent[key] = text;
  }
}

/** Mapping owns its result and preserves all values outside the substitution policy. */
export function mapSessionText(session: SerializedSession, transform: (field: DocumentTextField) => string): SerializedSession {
  const owned = structuredClone(session);
  replaceText(owned, documentTextFields(owned, 'substitution'), transform);
  return owned;
}

export function mapCapturedText(captured: CapturedDocument, transform: (field: DocumentTextField) => string): CapturedDocument {
  const owned = copyCapturedDocument(captured).document;
  replaceText(owned, documentTextFields(owned, 'substitution'), transform);
  return captureDocumentRevision(captured.source, owned);
}

/** Own an output model selected by the same policy used for field inspection.
 * Unknown legacy fields remain in the captured draft, outside render inputs.
 */
export function projectCapturedOutput(captured: CapturedDocument): CapturedDocument {
  const owned = copyCapturedDocument(captured).document;
  const project = (value: unknown, rule: FieldRule, path: FieldPath): unknown => {
    if (value === undefined || path.length > 0 && !active(owned, path, 'output')) return undefined;
    if (rule === 'form') {
      const form = parseFormInstance(value);
      const selectAnswers = (answers: FormInstance['answers'], fields: Record<string, AnswerField>) => Object.fromEntries(Object.entries(answers).filter(([key]) => owns(fields, key)));
      return { ...form, answers: selectAnswers(form.answers, form.definition.fields),
        rows: Object.fromEntries(Object.entries(form.rows).filter(([group]) => owns(form.definition.rowGroups, group)).map(([group, rows]) => [group,
          rows.map(row => ({ ...row, answers: selectAnswers(row.answers, form.definition.rowGroups[group].columns) })),
        ])),
      };
    }
    if (value === null || typeof rule === 'string') return value;
    if ('items' in rule) {
      if (!Array.isArray(value)) throw new Error('Invalid output array.');
      return value.map((child, index) => project(child, rule.items, [...path, index])).filter(child => child !== undefined);
    }
    const data = record(value);
    if (!data) throw new Error('Invalid output object.');
    if ('entries' in rule) return Object.fromEntries(Object.entries(data).map(([key, child]) => [key, project(child, rule.entries, [...path, key])]));
    const policies = 'fields' in rule ? rule.fields : typeof data.kind === 'string' && owns(rule.variants, data.kind) ? rule.variants[data.kind] : undefined;
    if (!policies) throw new Error('Invalid output variant.');
    return Object.fromEntries(Object.entries(data).flatMap(([key, child]) => {
      if (!owns(policies, key)) return [];
      const selected = project(child, policies[key], [...path, key]);
      return selected === undefined ? [] : [[key, selected]];
    }));
  };
  const selected = project(owned, { fields: DOCUMENT_FIELD_POLICIES }, []) as Partial<typeof owned>;
  return captureDocumentRevision(captured.source, {
    ...selected, docType: owned.docType, documentMode: owned.documentMode, documentCategory: owned.documentCategory, formType: owned.formType,
    formData: selected.formData ?? {}, references: selected.references ?? [], enclosures: selected.enclosures ?? [],
    paragraphs: selected.paragraphs ?? [], copyTos: selected.copyTos ?? [], distributions: selected.distributions ?? [],
    endItems: selected.endItems ?? [], publicationTables: selected.publicationTables ?? {},
  });
}

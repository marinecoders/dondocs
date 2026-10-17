import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import { useHistoryStore } from '@/stores/historyStore';
import { migrateLegacyAnswers, parseFormInstance, validateAnswers, type FormDefinition, type FormInstance } from './model';

export function startForm(definition: FormDefinition, migrate = true): void {
  const documents = useDocumentsStore.getState();
  documents.syncCurrent();
  const legacy = useFormStore.getState();
  const previous = Object.entries(useDocumentsStore.getState().docs)
    .filter(([, entry]) => entry.session.genericForm?.definition.formId === definition.formId)
    .sort(([, a], [, b]) => b.meta.updatedAt - a.meta.updatedAt)[0];
  if (migrate && previous) { documents.switchTo(previous[0]); return; }
  const data = migrate ? migrateLegacyAnswers(definition, legacy.configFormValues[definition.formId] ?? {}, legacy.configFormRows[definition.formId] ?? {}) : { answers: {}, rows: {} };
  useDocumentStore.setState({ documentCategory: 'forms', formType: definition.formId, formData: {}, references: [], enclosures: [], paragraphs: [], copyTos: [], distributions: [], endItems: [], publicationTables: {}, genericForm: { definition, ...data, answerRevision: 0 } });
  documents.openLoadedAsNew();
  documents.saveCurrent();
  useHistoryStore.getState().clearHistory();
  useHistoryStore.getState().saveSnapshot(useDocumentStore.getState().getSnapshot());
  // Legacy buffers remain as a recovery copy after migration.
}

export function editForm(update: (draft: Pick<FormInstance, 'answers' | 'rows'>) => void): void {
  const state = useDocumentStore.getState();
  if (!state.genericForm) return;
  const history = useHistoryStore.getState();
  history.saveSnapshot(state.getSnapshot());
  const draft = structuredClone({ answers: state.genericForm.answers, rows: state.genericForm.rows });
  update(draft);
  const next = { ...state.genericForm, ...draft, answerRevision: state.genericForm.answerRevision + 1 };
  useDocumentStore.setState({ genericForm: next });
  history.saveSnapshot(useDocumentStore.getState().getSnapshot());
}

export function importForm(value: unknown): void {
  const instance = parseFormInstance(value);
  const documents = useDocumentsStore.getState();
  documents.syncCurrent();
  useDocumentStore.setState({ documentCategory: 'forms', formType: instance.definition.formId, formData: {}, references: [], enclosures: [], paragraphs: [], copyTos: [], distributions: [], endItems: [], publicationTables: {}, genericForm: instance });
  documents.openLoadedAsNew();
  documents.saveCurrent();
  useHistoryStore.getState().clearHistory();
  useHistoryStore.getState().saveSnapshot(useDocumentStore.getState().getSnapshot());
}

export interface FormMigration {
  from: string;
  to: string;
  fields: Record<string, string>;
  options?: Record<string, Record<string, string>>;
  rowGroups?: Record<string, { to: string; columns: Record<string, string>; options?: Record<string, Record<string, string>> }>;
}

export function migrateForm(instance: FormInstance, definition: FormDefinition, migration: FormMigration): FormInstance {
  if (instance.definition.formId !== definition.formId || migration.from !== instance.definition.definitionRevision || migration.to !== definition.definitionRevision) throw new Error('Migration does not match the form revisions');
  const mapAnswers = (values: FormInstance['answers'], fields: Record<string, string>, options?: FormMigration['options']) => {
    const answers: FormInstance['answers'] = {};
    for (const [key, value] of Object.entries(values)) {
      const target = fields[key];
      if (!target || target in answers) throw new Error(`Missing or ambiguous migration for ${key}`);
      const map = options?.[key];
      const option = (v: string) => { if (!map?.[v]) throw new Error(`Missing option mapping for ${key}.${v}`); return map[v]; };
      answers[target] = map ? Array.isArray(value) ? value.map(option) : option(String(value)) : value;
    }
    return answers;
  };
  const answers = mapAnswers(instance.answers, migration.fields, migration.options);
  const rows: FormInstance['rows'] = {};
  for (const [key, entries] of Object.entries(instance.rows)) {
    if (!entries.length) continue;
    const mapping = migration.rowGroups?.[key];
    if (!mapping || rows[mapping.to]) throw new Error(`Missing or ambiguous migration for row group ${key}`);
    rows[mapping.to] = entries.map(row => ({ id: row.id, answers: mapAnswers(row.answers, mapping.columns, mapping.options) }));
  }
  const result = parseFormInstance({ definition, answers, rows, answerRevision: instance.answerRevision + 1 });
  const errors = validateAnswers(definition, answers, rows, false);
  if (errors.length) throw new Error(errors.map(e => e.message).join('; '));
  return result;
}

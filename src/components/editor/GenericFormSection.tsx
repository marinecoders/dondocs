import { useEffect, useRef, useState } from 'react';
import { useFormResource } from '@/services/formRegistry';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { editForm, importForm, migrateForm, startForm } from '@/services/forms/documents';
import { compileFormDefinition, diagnosticText, validateAnswers, type FormInstance } from '@/services/forms/model';
import { loadPackagePage, packageAvailableOffline, removeUnusedPackages } from '@/services/forms/packages';
import { FormAnswerControl } from './FormAnswerControl';
import { RowGroupGrid } from './RowGroupGrid';
import { SectionShell } from '@/components/layout/SectionShell';
import { Button } from '@/components/ui/button';
import { showAppConfirm } from '@/stores/alertStore';

export function GenericFormSection({ formType }: { formType: string }) {
  const { config: definition, error: loadError } = useFormResource(formType);
  const instance = useDocumentStore(s => s.genericForm);
  const currentId = useDocumentsStore(s => s.currentId);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!definition || instance?.definition.formId === formType) return;
    try { startForm(definition); } catch (e) { queueMicrotask(() => setError(String(e))); }
  }, [definition, formType, instance]);
  if (!definition || !instance || instance.definition.formId !== formType) {
    return <p role="status">{error || loadError || 'Loading form…'}</p>;
  }
  return <FormInstanceEditor key={currentId} instance={instance} currentId={currentId} />;
}

function FormInstanceEditor({ instance, currentId }: { instance: FormInstance; currentId: string | null }) {
  const definition = instance.definition;
  const validationVisible = useUIStore(s => s.validationVisible);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [savingOffline, setSavingOffline] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    void packageAvailableOffline(definition).then(value => {
      if (alive) setOffline(value);
    }).catch(() => { if (alive) setOffline(false); });
    return () => { alive = false; };
  }, [definition]);

  const stillCurrent = () => mounted.current
    && useDocumentsStore.getState().currentId === currentId
    && useDocumentStore.getState().genericForm === instance;
  const reportError = (error: unknown) => {
    if (mounted.current) setError(error instanceof Error ? error.message : String(error));
  };
  const issues = validateAnswers(definition, instance.answers, instance.rows, validationVisible);

  const applyRevision = async (file: File) => {
    setError('');
    try {
      const update = JSON.parse(await file.text());
      if (!stillCurrent()) throw new Error('The form changed while the update was loading. Select the update again.');
      const next = migrateForm(instance, compileFormDefinition(update.definition), update.migration);
      const confirmed = await showAppConfirm({
        title: 'Update this form?',
        message: 'Open the updated revision as a new copy. Your saved original will remain available.',
        confirmLabel: 'Open updated copy',
      });
      if (!confirmed) return;
      if (!stillCurrent()) throw new Error('The form changed before the update was applied. Select the update again.');
      importForm(next);
    } catch (error) { reportError(error); }
  };

  const saveOffline = async () => {
    setError('');
    setSavingOffline(true);
    try {
      const saved = Object.values(useDocumentsStore.getState().docs).flatMap(e => e.session.genericForm ? [e.session.genericForm.definition] : []);
      await removeUnusedPackages([...saved, definition]);
      for (const page of definition.pages) await loadPackagePage(definition, page.file, true);
      const available = await packageAvailableOffline(definition);
      if (!available) throw new Error('The complete form could not be saved offline. Reconnect and try again.');
      if (mounted.current) setOffline(true);
    } catch (error) { reportError(error); }
    finally { if (mounted.current) setSavingOffline(false); }
  };

  const clear = async () => {
    if (!await showAppConfirm({ title: 'Clear this form?', message: 'You can undo this change.', confirmLabel: 'Clear', destructive: true })) return;
    if (!stillCurrent()) { reportError(new Error('The form changed before it was cleared. Try again.')); return; }
    setError('');
    editForm(form => { form.answers = {}; form.rows = {}; });
  };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <label className="cursor-pointer rounded border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring">
        Apply revision update
        <input className="sr-only" type="file" accept=".json" aria-label="Apply revision update" onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void applyRevision(file);
        }} />
      </label>
      <Button variant="secondary" onClick={() => startForm(definition, false)}>New copy</Button>
      <Button variant="secondary" disabled={savingOffline} aria-busy={savingOffline} onClick={() => void saveOffline()}>
        {savingOffline ? 'Saving offline…' : offline ? 'Available offline' : 'Save for offline use'}
      </Button>
      <Button variant="ghost" onClick={() => void clear()}>Clear</Button>
    </div>
    <p className="text-sm text-muted-foreground">
      JSON backups keep your answers and form definition, but not the blank PDF pages.
      {' '}After restoring on another device or clearing browser storage, connect to the internet and choose Save for offline use.
      {' '}Keep an exported PDF if you also need a copy you can open without DonDocs.
    </p>
    {issues.filter(issue => {
      const [key, row, column] = issue.path.split('.');
      const group = Object.hasOwn(definition.rowGroups, key) ? definition.rowGroups[key] : undefined;
      const hasControl = Object.hasOwn(definition.fields, issue.path)
        || (group && column && Object.hasOwn(group.columns, column) && instance.rows[key]?.[Number(row)]);
      return !hasControl;
    }).map(issue =>
      <p key={`${issue.path}:${issue.code}`} role="alert" className="text-sm text-destructive">{diagnosticText(definition, issue)}</p>
    )}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {definition.sections.map(section => <SectionShell key={section.id} id={section.id}>
      <h3 className="mb-2 font-medium">{section.title}</h3>
      <div className={section.editor === 'checklist' ? 'space-y-2' : 'space-y-4'}>
        {section.fields.map(key => <div key={key} className="space-y-1">
          <label htmlFor={`answer-${key}`} className="text-sm">
            {definition.fields[key].label}{definition.fields[key].requiredAt === 'export' ? ' *' : ''}
          </label>
          <FormAnswerControl
            id={`answer-${key}`}
            field={definition.fields[key]}
            value={instance.answers[key]}
            error={issues.filter(issue => issue.path === key).map(issue => issue.message).join('; ')}
            onChange={value => editForm(form => { form.answers[key] = value; })}
          />
        </div>)}
      </div>
    </SectionShell>)}
    {Object.entries(definition.rowGroups).map(([key, group]) => <SectionShell key={key} id={key}>
      <h3 className="mb-2 font-medium">{group.title}</h3>
      <RowGroupGrid groupKey={key} group={group} issues={issues} />
    </SectionShell>)}
  </div>;
}

import { usePackageEditorNavigation } from './usePackageEditorNavigation';
import { PackageDocumentSwitcher } from './PackageDocumentSwitcher';
import { PackageLinkedFieldTools } from './PackageLinkedFieldTools';
import type { PackageDestination } from '@/lib/packageDestinations';
import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ActionPackage, NativePackageMember } from '@/lib/actionPackages';
import { readFormLocation, rememberFormLocation } from '@/lib/packageFormLocation';
import { validateAnswers } from '@/services/forms/model';
import { FormSectionFields } from './editor/GenericFormSection';
import { FormRows } from './editor/RowGroupGrid';
import { Page11Fields } from './editor/Form11811Section';
import { PackageDocumentPreview } from './PackageDocumentPreview';
import { usePackageFormEditor } from './usePackageFormEditor';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

import { useUIStore } from '@/stores/uiStore';
import { showAppConfirm } from '@/stores/alertStore';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import type { InputWithVariables } from './ui/variable-autocomplete';
import type { VariableChipEditor } from './ui/variable-chip-editor';

// Package members have their own values. The standalone variable menus read the active library document.
function MemberTextField({ id, value, onValueChange, maxLength, placeholder }: ComponentProps<typeof InputWithVariables>) {
  return <Input id={id} value={value} maxLength={maxLength} placeholder={placeholder?.split(' (type @')[0]}
    onChange={event => onValueChange(event.target.value)} />;
}

function MemberRemarksField({ value, onChange, ariaLabel, rows }: ComponentProps<typeof VariableChipEditor>) {
  return <Textarea aria-label={ariaLabel} value={value} rows={rows} onChange={event => onChange(event.target.value)} />;
}

type Props = Pick<ComponentProps<typeof PackageDocumentPreview>, 'ports' | 'exportGate'> & {
  record: ActionPackage;
  member: NativePackageMember;
  onFieldReview?(target: PackageDestination): void;
  onSave(next: ActionPackage): void;
  onNavigate(memberId?: string): void | Promise<void>;
  correction?: PackageDestination['correction'];
  onFinishFinding?(advance: boolean): Promise<void>;
  onSharedDetails(): void;
  navigationError?: string;
};

export default function PackageFormEditor({ record, member, onFieldReview, onSave, onNavigate, onSharedDetails, ports, exportGate, navigationError, correction, onFinishFinding }: Props) {
  const editor = usePackageFormEditor(record, member, onSave);
  const titleId = useId();
  const [mobilePreview, setMobilePreview] = useState(false);
  const [preview, setPreview] = useState(editor.values);
  useEffect(() => {
    const timer = setTimeout(() => setPreview(editor.values), 350);
    return () => clearTimeout(timer);
  }, [editor.values]);
  const position = record.id + '/' + member.id;
  const defaultLayout = useUIStore(s => s.formEditorLayout);
  const [sectionId, setSection] = useState(() => correction?.kind === 'edit' && correction.sectionId || readFormLocation(position));
  const [expanded, setExpanded] = useState(() => (readFormLocation(position + '/sections') || (defaultLayout === 'scroll' ? 'marine,content,signatures' : 'marine')).split(','));
  const focusRequest = useRef(correction);
  useEffect(() => {
    if (!editor.ready || focusRequest.current?.kind !== 'edit') return;
    const { fieldKey, sectionId } = focusRequest.current;
    if (fieldKey) document.getElementById('pkg-answer-' + fieldKey)?.focus();
    if (sectionId && member.session.formType === 'navmc_118_11') setExpanded(values => [...new Set([...values, sectionId])]);
    focusRequest.current = undefined;
  }, [editor.ready, member.session.formType]);
  const { navigate, navigating: leaving, navigationError: switchError } = usePackageEditorNavigation(editor.flush);
  const revision = record.revisions.find(item => item.id === record.currentRevisionId)!;
  const factIds = new Set(revision.bindings?.items.filter(link => link.memberId === member.id).map(link => link.factId));
  const sharedLabels = revision.information?.facts.filter(fact => factIds.has(fact.id)).map(fact => fact.label) ?? [];
  const values = editor.values;
  const form = member.session.genericForm;
  const instance = form && values.kind === 'configured' ? { ...form, answers: values.answers, rows: values.rows } : undefined;
  const definition = instance?.definition;
  const groups = Object.entries(definition?.rowGroups ?? {});
  const sections = [...(definition?.sections ?? []).map(s => ({ id: 'field/' + s.id, title: s.title })),
    ...groups.map(([key, group]) => ({ id: 'rows/' + key, title: group.title }))];
  const selected = sections.find(s => s.id === sectionId)?.id ??
    (sectionId === 'all' || defaultLayout === 'scroll' ? 'all' : sections[0]?.id);
  const issues = instance ? validateAnswers(instance.definition, instance.answers, instance.rows, false) : [];
  const selectClass = 'block min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5 text-sm';
  return <Dialog open onOpenChange={open => { if (!open) void navigate(() => onFinishFinding ? onFinishFinding(false) : onNavigate()); }}>
    <DialogContent fullscreen showCloseButton={false} aria-labelledby={titleId} className="flex flex-col gap-0">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
        <Button size="sm" variant="ghost" disabled={leaving} onClick={() => void navigate(() => onFinishFinding ? onFinishFinding(false) : onNavigate())}><ArrowLeft />{onFinishFinding ? 'Back to Delivery' : 'Back to package'}</Button>
        <div className="min-w-0"><DialogTitle id={titleId}>{record.name}</DialogTitle><DialogDescription>Package form editor</DialogDescription></div>
        <PackageDocumentSwitcher revision={revision} memberId={member.id} disabled={leaving}
          onSelect={id => void navigate(() => onNavigate(id))} />
        {onFinishFinding && <Button size="sm" disabled={leaving} onClick={() => void navigate(() => onFinishFinding(true))}>Next item</Button>}
        <span className="ml-auto text-sm text-muted-foreground" role="status">{({ opening: 'Opening form…', saved: 'Saved to package', saving: 'Saving…', pending: 'Editing draft', error: 'Save needs attention' })[editor.phase]}</span>
        <Button size="sm" variant="outline" className="lg:hidden" onClick={() => setMobilePreview(!mobilePreview)}>{mobilePreview ? 'Show fields' : 'Show preview'}</Button>
        <Button size="sm" disabled={leaving || editor.phase !== 'pending'} onClick={() => void editor.flush()}>Save changes</Button>
      </header>
      {onFieldReview && <PackageLinkedFieldTools record={record} onSave={onSave} member={member} revision={revision} disabled={leaving || editor.phase !== 'saved'} onReview={onFieldReview} />}
      {(switchError || navigationError) && <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">{switchError || navigationError}</p>}
      {editor.error && <div role="alert" className="flex flex-wrap items-center gap-3 border-b bg-muted px-4 py-2 text-sm">
        {editor.error}
        {editor.canDiscardRecovery && <Button size="sm" variant="outline" onClick={async () => {
          if (await showAppConfirm({ title: 'Discard recovered input?', message: 'This opens the saved package answers and clears the recovered draft for this form.', confirmLabel: 'Discard draft', destructive: true }))
            await editor.discardRecovery();
        }}>Use saved answers</Button>}
        {editor.ready && <Button size="sm" variant="outline" onClick={() => void editor.flush()}>Retry save</Button>}
      </div>}
      <main className="grid min-h-0 flex-1 content-start gap-6 overflow-auto p-4 lg:grid-cols-[minmax(20rem,2fr)_minmax(0,3fr)] lg:content-stretch lg:overflow-hidden">
        <div className={(mobilePreview ? "hidden lg:block " : "") + "min-w-0 space-y-4 lg:overflow-y-auto lg:px-1"}>

          <div className="text-sm">
            {sharedLabels.length > 0 && <p className="text-muted-foreground">Shared values: {sharedLabels.join(' · ')}</p>}
            <Button size="sm" variant="link" className="h-auto px-0" disabled={leaving}
              onClick={() => void navigate(onSharedDetails)}>Open shared package details</Button>
          </div>
          <fieldset disabled={!editor.ready || leaving} className="min-w-0 space-y-4">
            {instance && <>
              <label className="block space-y-1 text-sm font-medium">Form section<select className={selectClass} value={selected ?? 'all'} onChange={event => {
                setSection(event.target.value); rememberFormLocation(position, event.target.value);
              }}><option value="all">Full document</option>{sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
              {instance.definition.sections.filter(s => selected === 'all' || selected === 'field/' + s.id).map(section =>
                <section key={section.id} className="space-y-2">
                  {selected === 'all' && <h3 className="font-medium">{section.title}</h3>}
                  <FormSectionFields instance={instance} section={section} issues={issues} prefix="pkg-" onChange={(key, value) => {
                    const current = editor.latest();
                    if (current.kind === 'configured') editor.change({ ...current, answers: { ...current.answers, [key]: value } });
                  }} />
                </section>)}
              {groups.filter(([key]) => selected === 'all' || selected === 'rows/' + key).map(([key, group]) =>
                <section key={key} className="space-y-2">
                  {selected === 'all' && <h3 className="font-medium">{group.title}</h3>}
                  <FormRows groupKey={key} group={group} rows={instance.rows[key] ?? []} issues={issues}
                    editForm={update => {
                      const current = editor.latest();
                      if (current.kind !== 'configured') return;
                      const next = structuredClone(current);
                      next.rows[key] ??= [];
                      update(next); editor.change(next);
                    }} />
                </section>)}
            </>}
            {values.kind === 'page11' && <Page11Fields prefix="pkg-" TextField={MemberTextField} RemarksField={MemberRemarksField} navmc11811={values.page11} officialPdfEdition={member.session.forms?.officialPdfEdition}
              expanded={expanded} onExpandedChange={next => { setExpanded(next); rememberFormLocation(position + '/sections', next.join(',') || ','); }}
              getCurrent={() => { const current = editor.latest(); return current.kind === 'page11' ? current.page11 : values.page11; }}
              setNavmc11811Field={(key, value) => {
                const current = editor.latest();
                if (current.kind === 'page11') editor.change({ kind: 'page11', page11: { ...current.page11, [key]: value } });
              }} />}
          </fieldset>
        </div>
        <aside className={(mobilePreview ? "" : "hidden lg:block ") + "min-w-0 space-y-2 lg:overflow-auto"}><h2 className="font-medium">PDF preview</h2>
          <PackageDocumentPreview active packageId={record.id} revisionId={revision.id} positionId={position} formPreview={preview} member={member} ports={ports} exportGate={exportGate} />
        </aside>
      </main>
    </DialogContent>
  </Dialog>;
}

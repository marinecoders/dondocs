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
  onSave(next: ActionPackage): void;
  onNavigate(memberId?: string): void | Promise<void>;
  onSharedDetails(): void;
  navigationError?: string;
};

export default function PackageFormEditor({ record, member, onSave, onNavigate, onSharedDetails, ports, exportGate, navigationError }: Props) {
  const editor = usePackageFormEditor(record, member, onSave);
  const titleId = useId();
  const [mobilePreview, setMobilePreview] = useState(false);
  const [preview, setPreview] = useState(editor.values);
  useEffect(() => {
    const timer = setTimeout(() => setPreview(editor.values), 350);
    return () => clearTimeout(timer);
  }, [editor.values]);
  const position = record.id + '/' + member.id;
  const [sectionId, setSection] = useState(() => readFormLocation(position));
  const [expanded, setExpanded] = useState(() => (readFormLocation(position + '/sections') || 'marine').split(','));
  const switching = useRef(false);
  const [leaving, setLeaving] = useState(false);
  async function navigate(action: () => void | Promise<void>) {
    if (switching.current) return;
    switching.current = true;
    setLeaving(true);
    try {
      if (await editor.flush()) await action();
    } finally {
      switching.current = false;
      setLeaving(false);
    }
  }
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
  const selected = sections.find(s => s.id === sectionId) ?? sections[0];
  const section = definition?.sections.find(s => 'field/' + s.id === selected?.id);
  const rowGroup = groups.find(([key]) => 'rows/' + key === selected?.id);
  const issues = instance ? validateAnswers(instance.definition, instance.answers, instance.rows, false) : [];
  const selectClass = 'block min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5 text-sm';
  return <Dialog open onOpenChange={open => { if (!open) void navigate(() => onNavigate()); }}>
    <DialogContent fullscreen showCloseButton={false} aria-labelledby={titleId} className="flex flex-col gap-0">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
        <Button size="sm" variant="ghost" disabled={leaving} onClick={() => void navigate(() => onNavigate())}><ArrowLeft />Back to package</Button>
        <div className="min-w-0"><DialogTitle id={titleId}>{record.name}</DialogTitle><DialogDescription>Package form editor</DialogDescription></div>
        <span className="ml-auto text-sm text-muted-foreground" role="status">{({ opening: 'Opening form…', saved: 'Saved to package', saving: 'Saving…', pending: 'Editing draft', error: 'Save needs attention' })[editor.phase]}</span>
        <Button size="sm" variant="outline" className="lg:hidden" onClick={() => setMobilePreview(!mobilePreview)}>{mobilePreview ? 'Show fields' : 'Show preview'}</Button>
        <Button size="sm" disabled={leaving || editor.phase !== 'pending'} onClick={() => void editor.flush()}>Save changes</Button>
      </header>
      {navigationError && <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">{navigationError}</p>}
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
          <label className="block space-y-1 text-sm font-medium">{revision.members.some(m => m.kind !== 'native' || m.session.documentCategory !== 'forms') ? 'Package document' : 'Package form'}
            <select className={selectClass} value={member.id} disabled={leaving} onChange={event => { const id = event.target.value; void navigate(() => onNavigate(id)); }}>
              {revision.members.map((m, i) => <option key={m.id} value={m.id}>{i + 1}. {m.label}</option>)}
            </select>
          </label>
          <div className="text-sm">
            {sharedLabels.length > 0 && <p className="text-muted-foreground">Shared values: {sharedLabels.join(' · ')}</p>}
            <Button size="sm" variant="link" className="h-auto px-0" disabled={leaving}
              onClick={() => void navigate(onSharedDetails)}>Open shared package details</Button>
          </div>
          <fieldset disabled={!editor.ready || leaving} className="min-w-0 space-y-4">
            {instance && <>
              <label className="block space-y-1 text-sm font-medium">Form section<select className={selectClass} value={selected?.id ?? ''} onChange={event => {
                setSection(event.target.value); rememberFormLocation(position, event.target.value);
              }}>{sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
              {section && <FormSectionFields instance={instance} section={section} issues={issues} prefix="pkg-" onChange={(key, value) => {
                const current = editor.latest();
                if (current.kind === 'configured') editor.change({ ...current, answers: { ...current.answers, [key]: value } });
              }} />}
              {rowGroup && <FormRows groupKey={rowGroup[0]} group={rowGroup[1]} rows={instance.rows[rowGroup[0]] ?? []} issues={issues}
                editForm={update => {
                  const current = editor.latest();
                  if (current.kind !== 'configured') return;
                  const next = structuredClone(current);
                  next.rows[rowGroup[0]] ??= [];
                  update(next); editor.change(next);
                }} />}
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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { PackageIntakeQuestions } from './PackageIntakeQuestions';
import { PackageIntakeScope } from './PackageIntakeScope';
import { PackageIntakePreview, type IntakeAnswerChoice, type IntakeMemberChoice } from './PackageIntakePreview';
import { maintainedPackageAction, maintainedPackageActions, type MaintainedPackageActionId } from '@/lib/maintainedPackageActions';
import { freshPackageTemplateAnswers, intakeAttachmentSlots, intakeQuestions } from '@/lib/conditionalIntakeView';
import { applyPreparedConditionalPackage, conditionalPackageAnswers, prepareConditionalPackage, readConditionalPackageTemplate,
  saveConditionalPackageDraft, undoConditionalPackage, type ConditionalPackageUndo, type PreparedConditionalPackage } from '@/lib/packageConditional';
import { getPackageRevision, type ActionPackage, type PackageRevision } from '@/lib/actionPackages';
import type { PackageTemplateAnswers } from '@/lib/packageTemplateProgram';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';
import { listPackageTemplates, MAX_TEMPLATE_ACTION_BYTES, type TemplateAttachment } from '@/lib/packageTemplateLibrary';
import type { PackageUpdateChoices } from '@/lib/packageUpdates';
import { sameReviewStoredValue } from '@/lib/documentsDb';
import { getExportDeploymentPolicy } from '@/config/classification';

const inputClass = 'mt-1 w-full min-w-0 rounded border bg-background p-2';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
interface Props {
  record?: ActionPackage;
  revision?: PackageRevision;
  editable: boolean;
  disabled: boolean;
  busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  onApply(record: ActionPackage): void;
  signal(): AbortSignal | undefined;
  isCurrent(): boolean;
  onDirtyChange?(dirty: boolean): void;
}
interface Token { generation: number; owner: string; signal?: AbortSignal }
const emptyAnswers = (): PackageTemplateAnswers => ({ version: 1, values: {}, groups: {} });
const scope = (record?: ActionPackage, revision?: PackageRevision) => `${record?.id ?? ''}:${record?.sequence ?? ''}:${revision?.id ?? ''}`;

export function PackageIntakePanel({ record, revision, editable, disabled, busy, run, onApply, signal, isCurrent, onDirtyChange }: Props) {
  const [template, setTemplate] = useState<PackageTemplateV2 | null>(null), [answers, setAnswers] = useState(emptyAnswers);
  const [mode, setMode] = useState<'none' | 'new' | 'saved'>('none'), [name, setName] = useState('');
  const [baseline, setBaseline] = useState<{ answers: PackageTemplateAnswers; name: string } | null>(null);
  const [open, setOpen] = useState(false), [focusQuestions, setFocusQuestions] = useState(false), [questionKey, setQuestionKey] = useState(0);
  const [loading, setLoading] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<PreparedConditionalPackage | null>(null), [fresh, setFresh] = useState(false), [reviewed, setReviewed] = useState(false);
  const [memberChoices, setMemberChoices] = useState<Record<string, IntakeMemberChoice>>({}), [answerChoices, setAnswerChoices] = useState<Record<string, IntakeAnswerChoice>>({});
  const [fieldChoices, setFieldChoices] = useState<PackageUpdateChoices>({}), [attachments, setAttachments] = useState<Record<string, TemplateAttachment>>({});
  const [attachmentLabels, setAttachmentLabels] = useState<Record<string, string>>({});
  const [undo, setUndo] = useState<ConditionalPackageUndo | null>(null);
  const [library, setLibrary] = useState<PackageTemplateV2[] | null>(null), [libraryId, setLibraryId] = useState('');
  const alive = useRef(true), generation = useRef(0), running = useRef(false), owner = useRef(''), ownScope = useRef('');
  const selectedSource = useRef({ record, revision }), dirtyCallback = useRef(onDirtyChange);
  const enabled = useRef(!disabled), wasUnavailable = useRef(disabled);
  const unavailable = disabled || mode === 'saved' && !editable;
  useLayoutEffect(() => {
    enabled.current = !disabled;
    if (wasUnavailable.current !== unavailable) { generation.current++; setPreview(null); setFresh(false); setReviewed(false); }
    wasUnavailable.current = unavailable;
  }, [disabled, unavailable]);
  const heading = useRef<HTMLHeadingElement>(null), returnFocus = useRef(false);
  const ownerScope = scope(record, revision);
  useLayoutEffect(() => { selectedSource.current = { record, revision }; owner.current = ownerScope; dirtyCallback.current = onDirtyChange; });
  const hasDecisions = Object.keys(memberChoices).length + Object.keys(answerChoices).length + Object.keys(fieldChoices).length > 0;
  const dirty = !!template && (mode === 'new' || !baseline || name !== baseline.name || !sameReviewStoredValue(answers, baseline.answers)
    || Object.keys(attachments).length > 0 || hasDecisions);
  const viewDisabled = disabled || busy || pending || loading, locked = viewDisabled || mode === 'saved' && !editable;
  useEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; dirtyCallback.current?.(false); }; }, []);
  useEffect(() => {
    if (returnFocus.current && !viewDisabled) { heading.current?.focus(); returnFocus.current = false; }
  }, [questionKey, viewDisabled]);
  useEffect(() => {
    if (ownScope.current === ownerScope) { ownScope.current = ''; return; }
    const { record, revision } = selectedSource.current;
    const version = ++generation.current;
    setPreview(null); setFresh(false); setReviewed(false); setUndo(null); setAttachments({}); setAttachmentLabels({}); setMemberChoices({}); setAnswerChoices({}); setFieldChoices({}); setNotice(''); setError('');
    if (!record || !revision?.templateState) {
      setTemplate(null); setMode('none'); setAnswers(emptyAnswers()); setBaseline(null); setOpen(false); setLoading(false); return;
    }
    setLoading(true);
    void readConditionalPackageTemplate(record, revision.id).then(value => {
      if (!alive.current || generation.current !== version || owner.current !== ownerScope) return;
      const resumed = conditionalPackageAnswers(record, revision.id);
      setTemplate(value); setMode('saved'); setAnswers(resumed); setName(record.name); setBaseline({ answers: structuredClone(resumed), name: record.name });
      setQuestionKey(value => value + 1); setOpen(!!revision.templateState?.pending); setFocusQuestions(false);
    }).catch(cause => {
      if (alive.current && generation.current === version) { setTemplate(null); setMode('none'); setError(cause instanceof Error ? cause.message : 'The saved intake could not be read.'); }
    }).finally(() => { if (alive.current && generation.current === version) setLoading(false); });
  }, [ownerScope, reload]);
  const view = useMemo(() => {
    if (!template) return null;
    try { return { value: intakeQuestions(template.program, answers) }; }
    catch (cause) { return { error: cause instanceof Error ? cause.message : 'The intake answers could not be inspected.' }; }
  }, [template, answers]);
  const files = useMemo(() => {
    if (!template || view?.error || view?.value?.invalidLabels.length) return { slots: [] };
    try { return { slots: intakeAttachmentSlots(template, answers) }; }
    catch (cause) { return { slots: [], error: cause instanceof Error ? cause.message : 'The file slots could not be inspected.' }; }
  }, [template, answers, view]);
  const validShape = !!template && !view?.error && !view?.value?.invalidLabels.length && !!name.trim();
  const hasInactiveFiles = Object.keys(attachments).some(key => !files.slots.some(slot => slot.key === key));
  function token(): Token { return { generation: generation.current, owner: owner.current, signal: signal() }; }
  function current(capture: Token): boolean {
    return alive.current && enabled.current && capture.generation === generation.current && capture.owner === owner.current && capture.signal === signal() && !capture.signal?.aborted && isCurrent();
  }
  async function perform(action: (capture: Token) => Promise<void>) {
    if (running.current || viewDisabled) return;
    running.current = true; setPending(true);
    const capture = token();
    try { await run(async () => { const activeCapture = { ...capture, signal: signal() }; if (current(activeCapture)) await action(activeCapture); }); }
    finally { running.current = false; if (alive.current) setPending(false); }
  }
  function invalidate(clearDecisions = false) {
    generation.current++; setFresh(false); setReviewed(false); setNotice('');
    if (clearDecisions) { setMemberChoices({}); setAnswerChoices({}); setFieldChoices({}); }
  }
  function editAnswers(next: PackageTemplateAnswers) { invalidate(true); setAnswers(next); }
  function accept(next: ActionPackage, receipt?: ConditionalPackageUndo) {
    const selected = getPackageRevision(next), nextAnswers = conditionalPackageAnswers(next);
    ownScope.current = scope(next, selected);
    generation.current++; setMode('saved'); setAnswers(nextAnswers); setName(next.name); setBaseline({ answers: structuredClone(nextAnswers), name: next.name });
    setAttachments({}); setAttachmentLabels({}); setPreview(null); setFresh(false); setReviewed(false); setMemberChoices({}); setAnswerChoices({}); setFieldChoices({}); setUndo(receipt ?? null);
    setQuestionKey(value => value + 1); setOpen(!!selected.templateState?.pending); setFocusQuestions(false); returnFocus.current = true;
    dirtyCallback.current?.(false); onApply(next);
  }
  function choose(value: PackageTemplateV2) {
    generation.current++; setTemplate(value); setAnswers(freshPackageTemplateAnswers(value.program)); setName(value.name); setMode('new'); setBaseline(null);
    setAttachments({}); setAttachmentLabels({}); setMemberChoices({}); setAnswerChoices({}); setFieldChoices({}); setPreview(null); setFresh(false); setReviewed(false); setUndo(null);
    setOpen(true); setFocusQuestions(true); setQuestionKey(value => value + 1); setNotice(''); setError('');
  }
  function discard() {
    invalidate(true); setAttachments({}); setAttachmentLabels({}); setPreview(null); setUndo(null); setQuestionKey(value => value + 1); returnFocus.current = true;
    if (mode === 'new' || !baseline) {
      setTemplate(null); setAnswers(emptyAnswers()); setMode('none'); setBaseline(null); setOpen(false);
      if (record && revision?.templateState) { ownScope.current = ''; setReload(value => value + 1); }
    }
    else { setAnswers(structuredClone(baseline.answers)); setName(baseline.name); setOpen(!!revision?.templateState?.pending); setFocusQuestions(false); }
  }
  function input() {
    if (!template) throw new Error('Choose an action first.');
    return { template, answers, name, ...(mode === 'saved' && record ? { record } : {}) };
  }
  function removeFile(key: string) {
    invalidate();
    setAttachments(previous => { const next = { ...previous }; delete next[key]; return next; });
    setAttachmentLabels(previous => { const next = { ...previous }; delete next[key]; return next; });
  }
  function decide<T extends string>(set: (value: Record<string, T>) => void, values: Readonly<Record<string, T>>, key: string, value: T | undefined) {
    invalidate(); const next = { ...values }; if (value === undefined) delete next[key]; else next[key] = value; set(next);
  }
  const catalogLocked = viewDisabled || dirty;
  const catalog = <div className="grid min-w-0 gap-3 md:grid-cols-3">{maintainedPackageActions.map(action => <article key={action.id} className="min-w-0 space-y-2 rounded border p-3">
    <p className="text-xs text-muted-foreground">{action.kind}</p><h4 className="font-medium">{action.name}</h4><p className="text-sm text-muted-foreground">{action.description}</p>
    <Button className={buttonClass} variant="outline" disabled={catalogLocked} onClick={() => void perform(async capture => {
      const selected = await maintainedPackageAction(action.id as MaintainedPackageActionId); if (current(capture)) choose(selected);
    })}>Start {action.name.toLocaleLowerCase()}</Button>
  </article>)}</div>;
  return <section tabIndex={-1} data-package-panel="intake" aria-label="Action intake" className="min-w-0 space-y-4 rounded-lg border bg-background p-3 sm:p-4" aria-busy={pending || loading}>
    <div className="space-y-1">
      <h3 ref={heading} tabIndex={-1} className="break-words font-medium">{template?.name ?? 'Start from an action'}</h3>
      <p className="text-sm text-muted-foreground">General-purpose starters use DonDocs worksheets. Review the requirements for the actual action; these are not official forms.</p>
      {loading && <p role="status" className="text-sm">Loading the exact saved intake…</p>}
      {!loading && template && <p role="status" className="text-sm">{dirty ? 'Unapplied intake changes · not saved.' : revision?.templateState?.pending
        ? 'Intake saved; document changes not applied.' : "Showing this revision's saved intake and package values."}</p>}
      {mode === 'new' && <p className="text-sm text-muted-foreground">New action · creates a separate package with fresh answers.</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {view?.error && <p role="alert" className="break-words text-sm text-destructive">{view.error}</p>}
    </div>
    {!template ? catalog : <details><summary className="cursor-pointer text-sm font-medium">Start another action</summary><div className="pt-3">{catalog}</div></details>}
    <details className="min-w-0 rounded border p-3"><summary className="cursor-pointer text-sm font-medium">Use a saved conditional template</summary>
      <div className="space-y-3 pt-3">
        <Button className={buttonClass} variant="outline" disabled={catalogLocked} onClick={() => void perform(async capture => {
          const values = (await listPackageTemplates()).filter((value): value is PackageTemplateV2 => value.version === 2);
          if (current(capture)) { setLibrary(values); setLibraryId(''); }
        })}>Load saved conditional templates</Button>
        {library && <><label className="block text-sm">Saved conditional template<select className={inputClass} value={libraryId} disabled={catalogLocked} onChange={event => setLibraryId(event.target.value)}>
          <option value="">Choose a saved template</option>{library.map(value => <option key={value.id} value={value.id}>{value.name} · revision {value.program.revision} · {value.id.slice(-8)}</option>)}
        </select></label>
          {!library.length && <p className="text-sm text-muted-foreground">No saved conditional templates. The maintained starters above are available without setup.</p>}
          <Button className={buttonClass} variant="outline" disabled={catalogLocked || !libraryId} onClick={() => { const value = library.find(value => value.id === libraryId); if (value) choose(structuredClone(value)); }}>Use selected conditional template</Button>
        </>}
      </div>
    </details>
    {template && !loading && <>
      <PackageIntakeScope key={template.id} template={template} />
      {mode === 'saved' && !editable && <p className="text-sm text-muted-foreground">This saved intake is read-only in a historical, archived or reviewer copy.</p>}
      <Button className={buttonClass} variant="outline" disabled={viewDisabled} aria-expanded={open} onClick={() => { setOpen(value => !value); setFocusQuestions(true); }}>
        {open ? 'Collapse intake questions' : editable || mode === 'new' ? 'Continue intake' : 'Inspect saved intake'}
      </Button>
      {open && <div className="min-w-0 space-y-4">
        <label className="block text-sm">Action name<input className={inputClass} value={name} maxLength={120} disabled={locked} autoComplete="off" onChange={event => { invalidate(); setName(event.target.value); }} /></label>
        {!view?.error && <PackageIntakeQuestions key={questionKey} program={template.program} answers={answers} disabled={locked} busy={viewDisabled} onChange={editAnswers} focusFirst={focusQuestions} />}
      </div>}
      {template.members.some(member => member.kind === 'native' && member.role === 'basic-letter' && member.draft.documentCategory !== 'forms') && <p className="text-sm text-muted-foreground">Finish the letter's printed name and signing block in its native working-copy editor. Intake does not create a signature or approval.</p>}
      {files.error && <p role="alert" className="text-sm text-destructive">{files.error}</p>}
      {files.slots.length > 0 && <section aria-label="Action PDF files" className="min-w-0 space-y-3 rounded border p-3">
        <h4 className="text-sm font-medium">Supporting PDFs</h4><p className="text-xs text-muted-foreground">Selected files are retained only when you apply a reviewed preview. Required files stay unresolved until actual PDFs are applied.</p>
        {files.slots.map(slot => {
          const captured = mode === 'saved' ? revision?.templateState?.instances.find(instance => instance.key === slot.key) : undefined;
          const saved = captured && revision?.members.find(member => member.id === captured.memberId);
          return <div key={slot.key} className="min-w-0 space-y-2 border-t pt-2 text-sm">
          <p className="break-words text-xs text-muted-foreground">{saved?.kind === 'original' ? `Saved original: ${saved.original.name}${saved.signedOriginal ? ' · marked signed by uploader' : ''}` : 'No original PDF saved for this slot.'}</p>
          <label className="block break-words">{slot.label}<input aria-label={`PDF for ${slot.label}`} className="mt-1 block w-full min-w-0 text-xs file:mr-2 file:max-w-full file:whitespace-normal" type="file" accept=".pdf,application/pdf" disabled={locked}
            onChange={event => {
              const file = event.target.files?.[0]; event.target.value = '';
              if (file) void perform(async capture => {
                if (!/\.pdf$/i.test(file.name) || file.size < 1 || file.size > 25 * 1024 * 1024) throw new Error('Choose a nonempty PDF no larger than 25 MB.');
                const total = Object.entries(attachments).reduce((sum, [key, value]) => sum + (key === slot.key ? 0 : value.data.byteLength), file.size);
                if (total > MAX_TEMPLATE_ACTION_BYTES) throw new Error('Selected action files exceed the combined 64 MB limit.');
                const data = await file.arrayBuffer();
                if (current(capture)) { invalidate(); setAttachments(previous => ({ ...previous, [slot.key]: { name: file.name, data, signedOriginal: false } })); setAttachmentLabels(previous => ({ ...previous, [slot.key]: slot.label })); }
              });
            }} /></label>
          {attachments[slot.key] && <><p className="break-words">Selected: {attachments[slot.key].name}</p>
            <label className="flex items-start gap-2"><input type="checkbox" disabled={locked} checked={attachments[slot.key].signedOriginal} onChange={event => {
              invalidate(); setAttachments(previous => ({ ...previous, [slot.key]: { ...previous[slot.key], signedOriginal: event.target.checked } }));
            }} />I mark this original as signed; its signature has not been verified.</label>
            <Button className={buttonClass} variant="outline" disabled={locked} onClick={() => removeFile(slot.key)}>Remove selected PDF for {slot.label}</Button>
          </>}
        </div>; })}
      </section>}
      {hasInactiveFiles && <section aria-label="Inactive selected PDFs" className="min-w-0 space-y-3 rounded border p-3 text-sm">
        <h4 className="font-medium">Inactive selected PDFs</h4>
        <p>These selected files are outside the current branch. Remove them or restore the relevant answers before applying.</p>
        {Object.entries(attachments).filter(([key]) => !files.slots.some(slot => slot.key === key)).map(([key, file]) => <div key={key} className="min-w-0 space-y-2">
          <p className="break-words">{attachmentLabels[key] ?? 'Supporting PDF'}: {file.name}</p>
          <Button className={buttonClass} variant="outline" disabled={locked} aria-label={`Remove inactive PDF ${attachmentLabels[key] ?? key}: ${file.name}`} onClick={() => removeFile(key)}>Remove inactive selection {file.name}</Button>
        </div>)}
      </section>}
      {mode === 'new' || editable ? <div className="space-y-3">
        {(Object.keys(attachments).length > 0 || hasDecisions) && <p className="text-xs text-muted-foreground">Selected files and document decisions save with Apply. Save intake draft stores answers only; remove the selected files and clear preview decisions to use it.</p>}
        {hasDecisions && <Button className={buttonClass} variant="outline" disabled={locked} onClick={() => { invalidate(true); }}>Clear preview decisions</Button>}
        <div className="flex flex-wrap gap-2">
          <Button className={buttonClass} variant="outline" disabled={locked || !dirty || !validShape || Object.keys(attachments).length > 0 || hasDecisions} onClick={() => void perform(async capture => {
            const next = await saveConditionalPackageDraft(input(), await getExportDeploymentPolicy(), capture.signal, () => current(capture));
            if (current(capture)) { accept(next); setNotice(''); }
          })}>Save intake draft</Button>
          <Button className={buttonClass} disabled={locked || !validShape || hasInactiveFiles} onClick={() => void perform(async capture => {
            setFresh(false); setReviewed(false);
            const value = await prepareConditionalPackage({ ...input(), attachments, memberChoices, answerChoices, fieldChoices }, await getExportDeploymentPolicy(), capture.signal);
            if (current(capture)) { setPreview(value); setFresh(true); setReviewed(false); }
          })}>Preview action changes</Button>
          <Button className={buttonClass} variant="outline" disabled={locked || !dirty} onClick={discard}>Discard intake changes</Button>
        </div>
        {preview && <PackageIntakePreview preview={preview} fresh={fresh} disabled={locked} reviewed={reviewed} memberChoices={memberChoices} answerChoices={answerChoices} fieldChoices={fieldChoices}
          onMemberChoice={(key, value) => decide(setMemberChoices, memberChoices, key, value)} onAnswerChoice={(key, value) => decide(setAnswerChoices, answerChoices, key, value)}
          onFieldChoice={(key, value) => decide(setFieldChoices, fieldChoices, key, value)} onReviewed={setReviewed} onApply={() => void perform(async capture => {
            try {
              const next = await applyPreparedConditionalPackage(preview, await getExportDeploymentPolicy(), reviewed, capture.signal, () => current(capture));
              if (current(capture)) { accept(next.record, next.undo); setNotice('Action changes applied as a new saved revision.'); }
            } catch (cause) { if (alive.current) { setFresh(false); setReviewed(false); } throw cause; }
          })} />}
        {undo && <Button className={buttonClass} variant="outline" disabled={locked || dirty} onClick={() => void perform(async capture => {
          const next = await undoConditionalPackage(undo, await getExportDeploymentPolicy(), capture.signal, () => current(capture));
          if (current(capture)) { accept(next); setNotice('Action changes restored in a new saved revision.'); }
        })}>Undo action changes</Button>}
      </div> : null}
    </>}
  </section>;
}

import { evidenceUploadSlot } from '@/lib/packageEvidenceFiles';
import { PackagePdfCompatibility } from './PackagePdfCompatibility';
import { matchesPackageDestination, type PackageDestinationRequest } from '@/lib/packageDestinations';
import { PackageRevisionPicker } from './PackageRevisionPicker';
import { packageRevisionSources } from '@/lib/packageRevisionSources';
import type { ConditionalPdfChoice } from '@/lib/packageConditional';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { PackageIntakeQuestions } from './PackageIntakeQuestions';
import { PackageIntakeScope } from './PackageIntakeScope';
import { PackageIntakePreview, type IntakeAnswerChoice, type IntakeMemberChoice } from './PackageIntakePreview';
import { maintainedPackageAction, maintainedPackageActions, type MaintainedPackageActionId } from '@/lib/maintainedPackageActions';
import { freshPackageTemplateAnswers, intakeAttachmentSlots, intakeQuestionKey, intakeQuestions } from '@/lib/conditionalIntakeView';
import { applyPreparedConditionalPackage, conditionalPackageAnswers, prepareConditionalPackage, readConditionalPackageTemplate,
  saveConditionalPackageDraft, startConditionalPackage, listConditionalPackageInstances, undoConditionalPackage, type ConditionalPackageUndo, type PreparedConditionalPackage } from '@/lib/packageConditional';
import { getPackageRevision, type ActionPackage, type PackageRevision } from '@/lib/actionPackages';
import { nextMembershipQuestion, type PackageTemplateAnswers } from '@/lib/packageTemplateProgram';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';
import { listPackageTemplates, MAX_TEMPLATE_ACTION_BYTES } from '@/lib/packageTemplateLibrary';
import type { PackageUpdateChoices } from '@/lib/packageUpdates';
import { sameReviewStoredValue } from '@/lib/documentsDb';
import { getExportDeploymentPolicy } from '@/config/classification';
import { showAppConfirm } from '@/stores/alertStore';
import { z } from 'zod';
import { usePackageEditDraft } from '@/hooks/usePackageEditDraft';
import { packageEditDraftScope } from '@/lib/packageEditDrafts';
import { conditionalMembershipFindings } from '@/lib/packageConditionalSources';
import { clearPackageNewActionContext, rememberPackageNewActionContext, type PackageNewActionContext } from '@/lib/packageNewActionContext';

const inputClass = 'mt-1 w-full min-w-0 rounded border bg-background p-2';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
interface Props {
  destination?: PackageDestinationRequest;
  record?: ActionPackage;
  revision?: PackageRevision;
  editable: boolean;
  disabled: boolean;
  busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  onApply(record: ActionPackage): void;
  onStartWithDocuments?(record: ActionPackage): void;
  signal(): AbortSignal | undefined;
  isCurrent(): boolean;
  onDirtyChange?(dirty: boolean): void;
  workspace?: boolean;
  onRecoveryChange?(ready: boolean): void;
  onEditingChange?(active: boolean): void;
  onNewActionChange?(active: boolean): void;
  resume?: PackageNewActionContext;
}
interface Token { generation: number; owner: string; signal?: AbortSignal }
const emptyAnswers = (): PackageTemplateAnswers => ({ version: 1, values: {}, groups: {} });
const scope = (record?: ActionPackage, revision?: PackageRevision) => `${record?.id ?? ''}:${record?.sequence ?? ''}:${revision?.id ?? ''}`;
const recoveredValues = z.record(z.string().max(100), z.union([z.string().max(10000), z.boolean()]));
const recoveredIntake = z.object({
  name: z.string().max(120),
  answers: z.object({ version: z.literal(1), values: recoveredValues, groups: z.record(z.string().max(100), z.array(z.object({ id: z.string().max(100), label: z.string().max(160), answers: recoveredValues })).max(20)) }),
  attachments: z.record(z.string().max(500), z.union([z.object({ name: z.string().max(1000), data: z.union([z.instanceof(ArrayBuffer), z.instanceof(Blob)]), signedOriginal: z.boolean() }),
    z.object({ name: z.string().max(1000), reuse: z.object({ memberId: z.string().min(1).max(100), revisionId: z.string().min(1).max(100) }) })])),
  attachmentLabels: z.record(z.string().max(500), z.string().max(1000)),
  memberChoices: z.record(z.string().max(500), z.enum(['keep', 'remove', 'restore'])),
  answerChoices: z.record(z.string().max(500), z.enum(['keep-current', 'use-intake'])),
  fieldChoices: z.record(z.string().max(500), z.enum(['apply-package', 'keep-local', 'detach', 'reconnect'])),
}).strict();

export function PackageIntakePanel({ destination, record, revision, editable, disabled, busy, run, onApply, onStartWithDocuments, signal, isCurrent, onDirtyChange, workspace = false, onRecoveryChange, onNewActionChange, onEditingChange, resume }: Props) {
  const [search, setSearch] = useState('');
  const [inspectedAction, setInspectedAction] = useState<{ id: string; initial: string[]; remaining: string[] }>();
  const ownerScope = scope(record, revision);
  const [template, setTemplate] = useState<PackageTemplateV2 | null>(null), [answers, setAnswers] = useState(emptyAnswers);
  const [mode, setMode] = useState<'none' | 'new' | 'saved'>('none'), [name, setName] = useState('');
  const [baseline, setBaseline] = useState<{ answers: PackageTemplateAnswers; name: string } | null>(null);
  const [open, setOpen] = useState(false), [focusQuestions, setFocusQuestions] = useState(false), [questionKey, setQuestionKey] = useState(0);
  const [reload, setReload] = useState(0);
  const [loadState, setLoadState] = useState(() => ({ owner: ownerScope, reload, pending: !!revision?.templateState }));
  // Hide stale intake before an asynchronous read starts, including reloads.
  const loading = !!revision?.templateState && (loadState.owner !== ownerScope || loadState.reload !== reload || loadState.pending);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loadedOwner, setLoadedOwner] = useState('');
  const [resuming, setResuming] = useState(false);
  const [actionContext, setActionContext] = useState<PackageNewActionContext | null>(null);
  const resumedAction = useRef(false);
  const [preview, setPreview] = useState<PreparedConditionalPackage | null>(null), [fresh, setFresh] = useState(false), [reviewed, setReviewed] = useState(false);
  const [memberChoices, setMemberChoices] = useState<Record<string, IntakeMemberChoice>>({}), [answerChoices, setAnswerChoices] = useState<Record<string, IntakeAnswerChoice>>({});
  const [fieldChoices, setFieldChoices] = useState<PackageUpdateChoices>({}), [attachments, setAttachments] = useState<Record<string, ConditionalPdfChoice>>({});
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
  useLayoutEffect(() => { selectedSource.current = { record, revision }; owner.current = ownerScope; dirtyCallback.current = onDirtyChange; });
  const hasDecisions = Object.keys(memberChoices).length + Object.keys(answerChoices).length + Object.keys(fieldChoices).length > 0;
  const dirty = !!template && (!baseline || name !== baseline.name || !sameReviewStoredValue(answers, baseline.answers)
    || Object.keys(attachments).length > 0 || hasDecisions);
  useEffect(() => { onNewActionChange?.(workspace && mode === 'new' && !!template); }, [workspace, mode, template, onNewActionChange]);
  useEffect(() => {
    onEditingChange?.(workspace && open && mode === 'saved');
    return () => onEditingChange?.(false);
  }, [workspace, open, mode, onEditingChange]);
  const sources = useMemo(() => record && revision && mode === 'saved'
    ? packageRevisionSources(record, revision.id).filter(source => source.originalPdf) : [], [record, revision, mode]);
  const recoverableFiles = useMemo(() => Object.fromEntries(Object.entries(attachments).map(([key, file]) => [key, 'reuse' in file ? file : { ...file, data: new Blob([file.data]) }])), [attachments]);
  const recovery = usePackageEditDraft({
    scope: packageEditDraftScope(mode === 'saved' ? record?.id ?? '' : `new-${template?.id ?? ''}`, mode === 'saved' ? revision?.id ?? '' : `template-${template?.program.revision ?? 0}`, 'intake'),
    value: useMemo(() => ({ name, answers, attachments: recoverableFiles, attachmentLabels, memberChoices, answerChoices, fieldChoices }), [name, answers, recoverableFiles, attachmentLabels, memberChoices, answerChoices, fieldChoices]),
    dirty, enabled: workspace && !!template && (mode === 'new' || editable && !loading && loadedOwner === ownerScope),
    async restore(value, isCurrentDraft) {
      const parsed = recoveredIntake.safeParse(value);
      if (!parsed.success || Object.values(parsed.data.attachments).reduce((sum, file) => sum + ('reuse' in file ? 0 : file.data instanceof Blob ? file.data.size : file.data.byteLength), 0) > MAX_TEMPLATE_ACTION_BYTES)
        throw new Error('This unfinished action could not be recovered. The saved package is unchanged.');
      const next = parsed.data;
      const restoredFiles = Object.fromEntries(await Promise.all(Object.entries(next.attachments).map(async ([key, file]) => [key, 'reuse' in file ? file : { ...file, data: file.data instanceof Blob ? await file.data.arrayBuffer() : file.data }] as const)));
      if (!isCurrentDraft()) return;
      generation.current++; setName(next.name); setAnswers(next.answers); setAttachments(restoredFiles); setAttachmentLabels(next.attachmentLabels);
      setMemberChoices(next.memberChoices); setAnswerChoices(next.answerChoices); setFieldChoices(next.fieldChoices);
      setPreview(null); setFresh(false); setReviewed(false); setOpen(true); setFocusQuestions(false); setQuestionKey(value => value + 1);
      setNotice('Recovered unapplied edits.');
    },
  });
  const viewDisabled = disabled || busy || pending || loading || resuming || recovery.status === 'loading', locked = viewDisabled || mode === 'saved' && !editable;
  const needsReconciliation = !!revision?.templateState && conditionalMembershipFindings(revision).length > 0;
  useEffect(() => {
    if (workspace && mode === 'new' && dirty && recovery.status === 'saved' && actionContext) rememberPackageNewActionContext(actionContext);
  }, [workspace, mode, dirty, recovery.status, actionContext]);
  useLayoutEffect(() => {
    onRecoveryChange?.(workspace && dirty && recovery.status === 'saved');
    return () => onRecoveryChange?.(false);
  }, [onRecoveryChange, workspace, dirty, recovery.status]);
  useLayoutEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; dirtyCallback.current?.(false); }; }, []);
  useEffect(() => {
    if (!workspace || !resume || record || resumedAction.current) return;
    resumedAction.current = true;
    const capturedOwner = ownerScope;
    let current = true, completed = false;
    queueMicrotask(() => { if (current) setResuming(true); });
    void (async () => {
      await Promise.resolve();
      const request = generation.current;
      const value = resume.source === 'maintained'
        ? await maintainedPackageAction(resume.id as MaintainedPackageActionId)
        : (await listPackageTemplates()).find((item): item is PackageTemplateV2 => item.version === 2 && item.id === resume.id && item.program.revision === resume.revision);
      if (!value || value.program.revision !== resume.revision) throw new Error('The exact starter for your unfinished action is unavailable.');
      if (current && owner.current === capturedOwner && generation.current === request) { completed = true; choose(value, resume.source === 'maintained' ? resume.id as MaintainedPackageActionId : undefined); }
    })().catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'The unfinished action could not be opened.'); })
      .finally(() => { if (current && owner.current === capturedOwner) setResuming(false); });
    return () => { current = false; if (!completed) resumedAction.current = false; };
  }, [workspace, resume, record, ownerScope]);
  useEffect(() => {
    if (returnFocus.current && !viewDisabled) { heading.current?.focus(); returnFocus.current = false; }
  }, [questionKey, viewDisabled]);
  useEffect(() => {
    const setLoading = (pending: boolean) => setLoadState({ owner: ownerScope, reload, pending });
    if (ownScope.current === ownerScope) { ownScope.current = ''; return; }
    const { record, revision } = selectedSource.current;
    ++generation.current;
    let currentLoad = true;
    setLoadedOwner('');
    setPreview(null); setFresh(false); setReviewed(false); setUndo(null); setAttachments({}); setAttachmentLabels({}); setMemberChoices({}); setAnswerChoices({}); setFieldChoices({}); setNotice(''); setError('');
    if (!record || !revision?.templateState) {
      setTemplate(null); setMode('none'); setAnswers(emptyAnswers()); setBaseline(null); setOpen(false); setLoading(false); return;
    }
    setLoading(true);
    void readConditionalPackageTemplate(record, revision.id).then(value => {
      if (!alive.current || !currentLoad || owner.current !== ownerScope) return;
      const resumed = conditionalPackageAnswers(record, revision.id);
      setTemplate(value); setMode('saved'); setAnswers(resumed); setName(record.name); setBaseline({ answers: structuredClone(resumed), name: record.name });
      setLoadedOwner(ownerScope);
      setQuestionKey(value => value + 1); setOpen(!!revision.templateState?.pending); setFocusQuestions(false);
    }).catch(cause => {
      if (alive.current && currentLoad) { setTemplate(null); setMode('none'); setError(cause instanceof Error ? cause.message : 'The saved intake could not be read.'); }
    }).finally(() => { if (alive.current && currentLoad) setLoading(false); });
    return () => { currentLoad = false; };
  }, [ownerScope, reload]);
  const view = useMemo(() => {
    if (!template) return null;
    try { return { value: intakeQuestions(template.program, answers) }; }
    catch (cause) { return { error: cause instanceof Error ? cause.message : 'The intake answers could not be inspected.' }; }
  }, [template, answers]);
  const visibleQuestions = view?.value?.questions.filter(item => item.instance.visibility === true) ?? [];
  const summaryGroups = [
    { key: 'package', label: '', questions: visibleQuestions.filter(item => !item.instance.scope) },
    ...(template?.program.participantGroups ?? []).flatMap(group => (answers.groups[group.id] ?? []).map(person => ({
      key: `${group.id}:${person.id}`, label: person.label,
      questions: visibleQuestions.filter(item => item.instance.scope?.groupId === group.id && item.instance.scope.participantId === person.id),
    }))),
  ];
  const files = useMemo(() => {
    if (!template || view?.error || view?.value?.invalidLabels.length) return { slots: [] };
    try { return { slots: intakeAttachmentSlots(template, answers) }; }
    catch (cause) { return { slots: [], error: cause instanceof Error ? cause.message : 'The file slots could not be inspected.' }; }
  }, [template, answers, view]);
  const validShape = !!template && !view?.error && !view?.value?.invalidLabels.length && !!name.trim();
  const [dismissedQuestionRequest, dismissQuestionRequest] = useState<number>();
  const questionTarget = useMemo(() => {
    if (!record || !revision || !template || !matchesPackageDestination(destination, record.id, revision.id)
      || destination.panel !== 'intake' || destination.requestId === dismissedQuestionRequest) return;
    let key = destination.intakeQuestion;
    const slot = destination.intakeSlot && revision.templateState?.instances.find(instance => instance.key === destination.intakeSlot);
    if (slot && slot.condition === 'unknown') {
      const blueprint = template.members.find(member => member.key === slot.memberKey);
      const next = blueprint && nextMembershipQuestion(template.program, answers, [blueprint], slot.participantId);
      if (next) key = intakeQuestionKey(next);
    }
    return key && view?.value?.questions.some(item => item.key === key && item.instance.visibility === true) ? key : undefined;
  }, [record, revision, template, destination, dismissedQuestionRequest, answers, view]);
  const focusedDeliveryRequest = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!record || !revision || !template || loading || !matchesPackageDestination(destination, record.id, revision.id)
      || viewDisabled || destination.panel !== 'intake' || focusedDeliveryRequest.current === destination.requestId) return;
    if (!open) {
      const frame = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(frame);
    }
    if (questionTarget) {
      focusedDeliveryRequest.current = destination.requestId;
      return;
    }
    const input = Array.from(heading.current?.closest('section')?.querySelectorAll<HTMLInputElement>('input[data-intake-slot]') ?? [])
      .find(item => item.dataset.intakeSlot === destination.intakeSlot);
    (input ?? heading.current)?.focus();
    (input ?? heading.current)?.scrollIntoView({ block: 'center' });
    focusedDeliveryRequest.current = destination.requestId;
  }, [destination, record, revision, template, loading, open, viewDisabled, questionTarget]);
  const hasInactiveFiles = Object.keys(attachments).some(key => !files.slots.some(slot => slot.key === evidenceUploadSlot(key)));
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
    if (mode === 'new' && actionContext) clearPackageNewActionContext(actionContext);
    void recovery.clear().catch(() => undefined);
    const selected = getPackageRevision(next), nextAnswers = conditionalPackageAnswers(next);
    ownScope.current = scope(next, selected);
    setLoadedOwner(ownScope.current); setLoadState({ owner: ownScope.current, reload, pending: false });
    generation.current++; setMode('saved'); setAnswers(nextAnswers); setName(next.name); setBaseline({ answers: structuredClone(nextAnswers), name: next.name });
    setAttachments({}); setAttachmentLabels({}); setPreview(null); setFresh(false); setReviewed(false); setMemberChoices({}); setAnswerChoices({}); setFieldChoices({}); setUndo(receipt ?? null);
    setQuestionKey(value => value + 1); setOpen(!!selected.templateState?.pending); setFocusQuestions(false); returnFocus.current = true;
    dirtyCallback.current?.(false); onApply(next);
  }
  function choose(value: PackageTemplateV2, maintainedId?: MaintainedPackageActionId) {
    setActionContext({ source: maintainedId ? 'maintained' : 'library', id: maintainedId ?? value.id, revision: value.program.revision });
    const initialAnswers = freshPackageTemplateAnswers(value.program);
    generation.current++; setTemplate(value); setAnswers(initialAnswers); setName(value.name); setMode('new'); setBaseline({ answers: structuredClone(initialAnswers), name: value.name });
    setAttachments({}); setAttachmentLabels({}); setMemberChoices({}); setAnswerChoices({}); setFieldChoices({}); setPreview(null); setFresh(false); setReviewed(false); setUndo(null);
    setOpen(true); setFocusQuestions(true); setQuestionKey(value => value + 1); setNotice(''); setError('');
  }
  async function discard() {
    const capture = token(); setPending(true);
    try { await recovery.clear(); }
    catch (cause) { if (alive.current) { setError(cause instanceof Error ? cause.message : 'The local draft could not be discarded.'); setPending(false); } return; }
    if (!current(capture)) { if (alive.current) setPending(false); return; }
    if (mode === 'new' && actionContext) clearPackageNewActionContext(actionContext);
    invalidate(true); setAttachments({}); setAttachmentLabels({}); setPreview(null); setUndo(null); setQuestionKey(value => value + 1); returnFocus.current = true;
    if (mode === 'new' || !baseline) {
      setTemplate(null); setAnswers(emptyAnswers()); setMode('none'); setBaseline(null); setOpen(false);
      if (record && revision?.templateState) { ownScope.current = ''; setReload(value => value + 1); }
    }
    else { setAnswers(structuredClone(baseline.answers)); setName(baseline.name); setOpen(!!revision?.templateState?.pending); setFocusQuestions(false); }
    setPending(false);
  }
  async function backToActions() {
    if (viewDisabled) return;
    const capture = token();
    if ((dirty || recovery.error) && !await showAppConfirm({ title: workspace ? 'Discard this draft?' : 'Discard intake changes?',
      message: workspace ? 'Return to the action list and discard your entered details and selected files.' : 'Return to the action list and discard the unsaved answers and selected files for this new action?',
      confirmLabel: 'Discard changes', destructive: true })) return;
    if (current(capture)) await discard();
  }
  function input() {
    if (!template) throw new Error('Choose an action first.');
    return { template, answers, name, ...(mode === 'saved' && record ? { record } : {}) };
  }
  function removeFile(key: string) {
    invalidate();
    setAttachments(previous => {
      const next = { ...previous };
      delete next[key];
      const first = Object.keys(next).find(candidate => evidenceUploadSlot(candidate) === key);
      if (first) { next[key] = next[first]; delete next[first]; }
      return next;
    });
    setAttachmentLabels(previous => { const next = { ...previous }; delete next[key]; return next; });
  }
  function decide<T extends string>(set: (value: Record<string, T>) => void, values: Readonly<Record<string, T>>, key: string, value: T | undefined) {
    invalidate(); const next = { ...values }; if (value === undefined) delete next[key]; else next[key] = value; set(next);
  }
  const savedPending = workspace && mode === 'saved' && !!revision?.templateState?.pending && !dirty;
  const reviewUpdates = <Button className={buttonClass} disabled={locked || !validShape || hasInactiveFiles || workspace && mode === 'saved' && !dirty && !needsReconciliation}
    onClick={() => void perform(async capture => {
      setFresh(false); setReviewed(false);
      const value = await prepareConditionalPackage({ ...input(), attachments, memberChoices, answerChoices, fieldChoices }, await getExportDeploymentPolicy(), capture.signal);
      if (current(capture)) { setPreview(value); setFresh(true); setReviewed(false); }
    })}>{savedPending ? 'Review document updates' : workspace ? 'Review changes' : 'Preview action changes'}</Button>;
  const catalogLocked = viewDisabled || dirty;
  const query = search.trim().toLocaleLowerCase();
  const matches = maintainedPackageActions.filter(action => [action.name, action.description, action.kind].some(text => text.toLocaleLowerCase().includes(query)));
  const catalog = <div className="space-y-3"><label className="block max-w-md text-sm">Search actions
    <input type="search" className={inputClass} value={search} disabled={catalogLocked} onChange={event => setSearch(event.target.value)} /></label>
    {!matches.length && <p className="text-sm">No matching actions. <Button variant="link" size="sm" onClick={() => setSearch('')}>Clear search</Button></p>}
    <div className="grid min-w-0 gap-3 md:grid-cols-3">{matches.map(action => <article key={action.id} className="min-w-0 space-y-2 rounded border p-3">
    <p className="text-xs text-muted-foreground">{action.kind}</p><h4 className="font-medium">{action.name}</h4><p className="text-sm text-muted-foreground">{action.description}</p>
    <Button className={buttonClass} variant="outline" disabled={catalogLocked} onClick={() => void perform(async capture => {
      const selected = await maintainedPackageAction(action.id);
      if (!current(capture)) return;
      if (onStartWithDocuments && action.startWithDocuments) {
        const next = await startConditionalPackage(selected, await getExportDeploymentPolicy(), capture.signal, () => current(capture));
        if (current(capture)) onStartWithDocuments(next);
      } else choose(selected, action.id);
    })}>{action.startLabel ?? `Start ${action.name.toLocaleLowerCase()}`}</Button>
    {workspace && <div><Button size="sm" variant="link" className="h-auto p-0" disabled={catalogLocked} aria-label={'Package contents for ' + action.name} aria-expanded={inspectedAction?.id === action.id}
      onClick={() => {
        if (inspectedAction?.id === action.id) { setInspectedAction(undefined); return; }
        void perform(async capture => {
          const selected = await maintainedPackageAction(action.id);
          if (!current(capture)) return;
          const initial = new Set(action.startWithDocuments ? listConditionalPackageInstances(selected, emptyAnswers())
            .filter(slot => slot.condition === true && selected.members.some(member => member.key === slot.memberKey && member.kind === 'native')).map(slot => slot.memberKey) : []);
          setInspectedAction({ id: action.id, initial: selected.members.filter(member => initial.has(member.key)).map(member => member.label),
            remaining: selected.members.filter(member => !initial.has(member.key)).map(member => member.label) });
        });
      }}>Package contents</Button>
      {inspectedAction?.id === action.id && <div className="mt-2 space-y-1 text-xs">
        <p className="font-medium">Included at start</p>
        {inspectedAction.initial.length ? <ul>{inspectedAction.initial.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>Complete the package details to add documents.</p>}
        {!!inspectedAction.remaining.length && <details><summary>Other possible documents ({inspectedAction.remaining.length})</summary>
          <ul>{inspectedAction.remaining.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      </div>}
    </div>}
  </article>)}</div></div>;
  return <section tabIndex={-1} data-package-panel="intake" aria-label="Action intake" className={`min-w-0 space-y-4 ${workspace && mode !== 'saved' && !loading ? '' : 'rounded-lg border bg-background p-3 sm:p-4'}`} aria-busy={pending || loading}>
    <div className="space-y-1">
      {mode === 'new' && <Button className={buttonClass} variant="outline" disabled={viewDisabled} onClick={() => void backToActions()}>Back to actions</Button>}
      <h3 ref={heading} tabIndex={-1} className="break-words font-medium">{workspace && (mode === 'saved' || loading) ? 'Details' : loading ? 'Action intake' : template?.name ?? (maintainedPackageActions.length ? 'Start from an action' : 'Package templates')}</h3>
      {loading && <p role="status" className="text-sm">Loading the exact saved intake…</p>}
      {!loading && template && <p role="status" className="text-xs text-muted-foreground">{workspace && dirty ? recovery.status === 'saved' ? 'Draft saved locally · not applied' : recovery.status === 'saving' ? 'Saving draft…' : 'Unapplied edits' : workspace && mode === 'new' ? '' : workspace && mode === 'saved' && !needsReconciliation ? '' : dirty ? 'Unapplied intake changes · not saved.' : mode === 'new' ? 'No intake answers changed yet.' : revision?.templateState?.pending
        ? 'Intake saved; document changes not applied.' : "Showing this revision's saved intake and package values."}</p>}
      {savedPending && editable && !loading && !fresh && reviewUpdates}
      {mode === 'new' && !workspace && <p className="text-sm text-muted-foreground">New action · creates a separate package with fresh answers.</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {recovery.error && <div className="space-y-2"><p role="alert" className="break-words text-sm text-destructive">{recovery.error}</p><Button variant="outline" size="sm" disabled={pending} onClick={() => void discard()}>Discard local draft</Button></div>}
      {view?.error && <p role="alert" className="break-words text-sm text-destructive">{view.error}</p>}
    </div>
    <div hidden={workspace && (loading || mode !== 'none')} className="space-y-4">
    {maintainedPackageActions.length > 0 && (!template ? catalog : <details><summary className="cursor-pointer text-sm font-medium">Start another action</summary><div className="pt-3">{catalog}</div></details>)}
    <details className="min-w-0 rounded border p-3"><summary className="cursor-pointer text-sm font-medium">Use a saved conditional template</summary>
      <div className="space-y-3 pt-3">
        <Button className={buttonClass} variant="outline" disabled={catalogLocked} onClick={() => void perform(async capture => {
          const values = (await listPackageTemplates()).filter((value): value is PackageTemplateV2 => value.version === 2);
          if (current(capture)) { setLibrary(values); setLibraryId(''); }
        })}>Load saved conditional templates</Button>
        {library && <><label className="block text-sm">Saved conditional template<select className={inputClass} value={libraryId} disabled={catalogLocked} onChange={event => setLibraryId(event.target.value)}>
          <option value="">Choose a saved template</option>{library.map(value => <option key={value.id} value={value.id}>{value.name} · revision {value.program.revision} · {value.id.slice(-8)}</option>)}
        </select></label>
          {!library.length && <p className="text-sm text-muted-foreground">No saved conditional templates.</p>}
          <Button className={buttonClass} variant="outline" disabled={catalogLocked || !libraryId} onClick={() => { const value = library.find(value => value.id === libraryId); if (value) choose(structuredClone(value)); }}>Use selected conditional template</Button>
        </>}
      </div>
    </details>
    </div>
    {template && !loading && <>
      {!workspace && <PackageIntakeScope key={template.id} template={template} />}
      {workspace && mode === 'saved' && !open && <div role="group" aria-label="Details summary" className="space-y-7">{summaryGroups.filter(group => group.questions.length > 0).map(group => <div key={group.key}>
        {group.label && <h4 className="mb-4 text-sm font-medium">{group.label}</h4>}
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">{group.questions.map(item => <div key={item.key}><dt className="text-xs text-muted-foreground">{item.questionLabel}</dt><dd className="mt-1 break-words text-sm">{typeof item.instance.value === 'boolean' ? item.instance.value ? 'Yes' : 'No' : item.question.options?.find(option => option.id === item.instance.value)?.label ?? item.instance.value ?? 'Not entered'}</dd></div>)}</dl>
      </div>)}</div>}
      {mode === 'saved' && !editable && <p className="text-sm text-muted-foreground">This saved intake is read-only in a historical, archived or reviewer copy.</p>}
      <Button hidden={workspace && mode === 'new'} className={buttonClass} variant="outline" disabled={viewDisabled} aria-expanded={open} onClick={() => { dismissQuestionRequest(destination?.requestId); setOpen(value => !value); setFocusQuestions(true); }}>
        {workspace && mode === 'saved' ? open ? 'Collapse details' : editable ? 'Edit details' : 'View details' : open ? 'Collapse intake questions' : editable || mode === 'new' ? 'Continue intake' : 'Inspect saved intake'}
      </Button>
      {open && <div className="min-w-0 space-y-4">
        <label className="block text-sm">{workspace ? 'Package name' : 'Action name'}<input className={inputClass} value={name} maxLength={120} disabled={locked} autoComplete="off" onChange={event => { invalidate(); setName(event.target.value); }} /></label>
        {!view?.error && <PackageIntakeQuestions key={questionKey + ':' + (destination?.panel === 'intake' ? destination.requestId : '')}
          focusQuestion={questionTarget}
          program={template.program} answers={answers} disabled={locked} busy={viewDisabled} onChange={editAnswers} focusFirst={focusQuestions} showAll={workspace} />}
      </div>}
      {!workspace && template.members.some(member => member.kind === 'native' && member.role === 'basic-letter' && member.draft.documentCategory !== 'forms') && <p className="text-sm text-muted-foreground">Finish the letter's printed name and signing block in its native working-copy editor. Intake does not create a signature or approval.</p>}
      {files.error && <p role="alert" className="text-sm text-destructive">{files.error}</p>}
      {files.slots.length > 0 && <section aria-label="Action PDF files" className="min-w-0 space-y-3 rounded border p-3">
        <h4 className="text-sm font-medium">Supporting PDFs</h4><p className="text-xs text-muted-foreground">Apply reviewed changes to save staged files to the package.</p>
        {files.slots.map(slot => {
          const captured = mode === 'saved' ? revision?.templateState?.instances.find(instance => instance.key === slot.key) : undefined;
          const saved = captured && revision?.members.find(member => member.id === captured.memberId);
          const selected = attachments[slot.key];
          return <div key={slot.key} className="min-w-0 space-y-2 border-t pt-2 text-sm">
          <p className="font-medium">{slot.label}</p>
          {captured && revision?.members.filter(member => member.kind === 'original' && (member.id === captured.memberId || member.evidenceSlotId === captured.memberId)).map(member =>
            member.kind === 'original' && <p key={member.id} className="break-words text-xs text-muted-foreground">Saved to package · {member.original.name}{member.signedOriginal && ' · marked signed by uploader'}</p>)}
          {!saved && <PackageRevisionPicker label={slot.label} sources={sources} disabled={locked}
            value={selected && 'reuse' in selected ? selected.reuse : undefined} onSelect={source => {
              invalidate();
              setAttachments(previous => ({ ...previous, [slot.key]: { name: source.label, reuse: { memberId: source.memberId, revisionId: source.revisionId } } }));
              setAttachmentLabels(previous => ({ ...previous, [slot.key]: slot.label }));
            }} />}
          <label className="relative inline-flex cursor-pointer rounded-md border px-3 py-1.5 text-sm focus-within:ring-2">
            {slot.multipleFiles ? 'Add PDFs' : selected || saved ? 'Choose replacement PDF' : 'Choose PDF'}<input data-intake-slot={slot.key} aria-label={`PDF for ${slot.label}`} className="absolute inset-0 w-full cursor-pointer opacity-0" type="file" multiple={slot.multipleFiles} accept=".pdf,application/pdf" disabled={locked}
            onChange={event => {
              const files = Array.from(event.target.files ?? []); event.target.value = '';
              if (files.length) void perform(async capture => {
                if (files.some(file => !/\.pdf$/i.test(file.name) || file.size < 1 || file.size > 25 * 1024 * 1024)) throw new Error('Choose PDFs up to 25 MB each.');
                const total = Object.entries(attachments).reduce((sum, [key, value]) => sum + (!slot.multipleFiles && key === slot.key || 'reuse' in value ? 0 : value.data.byteLength), files.reduce((sum, file) => sum + file.size, 0));
                if (total > MAX_TEMPLATE_ACTION_BYTES) throw new Error('Selected action files exceed the combined 64 MB limit.');
                const additions: Record<string, ConditionalPdfChoice> = {};
                for (const [index, file] of files.entries()) {
                  const key = slot.multipleFiles && (saved || selected || index > 0) ? slot.key + '/' + crypto.randomUUID() : slot.key;
                  additions[key] = { name: file.name, data: await file.arrayBuffer(), signedOriginal: false };
                }
                if (current(capture)) {
                  invalidate();
                  setAttachments(previous => ({ ...previous, ...additions }));
                  setAttachmentLabels(previous => ({ ...previous, ...Object.fromEntries(Object.keys(additions).map(key => [key, slot.label])) }));
                }
              });
            }} /></label>
          {Object.entries(attachments).filter(([key]) => evidenceUploadSlot(key) === slot.key && key !== slot.key).map(([key, file]) =>
            <div key={key} className="flex items-center justify-between"><span>Staged · {file.name}</span>
              <Button size="sm" variant="ghost" disabled={locked} aria-label={'Remove ' + file.name} onClick={() => removeFile(key)}>Remove</Button></div>)}
          {selected && <><p className="break-words">Staged · {selected.name}</p>
            {'data' in selected && <PackagePdfCompatibility warningsOnly source={selected.data} />}
            {'signedOriginal' in selected && <label className="flex items-start gap-2"><input type="checkbox" disabled={locked} checked={selected.signedOriginal} onChange={event => {
              invalidate(); setAttachments(previous => ({ ...previous, [slot.key]: { ...selected, signedOriginal: event.target.checked } }));
            }} />I mark this original as signed; its signature has not been verified.</label>}
            <Button className={buttonClass} variant="outline" disabled={locked} onClick={() => removeFile(slot.key)}>Remove selected PDF for {slot.label}</Button>
          </>}
        </div>; })}
      </section>}
      {hasInactiveFiles && <section aria-label="Inactive selected PDFs" className="min-w-0 space-y-3 rounded border p-3 text-sm">
        <h4 className="font-medium">Inactive selected PDFs</h4>
        <p>These selected files are outside the current branch. Remove them or restore the relevant answers before applying.</p>
        {Object.entries(attachments).filter(([key]) => !files.slots.some(slot => slot.key === evidenceUploadSlot(key))).map(([key, file]) => <div key={key} className="min-w-0 space-y-2">
          <p className="break-words">{attachmentLabels[key] ?? 'Supporting PDF'}: {file.name}</p>
          <Button className={buttonClass} variant="outline" disabled={locked} aria-label={`Remove inactive PDF ${attachmentLabels[key] ?? key}: ${file.name}`} onClick={() => removeFile(key)}>Remove inactive selection {file.name}</Button>
        </div>)}
      </section>}
      {mode === 'new' || editable ? <div hidden={workspace && mode === 'saved' && !open && !dirty && !needsReconciliation} className="space-y-3">
        {(Object.keys(attachments).length > 0 || hasDecisions) && <p className="text-xs text-muted-foreground">Selected files and document decisions save with Apply. Save intake draft stores answers only; remove the selected files and clear preview decisions to use it.</p>}
        {hasDecisions && <Button className={buttonClass} variant="outline" disabled={locked} onClick={() => { invalidate(true); }}>Clear preview decisions</Button>}
        <div className="flex flex-wrap gap-2">
          <Button hidden={workspace && mode === 'saved'} className={buttonClass} variant="outline" disabled={locked || mode !== 'new' && !dirty || !validShape || Object.keys(attachments).length > 0 || hasDecisions} onClick={() => void perform(async capture => {
            const next = await saveConditionalPackageDraft(input(), await getExportDeploymentPolicy(), capture.signal, () => current(capture));
            if (current(capture)) { accept(next); setNotice(''); }
          })}>{workspace ? 'Save package draft' : 'Save intake draft'}</Button>
          {(!savedPending || !editable) && (!workspace || !fresh) && reviewUpdates}
          <Button className={buttonClass} variant="outline" disabled={locked || mode !== 'new' && !dirty} onClick={discard}>{workspace ? 'Discard' : 'Discard intake changes'}</Button>
        </div>
        {preview && <PackageIntakePreview preview={preview} fresh={fresh} disabled={locked} reviewed={reviewed} directApply={workspace} applyLabel={workspace ? mode === 'new' ? 'Create package' : 'Apply changes' : undefined} onBack={workspace ? () => { setPreview(null); setFresh(false); setReviewed(false); setOpen(true); heading.current?.scrollIntoView?.({ block: 'start' }); heading.current?.focus({ preventScroll: true }); } : undefined} memberChoices={memberChoices} answerChoices={answerChoices} fieldChoices={fieldChoices}
          onMemberChoice={(key, value) => decide(setMemberChoices, memberChoices, key, value)} onAnswerChoice={(key, value) => decide(setAnswerChoices, answerChoices, key, value)}
          onFieldChoice={(key, value) => decide(setFieldChoices, fieldChoices, key, value)} onReviewed={setReviewed} onApply={() => void perform(async capture => {
            try {
              const next = await applyPreparedConditionalPackage(preview, await getExportDeploymentPolicy(), workspace || reviewed, capture.signal, () => current(capture));
              if (current(capture)) { accept(next.record, next.undo); setNotice(workspace ? mode === 'new' ? 'Package created.' : 'Changes saved as a new version.' : 'Action changes applied as a new saved revision.'); }
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

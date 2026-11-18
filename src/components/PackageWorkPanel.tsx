import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { newPackageId } from '@/lib/actionPackages';
import { packageWorkSchema, packageWorkToday, isPackageWorkDate, resolvePackageTaskTarget, updatePackageWork, type PackageTask, type PackageWorkDestination } from '@/lib/packageWork';
import { derivePackageNextActions, type PackageNextActions } from '@/lib/packageNextActions';
import { reviewPackageWork } from '@/lib/actionPackageDisclosure';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import type { ExportReview } from '@/lib/preparedExport';
import type { PackageRequirementOperation } from '@/lib/packageRequirementsModel';

interface TaskDraft { id: string; title: string; status: PackageTask['status']; owner: string; dueDate: string; notes: string; target?: PackageTask['target'] }
interface Props {
  record: ActionPackage; revision: PackageRevision; disabled: boolean; busy: boolean; reviewBaseline?: boolean;
  run(action: () => Promise<void>): Promise<void>;
  onApply(record: ActionPackage): void;
  isCurrent(): boolean; signal(): AbortSignal | undefined; onDirtyChange?(dirty: boolean): void;
  onNavigate?(destination: PackageWorkDestination): void;
}
const inputClass = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
function drafts(revision: PackageRevision): TaskDraft[] {
  return (revision.work?.tasks ?? []).map(task => ({ ...structuredClone(task), owner: task.owner ?? '', dueDate: task.dueDate ?? '', notes: task.notes ?? '' }));
}
function proposed(tasks: TaskDraft[]) {
  const result = packageWorkSchema.safeParse({ version: 1, tasks: tasks.map(({ owner, dueDate, notes, ...task }) => ({ ...task,
    ...(owner.trim() ? { owner: owner.trim() } : {}), ...(dueDate ? { dueDate } : {}), ...(notes ? { notes } : {}),
  })) });
  if (!result.success) {
    const issue = result.error.issues[0], ordinal = typeof issue.path[1] === 'number' ? issue.path[1] + 1 : undefined;
    const field = String(issue.path[2] ?? '');
    throw new Error(ordinal ? `Task ${ordinal}${field ? ` ${field === 'dueDate' ? 'due date' : field}` : ''}: ${issue.message}` : issue.message);
  }
  return result.data;
}
const labels = { pdf: 'PDF assembly', review: 'Start review', portable: 'Editable handoff' };

/** Local coordination stays separate from the package's computed evidence and document checks. */
export function PackageWorkPanel({ record, revision, disabled, busy, run, onApply, isCurrent, signal, onDirtyChange,
  onNavigate, reviewBaseline = false }: Props) {
  const heading = useId(), owner = `${record.id}:${record.sequence}:${revision.id}:${record.archived}:${reviewBaseline}`;
  const [base, setBase] = useState(() => drafts(revision)), [draft, setDraft] = useState(() => drafts(revision));
  const [page, setPage] = useState(0), [actionPage, setActionPage] = useState(0), [operation, setOperation] = useState<PackageRequirementOperation>('pdf');
  const [inspection, setInspection] = useState<PackageNextActions | null>(null);
  const [review, setReview] = useState<{ value: ExportReview; policyIdentity: string } | null>(null), [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(false), currentOwner = useRef(owner), lastOwner = useRef(owner), generation = useRef(0), running = useRef(false);
  const dirtyCallback = useRef(onDirtyChange), focusTask = useRef<string | null>(null), taskInputs = useRef(new Map<string, HTMLInputElement>());
  const inspectionPolicy = useRef<string | undefined>(undefined), reviewedPolicy = useRef<string | undefined>(undefined);
  const ownRevision = useRef<string | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null), addButton = useRef<HTMLButtonElement>(null), focusAdd = useRef(false), returnFocus = useRef(false);
  const editable = !disabled && !record.archived && revision.id === record.currentRevisionId && !record.reviewRounds?.some(round => round.ownerPackageId === undefined);
  const dirty = JSON.stringify(base) !== JSON.stringify(draft), locked = !editable || busy || pending;
  useLayoutEffect(() => { currentOwner.current = owner; dirtyCallback.current = onDirtyChange; }, [owner, onDirtyChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; dirtyCallback.current?.(false); }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const checkPolicy = () => {
      const policy = getExportDeploymentPolicySync(), key = policy.status === 'ready' ? JSON.stringify(policy.policy) : '';
      if (inspectionPolicy.current && inspectionPolicy.current !== key || reviewedPolicy.current && reviewedPolicy.current !== key) {
        generation.current++; inspectionPolicy.current = undefined; reviewedPolicy.current = undefined;
        setInspection(null); setReview(null); setReviewed(false); setNotice('Deployment settings changed. Check saved actions or review task changes again.');
      }
    };
    window.addEventListener('focus', checkPolicy); document.addEventListener('visibilitychange', checkPolicy);
    return () => { window.removeEventListener('focus', checkPolicy); document.removeEventListener('visibilitychange', checkPolicy); };
  }, []);
  useLayoutEffect(() => {
    if (lastOwner.current === owner) return;
    lastOwner.current = owner; generation.current++;
    inspectionPolicy.current = undefined; reviewedPolicy.current = undefined;
    const next = drafts(revision); setBase(next); setDraft(structuredClone(next)); setPage(0); setInspection(null); setReview(null); setReviewed(false); setError('');
    if (ownRevision.current !== revision.id) setNotice(''); ownRevision.current = undefined;
  }, [owner, revision]);
  const wasEditable = useRef(editable);
  useLayoutEffect(() => {
    if (wasEditable.current !== editable) { generation.current++; setReview(null); setReviewed(false); }
    wasEditable.current = editable;
  }, [editable]);
  useEffect(() => {
    if (focusTask.current) { taskInputs.current.get(focusTask.current)?.focus(); focusTask.current = null; }
    if (focusAdd.current) { addButton.current?.focus(); focusAdd.current = false; }
  }, [page, draft.length]);
  useEffect(() => { if (returnFocus.current && !pending && !busy) { headingRef.current?.focus(); returnFocus.current = false; } }, [pending, busy]);
  function invalidate() { generation.current++; inspectionPolicy.current = undefined; reviewedPolicy.current = undefined; setReview(null); setReviewed(false); setInspection(null); setError(''); setNotice(''); }
  function edit(id: string, patch: Partial<TaskDraft>) { invalidate(); setDraft(previous => previous.map(task => task.id === id ? { ...task, ...patch } : task)); }
  async function perform(action: (current: () => boolean, operationSignal?: AbortSignal) => Promise<void>) {
    if (busy || pending || running.current) return;
    running.current = true; setPending(true); setError('');
    const capturedOwner = owner, capturedGeneration = generation.current;
    try { await run(async () => {
      const operationSignal = signal();
      const current = () => mounted.current && currentOwner.current === capturedOwner && generation.current === capturedGeneration
        && !operationSignal?.aborted && signal() === operationSignal && isCurrent();
      try { if (current()) await action(current, operationSignal); }
      catch (cause) { if (current()) { setError(cause instanceof Error ? cause.message : 'The work operation failed.'); setReview(null); setReviewed(false); } }
    }); } catch (cause) {
      if (mounted.current && currentOwner.current === capturedOwner && generation.current === capturedGeneration && isCurrent()) {
        setError(cause instanceof Error ? cause.message : 'The work operation could not start.'); setReview(null); setReviewed(false);
      }
    } finally { running.current = false; if (mounted.current) setPending(false); }
  }
  const shown = draft.slice(page * 25, (page + 1) * 25), today = packageWorkToday();
  return <section aria-labelledby={heading} aria-busy={pending} className="min-w-0 space-y-3 rounded-lg border bg-background p-2 sm:p-4">
    <h3 ref={headingRef} tabIndex={-1} id={heading} className="font-medium">Work and next actions</h3>
    <p className="text-sm text-muted-foreground">Track responsible people and due dates here. Completing a task does not fulfill evidence checks or grant approval.</p>
    <p role="status" className="text-xs text-muted-foreground">{dirty ? 'Unapplied task changes · not saved yet.' : 'Showing saved tasks.'}</p>
    {!editable && <p className="text-xs text-muted-foreground">Tasks are read-only in this view.</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm">{draft.filter(task => task.status === 'pending').length} open · {draft.filter(task => task.status === 'complete').length} complete</p>
      <Button ref={addButton} className={buttonClass} variant="outline" disabled={locked || draft.length >= 100} onClick={() => {
        invalidate(); const task: TaskDraft = { id: newPackageId('task'), title: '', status: 'pending', owner: '', dueDate: '', notes: '' };
        focusTask.current = task.id; setPage(Math.floor(draft.length / 25)); setDraft(previous => [...previous, task]);
      }}>Add task</Button>
    </div>
    {!draft.length && <p className="text-sm text-muted-foreground">No local tasks have been added.</p>}
    <fieldset disabled={locked} className="min-w-0 space-y-3"><legend className="sr-only">Package tasks</legend>
      {shown.map((task, index) => {
        const ordinal = page * 25 + index + 1, id = `${heading}-task-${task.id}`, target = task.target && resolvePackageTaskTarget(revision, task.target);
        const validDate = !task.dueDate || isPackageWorkDate(task.dueDate), overdue = task.status === 'pending' && validDate && !!task.dueDate && task.dueDate < today;
        return <article key={task.id} data-package-task-id={task.id} className="min-w-0 space-y-3 rounded border p-3">
          <label className="block text-sm">Task {ordinal} title<input className={inputClass} aria-label={`Task ${ordinal} title`} aria-required="true" value={task.title}
            ref={node => { if (node) taskInputs.current.set(task.id, node); else taskInputs.current.delete(task.id); }}
            onChange={event => edit(task.id, { title: event.target.value })} /></label>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="block text-sm">Responsible person<input className={inputClass} aria-label={`Responsible person for task ${ordinal}`} autoComplete="off" value={task.owner} onChange={event => edit(task.id, { owner: event.target.value })} /></label>
            <label className="block text-sm">Due date<input className={inputClass} aria-label={`Due date for task ${ordinal}`} placeholder="YYYY-MM-DD" value={task.dueDate}
              aria-invalid={!validDate || undefined} aria-describedby={!validDate || overdue ? `${id}-due` : undefined} onChange={event => edit(task.id, { dueDate: event.target.value })} />
              {!validDate && <span id={`${id}-due`} className="text-xs text-destructive">Use a real date in YYYY-MM-DD format.</span>}
              {overdue && <span id={`${id}-due`} className="text-xs text-muted-foreground">Overdue for your local calendar date.</span>}
            </label>
          </div>
          <label className="block text-sm">Notes<textarea className={inputClass} aria-label={`Notes for task ${ordinal}`} rows={2} value={task.notes} onChange={event => edit(task.id, { notes: event.target.value })} /></label>
          <label className="block text-sm">Linked item<select className={inputClass} aria-label={`Linked item for task ${ordinal}`} value={task.target ? `${task.target.kind}:${task.target.id}` : ''} onChange={event => {
            const value = event.target.value;
            if (!value) { const next = { ...task }; delete next.target; invalidate(); setDraft(previous => previous.map(item => item.id === task.id ? next : item)); return; }
            const separator = value.indexOf(':'), kind = value.slice(0, separator) as 'member' | 'requirement'; edit(task.id, { target: { kind, id: value.slice(separator + 1) } });
          }}><option value="">Package-wide task</option>
            {target?.state === 'missing' && <option value={`${task.target!.kind}:${task.target!.id}`}>Unavailable linked item · choose another or clear it</option>}
            {revision.members.map((member, ordinal) => <option key={`member:${member.id}`} value={`member:${member.id}`}>Document {ordinal + 1}: {member.label}</option>)}
            {revision.requirements?.items.map((requirement, ordinal) => <option key={`requirement:${requirement.id}`} value={`requirement:${requirement.id}`}>Requirement {ordinal + 1}: {requirement.label}</option>)}
          </select></label>
          {target && <p className="break-words text-xs text-muted-foreground">{target.label}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={`Mark task ${ordinal} complete`} checked={task.status === 'complete'} onChange={event => edit(task.id, { status: event.target.checked ? 'complete' : 'pending' })} />Complete</label>
            <Button className={buttonClass} variant="outline" onClick={() => {
              invalidate(); const remaining = draft.filter(item => item.id !== task.id), next = remaining[Math.min(ordinal - 1, remaining.length - 1)];
              if (next) focusTask.current = next.id; else focusAdd.current = true;
              setDraft(remaining); setPage(value => Math.min(value, Math.max(0, Math.ceil((draft.length - 1) / 25) - 1)));
            }}>Remove task {ordinal}</Button>
          </div>
        </article>;
      })}
    </fieldset>
    {draft.length > 25 && <div className="flex flex-wrap items-center gap-2 text-sm"><p>Tasks {page * 25 + 1}–{Math.min((page + 1) * 25, draft.length)} of {draft.length}</p>
      <Button className={buttonClass} variant="outline" disabled={busy || pending || page === 0} onClick={() => setPage(value => value - 1)}>Previous tasks</Button>
      <Button className={buttonClass} variant="outline" disabled={busy || pending || (page + 1) * 25 >= draft.length} onClick={() => setPage(value => value + 1)}>More tasks</Button>
    </div>}
    {dirty && <div className="space-y-3">
      <div className="flex flex-wrap gap-2"><Button className={buttonClass} disabled={locked} onClick={() => void perform(async current => {
        const policy = await getExportDeploymentPolicy(), work = proposed(draft), value = reviewPackageWork(work, policy);
        if (policy.status !== 'ready') throw new Error(policy.message);
        if (current()) { const key = JSON.stringify(policy.policy); reviewedPolicy.current = key; setReview({ value, policyIdentity: key }); setReviewed(false); }
      })}>Review task changes</Button>
        <Button className={buttonClass} variant="outline" disabled={locked} onClick={() => { invalidate(); setDraft(structuredClone(base)); addButton.current?.focus(); }}>Discard task changes</Button>
      </div>
      {review && <div className="min-w-0 space-y-2 rounded border p-3">
        {review.value.notices.map((notice, index) => <p key={index} className="break-words text-xs">{notice}</p>)}
        {review.value.privacy.findings.map((finding, index) => <p key={index} className="break-words text-xs">{finding.type}: {finding.value}</p>)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={locked} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the tasks, responsible people, dates and privacy findings.</label>
        <Button className={buttonClass} disabled={locked || !reviewed} onClick={() => void perform(async (current, operationSignal) => {
          const policy = await getExportDeploymentPolicy();
          if (policy.status !== 'ready' || JSON.stringify(policy.policy) !== review.policyIdentity) throw new Error('Deployment settings changed. Review the task changes again.');
          const next = await updatePackageWork(record, proposed(draft), policy, operationSignal, current);
          if (!current()) return;
          const nextDraft = drafts(next.revisions.find(item => item.id === next.currentRevisionId)!);
          ownRevision.current = next.currentRevisionId;
          returnFocus.current = true;
          setBase(nextDraft); setDraft(structuredClone(nextDraft)); setReview(null); setReviewed(false); setInspection(null);
          dirtyCallback.current?.(false); onApply(next); setNotice('Tasks saved as a new package revision.');
        })}>Save task changes</Button>
      </div>}
    </div>}
    <section aria-label="Computed next actions" className="min-w-0 space-y-3 border-t pt-3">
      <h4 className="font-medium">Next actions</h4>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm">Operation<select aria-label="Next action operation" className={inputClass} value={operation} disabled={busy || pending || dirty} onChange={event => { invalidate(); setOperation(event.target.value as PackageRequirementOperation); }}>
        <option value="pdf">PDF assembly</option><option value="review">Start review</option><option value="portable">Editable handoff</option>
      </select></label><Button className={buttonClass} variant="outline" disabled={busy || pending || dirty} onClick={() => void perform(async (current, operationSignal) => {
        const policy = await getExportDeploymentPolicy();
        if (policy.status !== 'ready') throw new Error(policy.message);
        const key = JSON.stringify(policy.policy);
        const value = await derivePackageNextActions(record, revision.id, { operation, policy, signal: operationSignal, reviewBaseline });
        const active = getExportDeploymentPolicySync();
        if (active.status !== 'ready' || JSON.stringify(active.policy) !== key) throw new Error('Deployment settings changed. Check next actions again.');
        if (current()) { inspectionPolicy.current = key; setInspection(value); setActionPage(0); }
      })}>Check next actions</Button></div>
      {dirty && <p className="text-xs text-muted-foreground">Save or discard task edits before checking saved package actions.</p>}
      {!inspection && !dirty && <p className="text-xs text-muted-foreground">Check the saved package to find its next action.</p>}
      {inspection && <><p role="status" className="text-sm">{labels[inspection.operation]}: {inspection.computedBlockers ? `${inspection.computedBlockers} unresolved check${inspection.computedBlockers === 1 ? '' : 's'}` : 'no unresolved operation checks'}. Open tasks stay separate from these checks.</p>
        <ol className="min-w-0 list-inside list-decimal space-y-3" start={actionPage * 25 + 1}>{inspection.actions.slice(actionPage * 25, (actionPage + 1) * 25).map(action => <li key={action.id} className="break-words text-sm">
          <span className="font-medium">{action.label}</span>{action.overdue && <span className="ml-1 text-xs">Overdue</span>}
          <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{action.message}</p>
          {action.destination && <Button className={buttonClass} variant="outline" size="sm" disabled={busy || pending} onClick={() => {
            if (action.taskId && action.destination?.panel === 'work') {
              const index = draft.findIndex(task => task.id === action.taskId); if (index >= 0) { focusTask.current = action.taskId; setPage(Math.floor(index / 25)); taskInputs.current.get(action.taskId)?.focus(); return; }
            }
            onNavigate?.(action.destination!);
          }}>Open {action.label}</Button>}
        </li>)}</ol>
        {inspection.actions.length > 25 && <div className="flex flex-wrap gap-2"><Button className={buttonClass} variant="outline" disabled={busy || pending || actionPage === 0} onClick={() => setActionPage(value => value - 1)}>Previous actions</Button>
          <Button className={buttonClass} variant="outline" disabled={busy || pending || (actionPage + 1) * 25 >= inspection.actions.length} onClick={() => setActionPage(value => value + 1)}>More actions</Button></div>}
      </>}
    </section>
  </section>;
}

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { PackageChangeImpactSummary } from './PackageChangeImpactSummary';
import { ArrowLeft } from 'lucide-react';
import type { PreparedConditionalPackage } from '@/lib/packageConditional';
import type { PackageUpdateChoice, PackageUpdateChoices, PackageUpdatePreview } from '@/lib/packageUpdates';

export type IntakeMemberChoice = 'keep' | 'remove' | 'restore';
export type IntakeAnswerChoice = 'keep-current' | 'use-intake';
const inputClass = 'mt-1 w-full min-w-0 rounded border bg-background p-2';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
const fieldChoiceLabels: Record<PackageUpdateChoice, string> = { 'apply-package': 'Apply the shared package value', 'keep-local': 'Keep the document value as a local override',
  reconnect: 'Reconnect and apply the shared value', detach: 'Detach and preserve the document value' };
const allFieldChoices = Object.keys(fieldChoiceLabels) as PackageUpdateChoice[];
function display(value: unknown): string {
  return value === undefined || value === null ? 'Unanswered' : value === '' ? 'Empty text' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
}
function needsFieldReview(change: PackageUpdatePreview): boolean {
  return change.state === 'conflict' || change.state === 'unavailable' ||
    change.state === 'update' && change.before != null && change.before !== '' && change.before !== change.after;
}
interface Props {
  onBack?(): void;
  preview: PreparedConditionalPackage;
  fresh: boolean;
  disabled: boolean;
  reviewed: boolean;
  memberChoices: Readonly<Record<string, IntakeMemberChoice>>;
  answerChoices: Readonly<Record<string, IntakeAnswerChoice>>;
  fieldChoices: PackageUpdateChoices;
  onMemberChoice(key: string, choice: IntakeMemberChoice | undefined): void;
  onAnswerChoice(key: string, choice: IntakeAnswerChoice | undefined): void;
  onFieldChoice(key: string, choice: PackageUpdateChoices[string] | undefined): void;
  onReviewed(value: boolean): void;
  onApply(): void;
  applyLabel?: string;
  directApply?: boolean;
}

export function PackageIntakePreview({ preview, fresh, disabled, reviewed, memberChoices, answerChoices, fieldChoices,
  onMemberChoice, onAnswerChoice, onFieldChoice, onReviewed, onApply, onBack, applyLabel = 'Apply action changes', directApply = false }: Props) {
  const [memberCount, setMemberCount] = useState(25), [fieldCount, setFieldCount] = useState(25), [reviewCount, setReviewCount] = useState(25);
  const [answerCount, setAnswerCount] = useState(25), [issueCount, setIssueCount] = useState(25);
  const [showOptions, setShowOptions] = useState(false);
  const result = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!directApply) return;
    result.current?.scrollIntoView?.({ block: 'start' }); result.current?.focus({ preventScroll: true });
  }, [preview, directApply]);
  const members = directApply ? preview.changes.filter(change => change.state !== 'keep' || !!memberChoices[change.key]) : preview.changes;
  const removedMembers = new Set(preview.changes.filter(change => change.state === 'remove').map(change => change.memberId));
  const availableFields = directApply ? preview.fieldChanges.filter(change => change.state !== 'detach' || !removedMembers.has(change.memberId)) : preview.fieldChanges;
  const fields = directApply && !showOptions ? availableFields.filter(change => change.state !== 'unchanged' || !!fieldChoices[change.bindingId]) : availableFields;
  const findings = useMemo(() => [...new Set(preview.reviews.flatMap(review => [
    ...review.notices, ...review.privacy.findings.map(finding => `${finding.type}: ${finding.field}: ${finding.value}`),
  ]))], [preview]);
  // Keep actionable decisions on the first page, even for large forms.
  const ordered = directApply ? [...fields.filter(needsFieldReview), ...fields.filter(change => !needsFieldReview(change))] : fields;
  const visibleFields = ordered.slice(0, fieldCount);
  const documentNames = new Map(preview.changes.map(change => [change.memberId, change.label]));
  const groups = new Map<string, { change: typeof fields[number]; index: number }[]>();
  if (directApply) visibleFields.forEach((change, index) => {
    const group = groups.get(change.memberId);
    if (group) group.push({ change, index });
    else groups.set(change.memberId, [{ change, index }]);
  });
  const renderField = (change: typeof fields[number], index: number) => <article key={change.bindingId} className="min-w-0 space-y-2 border-t pt-2 text-sm">
        <p className="break-words font-medium">{change.label}</p>{(!directApply || change.state === 'conflict' || change.state === 'unavailable') && <p>{change.message}</p>}
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <p className="whitespace-pre-wrap break-words">Current document: {display(change.before)}</p>
          <p className="whitespace-pre-wrap break-words">Planned value: {display(change.after)}</p>
        </div>
        <label hidden={directApply && !showOptions && !needsFieldReview(change) && !fieldChoices[change.bindingId]} className="block">Field decision<select aria-label={`Field decision ${change.label} · Link ${index + 1}`} className={inputClass} disabled={disabled}
          value={fieldChoices[change.bindingId] ?? ''} onChange={event => onFieldChoice(change.bindingId, event.target.value ? event.target.value as PackageUpdateChoices[string] : undefined)}>
          <option value="">Keep planned behavior</option>
          {(change.choices ?? allFieldChoices).map(choice => <option key={choice} value={choice}>{fieldChoiceLabels[choice]}</option>)}
        </select></label>
      </article>;
  return <section ref={result} tabIndex={-1} aria-label="Action changes preview" className="min-w-0 space-y-4 rounded border p-3 outline-none">
    {onBack && <Button variant="ghost" className="h-auto p-0 text-sm" disabled={disabled} onClick={onBack}><ArrowLeft aria-hidden="true" className="size-4" />Back to details</Button>}
    <div className="space-y-1">
      <h4 className="break-words font-medium">Review changes to {preview.packageName}</h4>
      {!directApply && <p className="text-sm text-muted-foreground">Documents change only when you apply this preview. Saved revisions and independent work remain available.</p>}
      {!fresh && <p role="status" className="text-sm">Answers or decisions changed. Preview again before applying.</p>}
    </div>
    {preview.impact && <PackageChangeImpactSummary impact={preview.impact} disabled={disabled} compact={directApply} />}
    {!preview.impact && !preview.ready && <p className="text-xs text-muted-foreground">Complete the outstanding answers or decisions, then preview again for package impact.</p>}
    {!!preview.answerChanges?.length && <section aria-label="Shared answer changes" className="space-y-3">
      <h5 className="text-sm font-medium">Shared answers</h5>
      {preview.answerChanges.slice(0, answerCount).map((change, index) => <article key={change.key} className="min-w-0 space-y-2 border-t pt-2 text-sm">
        <p className="break-words font-medium">{change.label}</p>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <p className="whitespace-pre-wrap break-words">Current package: {display(change.current)}</p>
          <p className="whitespace-pre-wrap break-words">Requested intake: {display(change.requested)}</p>
        </div>
        {change.state === 'kept-current' && <p className="text-xs text-muted-foreground">The newer package value is preserved.</p>}
        {(change.state === 'conflict' || answerChoices[change.key]) && <label className="block">Answer decision
          <select aria-label={`Answer decision ${change.label} · Answer ${index + 1}`} className={inputClass} disabled={disabled} value={answerChoices[change.key] ?? ''}
            onChange={event => onAnswerChoice(change.key, event.target.value ? event.target.value as IntakeAnswerChoice : undefined)}>
            <option value="">Choose the value to preserve</option><option value="keep-current">Keep the current package value</option><option value="use-intake">Use the requested intake value</option>
          </select>
        </label>}
      </article>)}
      {preview.answerChanges.length > answerCount && <Button className={buttonClass} variant="outline" disabled={disabled} onClick={() => setAnswerCount(value => value + 25)}>Show more shared answers</Button>}
    </section>}
    {members.length > 0 && <section aria-label="Document membership changes" className="space-y-3">
      <h5 className="text-sm font-medium">Documents ({members.length})</h5>
      {members.slice(0, memberCount).map((change, index) => <article key={change.key} className="min-w-0 space-y-2 border-t pt-2 text-sm">
        <p className="break-words font-medium">{change.label}</p><p className="whitespace-pre-wrap break-words">{change.message}</p>
        {!!change.choices?.length && <label className="block">Document decision<select aria-label={`Document decision ${change.label} · Document ${index + 1}`} className={inputClass}
          disabled={disabled} value={memberChoices[change.key] ?? ''} onChange={event => onMemberChoice(change.key, event.target.value ? event.target.value as IntakeMemberChoice : undefined)}>
          <option value="">Choose what happens to this document</option>
          {change.choices.map(choice => <option key={choice} value={choice}>{choice === 'restore' ? 'Restore the template document'
            : choice === 'keep' ? 'Keep the existing document' : change.choices!.includes('restore') ? 'Keep the document removed' : 'Remove the document from this action'}</option>)}
        </select></label>}
      </article>)}
      {members.length > memberCount && <Button className={buttonClass} variant="outline" disabled={disabled} onClick={() => setMemberCount(value => value + 25)}>Show more document changes</Button>}
    </section>}
    {availableFields.length > 0 && <section aria-label="Linked field changes" className="space-y-3">
      <div className="flex items-center justify-between gap-4">{(!directApply || fields.length > 0) && <h5 className="text-sm font-medium">{directApply ? 'Field changes' : 'Linked fields'} ({fields.length})</h5>}{directApply && <Button variant="link" className="h-auto p-0 text-xs" aria-expanded={showOptions} onClick={() => setShowOptions(value => !value)}>Field options</Button>}</div>
      {directApply ? Array.from(groups, ([id, group]) => {
        const label = group[0].change.memberLabel ?? documentNames.get(id) ?? 'Document';
        const needsAttention = group.some(({ change }) => needsFieldReview(change));
        return <details key={id} open={needsAttention || showOptions} className="border-t pt-2">
          <summary className="cursor-pointer text-sm font-medium">{label} · {group.length} {group.length === 1 ? 'field' : 'fields'}</summary>
          <div className="mt-2 space-y-2">{group.map(({ change, index }) => renderField(change, index))}</div>
        </details>;
      }) : visibleFields.map(renderField)}
      {fields.length > fieldCount && <Button className={buttonClass} variant="outline" disabled={disabled} onClick={() => setFieldCount(value => value + 25)}>Show more linked fields</Button>}
    </section>}
    {preview.issues.length > 0 && <div className="space-y-2"><ul className="list-disc space-y-1 pl-5 text-sm">{preview.issues.slice(0, issueCount).map((issue, index) => <li key={index} className="whitespace-pre-wrap break-words">{issue}</li>)}</ul>
      {preview.issues.length > issueCount && <Button className={buttonClass} variant="outline" disabled={disabled} onClick={() => setIssueCount(value => value + 25)}>Show more unresolved items</Button>}
    </div>}
    {findings.length > 0 && <details className="min-w-0 rounded border p-3 text-sm"><summary className="cursor-pointer">Privacy and marking findings ({findings.length})</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">{findings.slice(0, reviewCount).map(finding => <li key={finding} className="whitespace-pre-wrap break-words">{finding}</li>)}</ul>
      {findings.length > reviewCount && <Button className={buttonClass} variant="outline" disabled={disabled} onClick={() => setReviewCount(value => value + 25)}>Show more review findings</Button>}
    </details>}
    {!preview.changed && <p className="text-sm text-muted-foreground">No document or intake changes need applying.</p>}
    {!directApply && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={disabled || !fresh || !preview.ready || !preview.changed}
      onChange={event => onReviewed(event.target.checked)} />I reviewed the intake, document changes, local decisions and privacy findings.</label>}
    <Button className={buttonClass} disabled={disabled || !fresh || !preview.ready || !preview.changed || !directApply && !reviewed} onClick={onApply}>{applyLabel}</Button>
  </section>;
}

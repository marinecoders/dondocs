import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { newPackageId } from '@/lib/actionPackages';
import { intakeGroupLabel, intakeQuestions, withIntakeAnswer } from '@/lib/conditionalIntakeView';
import type { PackageTemplateAnswers, PackageTemplateProgram } from '@/lib/packageTemplateProgram';

const inputClass = 'mt-1 w-full min-w-0 rounded border bg-background p-2';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
interface Props {
  program: PackageTemplateProgram;
  answers: PackageTemplateAnswers;
  disabled: boolean;
  busy?: boolean;
  onChange(answers: PackageTemplateAnswers): void;
  focusFirst?: boolean;
  focusQuestion?: string;
  showAll?: boolean;
}

export function PackageIntakeQuestions({ program, answers, disabled, busy = false, onChange, focusFirst, focusQuestion, showAll = false }: Props) {
  const validationPrefix = useId();
  const { evaluation, questions, invalidLabels } = useMemo(() => intakeQuestions(program, answers), [program, answers]);
  const [showAnswered, setShowAnswered] = useState(showAll), [search, setSearch] = useState(''), [page, setPage] = useState(() => {
    const index = questions.filter(item => item.instance.visibility === true && (showAll || !item.instance.answered || !item.instance.valid)).findIndex(item => item.key === focusQuestion);
    return Math.max(0, Math.floor(index / 25));
  });
  const [presented, setPresented] = useState(() => new Set<string>());
  const first = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null), focused = useRef(false);
  const focusTargets = useRef(new Map<string, HTMLElement>()), focusKey = useRef<string | null>(null);
  const [inactiveCount, setInactiveCount] = useState(25);
  useEffect(() => {
    if ((!focusFirst && !focusQuestion) || disabled || focused.current || !first.current) return;
    // Recovery can enable these fields after the user has started editing the
    // package name. Do not redirect their next keystroke into a question.
    const active = first.current.ownerDocument.activeElement;
    if (active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
      focused.current = true;
      return;
    }
    first.current.focus(); focused.current = true;
  }, [focusFirst, focusQuestion, disabled, questions.length]);
  useEffect(() => { if (focusKey.current) { focusTargets.current.get(focusKey.current)?.focus(); focusKey.current = null; } }, [answers]);
  const visible = questions.filter(item => item.instance.visibility === true && (showAnswered || presented.has(item.key) || !item.instance.answered || !item.instance.valid)
    && item.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(visible.length / 25)), currentPage = Math.min(page, pages - 1), shown = visible.slice(currentPage * 25, (currentPage + 1) * 25);
  const remaining = questions.filter(item => item.instance.visibility === true && (!item.instance.answered || !item.instance.valid)).length;
  const inactive = questions.filter(item => item.instance.visibility !== true && item.instance.value !== undefined);
  function replacePeople(groupId: string, people: PackageTemplateAnswers['groups'][string]) {
    onChange({ ...answers, groups: { ...answers.groups, [groupId]: people } });
  }
  return <section aria-label="Intake questions" className="min-w-0 space-y-4">
    <div hidden={showAll && questions.length <= 12} className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm">{remaining} relevant question{remaining === 1 ? '' : 's'} remaining.</p>
      <Button className={buttonClass} variant="outline" disabled={busy} aria-pressed={showAnswered} onClick={() => { setShowAnswered(value => !value); setPresented(new Set()); setPage(0); }}>
        {showAnswered ? 'Show unanswered questions' : 'Show answered questions'}
      </Button>
    </div>
    {program.participantGroups.map(group => {
      const people = answers.groups[group.id] ?? [];
      const groupLabel = intakeGroupLabel(program, group.id);
      return <fieldset key={group.id} disabled={disabled} className="min-w-0 space-y-3 rounded border p-3">
        <legend className="px-1 text-sm font-medium">{groupLabel} ({people.length})</legend>
        {people.map((person, index) => {
          const owner = `${groupLabel} · person ${index + 1} · ${person.label}`;
          return <div key={person.id} className="min-w-0 space-y-2 border-b pb-3 last:border-b-0">
            <label className="block min-w-0 text-sm">Person {index + 1} label
              <input ref={node => { if (node) focusTargets.current.set(person.id, node); else focusTargets.current.delete(person.id); }}
                aria-label={`${groupLabel} person ${index + 1} label`} className={inputClass} value={person.label} maxLength={160} autoComplete="off"
                onChange={event => replacePeople(group.id, people.map(value => value.id === person.id ? { ...value, label: event.target.value } : value))} />
            </label>
            <div className="flex flex-wrap gap-2">
              {(['up', 'down'] as const).map(direction => <Button key={direction} className={buttonClass} variant="outline" size="sm"
                aria-label={`Move ${owner} ${direction}`} disabled={direction === 'up' ? index === 0 : index === people.length - 1} onClick={() => {
                  const next = [...people], target = direction === 'up' ? index - 1 : index + 1;
                  [next[index], next[target]] = [next[target], next[index]];
                  focusKey.current = person.id; replacePeople(group.id, next);
                }}>Move {direction}</Button>)}
              <Button className={buttonClass} variant="outline" size="sm" aria-label={`Remove ${owner}`} disabled={people.length <= group.min} onClick={() => {
                focusKey.current = `add:${group.id}`; replacePeople(group.id, people.filter(value => value.id !== person.id));
              }}>Remove person</Button>
            </div>
          </div>;
        })}
        <Button ref={node => { if (node) focusTargets.current.set(`add:${group.id}`, node); else focusTargets.current.delete(`add:${group.id}`); }}
          className={buttonClass} variant="outline" disabled={people.length >= group.max} onClick={() => {
            let ordinal = people.length + 1;
            while (people.some(person => person.label === `${group.label} ${ordinal}`)) ordinal++;
            const person = { id: newPackageId('participant'), label: `${group.label} ${ordinal}`, answers: {} };
            focusKey.current = person.id; replacePeople(group.id, [...people, person]);
          }}>Add person to {groupLabel}</Button>
      </fieldset>;
    })}
    <label hidden={showAll && questions.length <= 12} className="block text-sm">Search intake questions<input className={inputClass} value={search} autoComplete="off"
      disabled={busy} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Question or person label" /></label>
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
      <legend className="sr-only">Relevant questions</legend>
      {shown.map((item, index) => {
        const { question, instance } = item, value = instance.value;
        const errorId = `${validationPrefix}-question-${index}`;
        const accessibility = { 'aria-required': question.required || undefined, 'aria-invalid': !instance.valid || undefined,
          'aria-describedby': !instance.valid ? errorId : undefined };
        const change = (value: string | boolean | undefined) => {
          if (!presented.has(item.key)) setPresented(previous => new Set([...previous, item.key]));
          onChange(withIntakeAnswer(answers, instance, value));
        };
        const ref = (node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null) => { if (focusQuestion ? item.key === focusQuestion : index === 0) first.current = node; };
        return <label key={item.key} className={`min-w-0 text-sm ${question.kind === 'text' && !showAll ? 'sm:col-span-2' : ''}`}>
          {instance.scope && <span className="mb-1 block break-words text-xs text-muted-foreground">{item.label.slice(0, -(item.questionLabel.length + 3))}</span>}
          <span className="font-medium">{item.questionLabel}</span>{question.required && <span className="ml-1 text-xs text-muted-foreground">Required</span>}
          {question.kind === 'boolean' || question.kind === 'choice' ? <select ref={ref} {...accessibility} aria-label={item.label} className={inputClass}
            value={value === undefined ? '' : String(value)} onChange={event => change(event.target.value === '' ? undefined : question.kind === 'boolean' ? event.target.value === 'true' : event.target.value)}>
            <option value="">Choose…</option>{question.kind === 'boolean' ? <><option value="true">Yes</option><option value="false">No</option></>
              : question.options!.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select> : question.kind === 'text' ? <textarea ref={ref} {...accessibility} aria-label={item.label} className={inputClass} rows={2} value={typeof value === 'string' ? value : ''}
            maxLength={10000} autoComplete="off" onChange={event => change(event.target.value)} />
            : <input ref={ref} {...accessibility} aria-label={item.label} className={inputClass} value={typeof value === 'string' ? value : ''} maxLength={question.kind === 'identifier' ? 200 : 100}
              inputMode={question.kind === 'decimal' ? 'decimal' : undefined} placeholder={question.kind === 'date' ? 'YYYY-MM-DD' : undefined} autoComplete="off" onChange={event => change(event.target.value)} />}
          {!instance.valid && <span id={errorId} className="mt-1 block text-xs text-destructive">Enter a valid {question.kind} value.</span>}
        </label>;
      })}
    </fieldset>
    {shown.length === 0 && <p className="text-sm text-muted-foreground">{remaining ? 'No unanswered questions match this search.' : 'The currently relevant questions are answered. You can edit them before previewing.'}</p>}
    {visible.length > 25 && <div className="flex flex-wrap items-center gap-2 text-sm">
      <p>Questions {currentPage * 25 + 1}–{Math.min((currentPage + 1) * 25, visible.length)} of {visible.length}</p>
      <Button className={buttonClass} variant="outline" disabled={busy || currentPage === 0} onClick={() => setPage(Math.max(0, currentPage - 1))}>Previous questions</Button>
      <Button className={buttonClass} variant="outline" disabled={busy || currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next questions</Button>
    </div>}
    {invalidLabels.map(message => <p key={message} className="text-sm text-destructive">{message}</p>)}
    {evaluation.issues.filter(issue => issue.severity === 'error' && !issue.questionId).map((issue, index) => <p key={index} className="text-sm text-destructive">{issue.message}</p>)}
    {inactive.length > 0 && <details className="rounded border p-3 text-sm"><summary className="cursor-pointer">Retained inactive answers ({inactive.length})</summary>
      <p className="mt-2 text-xs text-muted-foreground">These answers stay with this action for inspection. They do not decide the current branch.</p>
      {inactive.slice(0, inactiveCount).map(item => <div key={item.key} className="mt-2 min-w-0 border-t pt-2">
        <p className="break-words font-medium">{item.label}</p><p className="whitespace-pre-wrap break-words">{String(item.instance.value)}</p>
        <Button className={buttonClass} variant="outline" disabled={disabled} aria-label={`Clear inactive answer ${item.label}`} onClick={() => onChange(withIntakeAnswer(answers, item.instance, undefined))}>Clear {item.questionLabel}</Button>
      </div>)}
      {inactive.length > inactiveCount && <Button className={buttonClass} variant="outline" disabled={busy} onClick={() => setInactiveCount(value => value + 25)}>Show more inactive answers</Button>}
    </details>}
  </section>;
}

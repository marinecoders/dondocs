import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { PackageIntakeQuestions } from './PackageIntakeQuestions';
import { PackageIntakeScope } from './PackageIntakeScope';
import { PackageTemplateContentsPreview } from './PackageTemplateContentsPreview';
import { maintainedPackageAction, maintainedPackageActions } from '@/lib/maintainedPackageActions';
import { listPackageTemplates, type TemplateAttachment } from '@/lib/packageTemplateLibrary';
import { packageTemplateV2Schema, type PackageTemplateV2 } from '@/lib/packageTemplateSchema';
import { freshPackageTemplateAnswers, intakeAttachmentSlots } from '@/lib/conditionalIntakeView';
import { listConditionalPackageInstances } from '@/lib/packageConditional';
import { type PackageTemplateAnswers, type PackageTemplateProgram, type PackageTemplateQuestion } from '@/lib/packageTemplateProgram';
import { packageBindingTargetKey, listPackageBindingFields, type PackageBindingField } from '@/lib/packageBindingTargets';
import { validatePackageDraft } from '@/lib/actionPackageDraft';
import { newPackageId } from '@/lib/actionPackages';
import { preparePackageTemplateMaintenance, savePreparedPackageTemplateMaintenance, type PackageTemplateScenario, type PreparedPackageTemplateMaintenance } from '@/lib/packageTemplateMaintenance';
import { getExportDeploymentPolicy } from '@/config/classification';

const inputClass = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
const emptyAnswers = (): PackageTemplateAnswers => ({ version: 1, values: {}, groups: {} });
interface Props {
  disabled: boolean; busy: boolean; run(action: () => Promise<void>): Promise<void>;
  signal(): AbortSignal | undefined; isCurrent(): boolean; onDirtyChange?(dirty: boolean): void;
  onSaved?(template: PackageTemplateV2): void;
}
/** Maintainers author the declarations already used by intake. End users continue to choose a ready action. */
export function PackageTemplateMaintenancePanel({ disabled, busy, run, signal, isCurrent, onDirtyChange, onSaved }: Props) {
  const [library, setLibrary] = useState<PackageTemplateV2[]>([]), [sourceId, setSourceId] = useState('');
  const [template, setTemplate] = useState<PackageTemplateV2 | null>(null), [programJSON, setProgramJSON] = useState('');
  const [memberJSON, setMemberJSON] = useState(''), [fields, setFields] = useState<Record<string, PackageBindingField[]>>({});
  const [answers, setAnswers] = useState(emptyAnswers), [attachments, setAttachments] = useState<Record<string, TemplateAttachment>>({});
  const [expectedMembers, setExpectedMembers] = useState<string[]>([]);
  const [scenarioName, setScenarioName] = useState('Scenario 1'), [scenarios, setScenarios] = useState<PackageTemplateScenario[]>([]);
  const [preview, setPreview] = useState<PreparedPackageTemplateMaintenance | null>(null), [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(false), generation = useRef(0), running = useRef(false), disabledRef = useRef(disabled), previousDisabled = useRef(disabled), callback = useRef(onDirtyChange);
  const locked = disabled || busy || pending;
  useLayoutEffect(() => {
    disabledRef.current = disabled;
    if (previousDisabled.current === disabled) return;
    previousDisabled.current = disabled; generation.current++; setPreview(null); setReviewed(false);
  }, [disabled]);
  useEffect(() => { callback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; callback.current?.(false); }; }, []);
  useEffect(() => { callback.current?.(!!template); }, [template]);
  const program = useMemo((): PackageTemplateProgram | null => { try {
    const value = JSON.parse(programJSON);
    return value && typeof value.revision === 'string' && Array.isArray(value.questions) && value.questions.length <= 100
      && value.questions.every((item: unknown) => item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
        && 'label' in item && typeof item.label === 'string' && 'kind' in item && typeof item.kind === 'string'
        && 'required' in item && typeof item.required === 'boolean') ? value as PackageTemplateProgram : null;
  } catch { return null; } }, [programJSON]);
  const candidate = useMemo(() => { try { return template && program ? packageTemplateV2Schema.parse({ ...template, program, members: JSON.parse(memberJSON) }) : null; } catch { return null; } }, [template, program, memberJSON]);
  const slots = useMemo(() => { try { return candidate ? intakeAttachmentSlots(candidate, answers) : []; } catch { return []; } }, [candidate, answers]);
  function invalidate() { generation.current++; setPreview(null); setReviewed(false); setNotice(''); }
  async function perform(action: (current: () => boolean) => Promise<void>) {
    if (locked || running.current) return; running.current = true; setPending(true); setError('');
    const version = generation.current; let activeSignal: AbortSignal | undefined;
    const current = () => alive.current && generation.current === version && !activeSignal?.aborted && !disabledRef.current && signal() === activeSignal && isCurrent();
    try { await run(async () => {
      activeSignal = signal();
      if (!current()) return;
      try { await action(current); }
      catch (cause) {
        // The parent can release its signal before the outer rejection handler runs.
        if (current()) setError(cause instanceof Error ? cause.message : 'The template operation failed.');
        throw cause;
      }
    }); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The template operation failed.'); }
    finally { running.current = false; if (alive.current) setPending(false); }
  }
  function updateProgram(questions: PackageTemplateQuestion[]) { invalidate(); setProgramJSON(JSON.stringify({ ...program!, questions }, null, 2)); setScenarios([]); setExpectedMembers([]); }
  function mappingFields(member: PackageTemplateV2['members'][number], selectedIndex?: number) {
    const used = new Set((member.links ?? []).filter((_, index) => index !== selectedIndex).map(link => packageBindingTargetKey(link.target)));
    return (fields[member.key] ?? []).filter(field => !used.has(packageBindingTargetKey(field.target)));
  }
  function updateMembers(members: PackageTemplateV2['members']) { invalidate(); setMemberJSON(JSON.stringify(members, null, 2)); setScenarios([]); setExpectedMembers([]); }
  return <section aria-label="Maintain package templates" className="min-w-0 space-y-3 rounded-lg border bg-background p-2 sm:p-4" aria-busy={pending}>
    <h3 className="font-medium">Maintain package templates</h3>
    <p className="text-sm text-muted-foreground">Create a separate template revision from a proven starter. Validate real intake scenarios before saving. Existing actions keep their captured template and files.</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}{notice && <p role="status" className="break-words text-sm">{notice}</p>}
    <fieldset disabled={locked} className="min-w-0 space-y-3">
      <Button className={buttonClass} variant="outline" onClick={() => void perform(async current => { const items = await listPackageTemplates(); if (current()) setLibrary(items.filter((item): item is PackageTemplateV2 => item.version === 2)); })}>Refresh maintained template sources</Button>
      <label className="block text-sm">Template source<select aria-label="Maintainer template source" className={inputClass} value={sourceId} onChange={event => { invalidate(); setSourceId(event.target.value); }}>
        <option value="">Choose a proven template</option>{maintainedPackageActions.map(item => <option key={item.id} value={`maintained:${item.id}`}>{item.name}</option>)}{library.map(item => <option key={item.id} value={item.id}>{item.name} · revision {item.program.revision}</option>)}
      </select></label>
      <Button className={buttonClass} variant="outline" disabled={!sourceId} onClick={() => void perform(async current => {
        const selected = sourceId.startsWith('maintained:') ? await maintainedPackageAction(sourceId.slice(11) as Parameters<typeof maintainedPackageAction>[0]) : library.find(item => item.id === sourceId);
        if (!selected) throw new Error('Refresh and choose an available source template.');
        const options: Record<string, PackageBindingField[]> = {};
        for (const member of selected.members) if (member.kind === 'native') {
          const { session } = await validatePackageDraft(member.draft);
          options[member.key] = await listPackageBindingFields({ ...member, id: 'starter', revisionId: 'starter', session, draft: { id: 'starter', name: 'starter.json', type: 'application/json', size: 1, sha256: '0'.repeat(64) } });
        }
        if (current()) { setTemplate(structuredClone(selected)); setProgramJSON(JSON.stringify(selected.program, null, 2)); setMemberJSON(JSON.stringify(selected.members, null, 2)); setFields(options); setAnswers(freshPackageTemplateAnswers(selected.program)); setScenarios([]); setExpectedMembers([]); setAttachments({}); setPreview(null); setReviewed(false); }
      })}>Edit a separate template revision</Button>
      {template && <>
        <label className="block text-sm">Template name<input aria-label="Maintained template name" maxLength={120} className={inputClass} value={template.name} onChange={event => { invalidate(); setTemplate({ ...template, name: event.target.value }); }} /></label>
        <label className="block text-sm">Revision label<input aria-label="Maintained template revision" maxLength={100} className={inputClass} value={program?.revision ?? ''} onChange={event => { invalidate(); setProgramJSON(JSON.stringify({ ...program!, revision: event.target.value }, null, 2)); }} disabled={!program} /></label>
        <details className="min-w-0 rounded border p-3"><summary className="cursor-pointer font-medium">Questions</summary><div className="space-y-3 pt-3">
          {program?.questions.map((question, index) => <div key={question.id} className="min-w-0 space-y-2 rounded border p-2">
            <p className="break-all text-xs text-muted-foreground">Question ID: {question.id}</p>
            <label className="block text-sm">Label<input aria-label={`Question ${index + 1} label`} className={inputClass} value={question.label} onChange={event => updateProgram(program.questions.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /></label>
            <label className="block text-sm">Answer type<select aria-label={`Question ${index + 1} type`} className={inputClass} value={question.kind} onChange={event => updateProgram(program.questions.map((item, i) => i === index ? { ...item, kind: event.target.value as PackageTemplateQuestion['kind'], options: event.target.value === 'choice' ? [{ id: 'option', label: 'Option' }] : undefined } : item))}>
              {['text', 'identifier', 'date', 'decimal', 'boolean', 'choice'].map(kind => <option key={kind}>{kind}</option>)}
            </select></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={question.required} onChange={event => updateProgram(program.questions.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))} />Required answer</label>
            <p className="text-xs text-muted-foreground">Conditions, participant groups and choice options are available in the declarations below. Validation rejects unsupported or inconsistent mappings.</p>
            <Button className={buttonClass} variant="outline" onClick={() => updateProgram(program.questions.filter((_, i) => i !== index))}>Remove question {index + 1}</Button>
          </div>)}
          <Button className={buttonClass} variant="outline" disabled={!program || program.questions.length >= 100} onClick={() => updateProgram([...program!.questions, { id: newPackageId('question'), label: 'New question', kind: 'text', required: false }])}>Add template question</Button>
        </div></details>
        {candidate && <><PackageIntakeScope template={candidate} /><PackageTemplateContentsPreview template={candidate} disabled={locked} />
          <details className="min-w-0 rounded border p-3"><summary className="cursor-pointer font-medium">Document field mappings</summary><div className="space-y-3 pt-3">
            {candidate.members.filter(member => member.kind === 'native').map(member => <div key={member.key} className="min-w-0 space-y-2 rounded border p-2 text-sm"><h4 className="break-words font-medium">{member.label}</h4>
              {(member.links ?? []).map((link, index) => <div key={index} className="min-w-0 space-y-2 border-t pt-2">
                <label className="block">Question<select aria-label={`${member.label} mapping ${index + 1} question`} className={inputClass} value={link.questionId} onChange={event => updateMembers(candidate.members.map(item => item.key === member.key ? { ...item, links: member.links!.map((value, i) => i === index ? { ...value, questionId: event.target.value } : value) } : item))}>
                  {candidate.program.questions.filter(question => !question.groupId || question.groupId === member.repeatGroupId).map(question => <option key={question.id} value={question.id}>{question.label}</option>)}
                </select></label>
                <label className="block">Qualified field<select aria-label={`${member.label} mapping ${index + 1} field`} className={inputClass} value={packageBindingTargetKey(link.target)} onChange={event => {
                  const target = mappingFields(member, index).find(field => packageBindingTargetKey(field.target) === event.target.value)?.target; if (target) updateMembers(candidate.members.map(item => item.key === member.key ? { ...item, links: member.links!.map((value, i) => i === index ? { ...value, target } : value) } : item));
                }}>{mappingFields(member, index).map(field => <option key={packageBindingTargetKey(field.target)} value={packageBindingTargetKey(field.target)}>{field.label} · {field.kind}</option>)}</select></label>
                <Button className={buttonClass} variant="outline" onClick={() => updateMembers(candidate.members.map(item => item.key === member.key ? { ...item, links: member.links!.filter((_, i) => i !== index) } : item))}>Remove {member.label} mapping {index + 1}</Button>
              </div>)}
              <Button className={buttonClass} variant="outline" disabled={!mappingFields(member).length || !candidate.program.questions.some(question => !question.groupId || question.groupId === member.repeatGroupId)} onClick={() => updateMembers(candidate.members.map(item => item.key === member.key ? { ...item, links: [...member.links ?? [], { questionId: candidate.program.questions.find(question => !question.groupId || question.groupId === member.repeatGroupId)!.id, target: mappingFields(member)[0].target, format: 'field' }] } : item))}>Add {member.label} field mapping</Button>
            </div>)}
          </div></details></>}
        <details className="min-w-0 rounded border p-3"><summary className="cursor-pointer font-medium">Conditions, groups and document declarations</summary><div className="space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">Declarative JSON uses the existing typed questions, equals/answered/all/any/not conditions, participant limits and native field targets. It contains no executable code. Keep source IDs stable when authoring an upgrade.</p>
          <label className="block text-sm">Question and requirement declarations<textarea aria-label="Template program declarations" rows={12} className={`${inputClass} font-mono text-xs`} value={programJSON} onChange={event => { invalidate(); setScenarios([]); setExpectedMembers([]); setProgramJSON(event.target.value); }} /></label>
          <label className="block text-sm">Document declarations<textarea aria-label="Template document declarations" rows={12} className={`${inputClass} font-mono text-xs`} value={memberJSON} onChange={event => { invalidate(); setScenarios([]); setExpectedMembers([]); setMemberJSON(event.target.value); }} /></label>
        </div></details>
        {!candidate && <p role="alert" className="text-sm text-destructive">Fix invalid or inconsistent declarations before running a scenario or saving.</p>}
        {candidate && <details open className="min-w-0 rounded border p-3"><summary className="cursor-pointer font-medium">Validate intake scenarios</summary><div className="space-y-3 pt-3">
          <PackageIntakeQuestions program={candidate.program} answers={answers} disabled={locked} onChange={next => { invalidate(); setAnswers(next); setAttachments({}); setExpectedMembers([]); }} />
          <label className="block text-sm">Scenario name<input aria-label="Template scenario name" maxLength={120} className={inputClass} value={scenarioName} onChange={event => setScenarioName(event.target.value)} /></label>
          {slots.map(slot => <label key={slot.key} className="block text-sm">{slot.label}: synthetic sample PDF<input aria-label={`Scenario PDF for ${slot.label}`} type="file" accept="application/pdf,.pdf" className="mt-1 block max-w-full" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; if (file) void perform(async current => { if (file.size > 25 * 1024 * 1024) throw new Error('Choose a sample PDF no larger than 25 MB.'); const data = await file.arrayBuffer(); if (current()) { invalidate(); setAttachments(before => ({ ...before, [slot.key]: { name: file.name, data, signedOriginal: false } })); } });
          }} /></label>)}
          <p className="text-xs text-muted-foreground">Sample answers and PDFs are used for validation and are never stored in the reusable template or as a package.</p>
          <fieldset className="min-w-0 space-y-2 rounded border p-2"><legend className="px-1 text-sm font-medium">Expected documents for this scenario</legend>
            <p className="text-xs text-muted-foreground">Choose the documents this scenario should produce. Validation compares this independent expectation with the actual conditional result.</p>
            {listConditionalPackageInstances(candidate, answers).map(instance => {
              const member = candidate.members.find(item => item.key === instance.memberKey)!;
              const people = member.repeatGroupId ? answers.groups[member.repeatGroupId] ?? [] : [], index = people.findIndex(person => person.id === instance.participantId);
              return <label key={instance.key} className="flex items-start gap-2 break-words text-sm"><input type="checkbox" checked={expectedMembers.includes(instance.key)} onChange={event => { invalidate(); setExpectedMembers(previous => event.target.checked ? [...previous, instance.key] : previous.filter(key => key !== instance.key)); }} />Expected document: {member.label}{index >= 0 ? ` · person ${index + 1}: ${people[index].label}` : ''}</label>;
            })}
          </fieldset>
          <Button className={buttonClass} variant="outline" disabled={!scenarioName.trim() || scenarios.length >= 12} onClick={() => { invalidate(); setScenarios([...scenarios, { name: scenarioName, answers: structuredClone(answers), attachments: structuredClone(attachments), expectedMembers: [...expectedMembers] }]); setScenarioName(`Scenario ${scenarios.length + 2}`); }}>Add this expected scenario</Button>
          {scenarios.map((scenario, index) => <p key={index} className="break-words text-sm">{scenario.name} · {scenario.expectedMembers.length} expected document instances <Button className={buttonClass} variant="ghost" onClick={() => { invalidate(); setScenarios(scenarios.filter((_, i) => i !== index)); }}>Remove scenario {index + 1}</Button></p>)}
          <Button className={buttonClass} variant="outline" disabled={!scenarios.length} onClick={() => void perform(async current => { const result = await preparePackageTemplateMaintenance(candidate, scenarios, await getExportDeploymentPolicy(), signal()); if (current()) { setPreview(result); setReviewed(false); } })}>Validate template scenarios</Button>
        </div></details>}
        {preview && <div className="min-w-0 space-y-3 rounded border p-3 text-sm"><p className="font-medium">{preview.ready ? 'Scenarios passed; template ready for review.' : 'Template is not ready to save.'}</p>
          {[...preview.issues, ...preview.scenarios.flatMap(item => item.issues.map(issue => `${item.name}: ${issue}`))].map((issue, index) => <p key={index} className="break-words text-destructive">{issue}</p>)}
          {preview.scenarios.map((item, index) => <p key={index} className="break-words">{item.name}: {item.ready ? 'passed' : 'needs correction'} · {item.members.length} documents</p>)}
          {preview.reviews.flatMap(review => [...review.notices, ...review.privacy.findings.map(finding => `${finding.type}: ${finding.value}`)]).map((text, index) => <p key={index} className="whitespace-pre-wrap break-words text-xs">{text}</p>)}
          <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed all declarations, starter text, retained figures, mappings and scenario outcomes for this separate template revision.</label>
          <Button className={buttonClass} disabled={!preview.ready || !reviewed} onClick={() => void perform(async current => { const saved = await savePreparedPackageTemplateMaintenance(preview, await getExportDeploymentPolicy(), reviewed, signal(), current); if (current()) { setTemplate(null); setPreview(null); setReviewed(false); callback.current?.(false); setNotice('Separate maintained template saved. Existing actions are unchanged.'); onSaved?.(saved); } })}>Save reviewed template revision</Button>
        </div>}
      </>}
    </fieldset>
    {template && <Button className={buttonClass} variant="outline" disabled={busy || pending} onClick={() => { invalidate(); setTemplate(null); setScenarios([]); setAttachments({}); setExpectedMembers([]); }}>Discard template editing</Button>}
  </section>;
}

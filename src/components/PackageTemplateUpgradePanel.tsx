import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { PackageIntakeQuestions } from './PackageIntakeQuestions';
import { PackageIntakePreview, type IntakeAnswerChoice, type IntakeMemberChoice } from './PackageIntakePreview';
import { PackageChangeImpactSummary } from './PackageChangeImpactSummary';
import { PackageTemplateContentsPreview } from './PackageTemplateContentsPreview';
import { maintainedPackageActions, maintainedPackageAction } from '@/lib/maintainedPackageActions';
import { listPackageTemplates, type TemplateAttachment } from '@/lib/packageTemplateLibrary';
import { type ActionPackage, type PackageRevision } from '@/lib/actionPackages';
import { prepareConditionalTemplateUpgrade, applyPreparedConditionalPackage, readConditionalPackageTemplate, conditionalPackageAnswers, mappedConditionalTemplateAnswers, type PreparedConditionalTemplateUpgrade } from '@/lib/packageConditional';
import { preparePackageDefinitionUpgrade, applyPackageDefinitionUpgrade, type PreparedPackageDefinitionUpgrade, type PackageDefinitionBindingChoice } from '@/lib/packageDefinitionUpgrades';
import { freshPackageTemplateAnswers, intakeAttachmentSlots } from '@/lib/conditionalIntakeView';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';
import type { PackageTemplateAnswers } from '@/lib/packageTemplateProgram';
import type { PackageUpdateChoices } from '@/lib/packageUpdates';
import { getExportDeploymentPolicy } from '@/config/classification';
import type { FormMigration } from '@/services/forms/documents';

const inputClass = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
interface Props {
  record: ActionPackage; revision: PackageRevision; disabled: boolean; busy: boolean; run(action: () => Promise<void>): Promise<void>;
  signal(): AbortSignal | undefined; isCurrent(): boolean; onApply(record: ActionPackage): void; onDirtyChange?(dirty: boolean): void;
}
const emptyAnswers = (): PackageTemplateAnswers => ({ version: 1, values: {}, groups: {} });
export function PackageTemplateUpgradePanel(props: Props) {
  return <PackageTemplateUpgradeEditor key={`${props.record.id}:${props.record.sequence}:${props.revision.id}`} {...props} />;
}
function PackageTemplateUpgradeEditor({ record, revision, disabled, busy, run, signal, isCurrent, onApply, onDirtyChange }: Props) {
  const [library, setLibrary] = useState<PackageTemplateV2[]>([]), [sourceId, setSourceId] = useState('');
  const [source, setSource] = useState<PackageTemplateV2 | null>(null), [target, setTarget] = useState<PackageTemplateV2 | null>(null);
  const [questions, setQuestions] = useState<Record<string, string | null>>({}), [members, setMembers] = useState<Record<string, string | null>>({});
  const [answers, setAnswers] = useState(emptyAnswers), [attachments, setAttachments] = useState<Record<string, TemplateAttachment>>({}), [preserve, setPreserve] = useState(false);
  const [preview, setPreview] = useState<PreparedConditionalTemplateUpgrade | null>(null), [fresh, setFresh] = useState(false), [reviewed, setReviewed] = useState(false);
  const [memberChoices, setMemberChoices] = useState<Record<string, IntakeMemberChoice>>({}), [answerChoices, setAnswerChoices] = useState<Record<string, IntakeAnswerChoice>>({}), [fieldChoices, setFieldChoices] = useState<PackageUpdateChoices>({});
  const [formId, setFormId] = useState(''), [blueprintKey, setBlueprintKey] = useState(''), [migrationJSON, setMigrationJSON] = useState(''), [bindingChoices, setBindingChoices] = useState<Record<string, PackageDefinitionBindingChoice>>({});
  const [preserveSignatures, setPreserveSignatures] = useState(false), [definitionPreview, setDefinitionPreview] = useState<PreparedPackageDefinitionUpgrade | null>(null), [definitionReviewed, setDefinitionReviewed] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const alive = useRef(false), generation = useRef(0), running = useRef(false), scope = `${record.id}:${record.sequence}:${revision.id}`, owner = useRef(scope), callback = useRef(onDirtyChange);
  const editable = !disabled && !record.archived && revision.id === record.currentRevisionId && !record.reviewRounds?.some(round => round.ownerPackageId === undefined), locked = !editable || busy || pending;
  const editableRef = useRef(editable), previousEditable = useRef(editable);
  useLayoutEffect(() => { owner.current = scope; callback.current = onDirtyChange; }, [scope, onDirtyChange]);
  useLayoutEffect(() => {
    editableRef.current = editable;
    if (previousEditable.current === editable) return;
    previousEditable.current = editable; generation.current++; setPreview(null); setFresh(false); setReviewed(false); setDefinitionPreview(null); setDefinitionReviewed(false);
  }, [editable]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; callback.current?.(false); }; }, []);
  useEffect(() => { callback.current?.(!!target); }, [target]);
  function invalidate() { generation.current++; setFresh(false); setReviewed(false); setDefinitionPreview(null); setDefinitionReviewed(false); }
  async function perform(action: (current: () => boolean) => Promise<void>) {
    if (locked || running.current) return; running.current = true; setPending(true); setError('');
    const version = generation.current, capturedOwner = scope; let activeSignal: AbortSignal | undefined;
    const current = () => alive.current && editableRef.current && owner.current === capturedOwner && generation.current === version && !activeSignal?.aborted && signal() === activeSignal && isCurrent();
    try { await run(async () => {
      activeSignal = signal();
      if (!current()) return;
      try { await action(current); }
      catch (cause) {
        // Keep the error while its owner is still current, before parent cleanup.
        if (current()) setError(cause instanceof Error ? cause.message : 'The upgrade operation failed.');
        throw cause;
      }
    }); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The upgrade operation failed.'); }
    finally { running.current = false; if (alive.current) setPending(false); }
  }
  const slots = useMemo(() => { try { return target ? intakeAttachmentSlots(target, answers) : []; } catch { return []; } }, [target, answers]);
  const configured = revision.members.filter(member => member.kind === 'native' && member.session.genericForm);
  const form = configured.find(member => member.id === formId), blueprint = target?.members.find(member => member.key === blueprintKey);
  const affected = revision.bindings?.items.filter(binding => binding.memberId === formId) ?? [];
  function setMappedAnswers(previous: PackageTemplateV2, next: PackageTemplateV2, mappings: Record<string, string | null>) {
    const mapped = mappedConditionalTemplateAnswers(previous, next, conditionalPackageAnswers(record, revision.id), mappings), initial = freshPackageTemplateAnswers(next.program);
    setAnswers({ version: 1, values: mapped.values, groups: { ...initial.groups, ...mapped.groups } });
  }
  function chooseDefinition(memberId: string, key: string) {
    invalidate(); setFormId(memberId); setBlueprintKey(key); setBindingChoices({});
    const old = configured.find(item => item.id === memberId), next = target?.members.find(item => item.key === key);
    if (old?.kind !== 'native' || next?.kind !== 'native') { setMigrationJSON(''); return; }
    const source = old.session.genericForm!, destination = next.draft.genericForm as typeof source | undefined;
    setMigrationJSON(JSON.stringify({ from: source.definition.definitionRevision, to: destination?.definition.definitionRevision ?? '',
      fields: Object.fromEntries(Object.entries(source.definition.fields).filter(([, field]) => field.kind !== 'signature').map(([field]) => [field, destination?.definition.fields[field] ? field : ''])) }, null, 2));
  }
  return <section aria-label="Template and form upgrades" className="min-w-0 space-y-3 rounded-lg border bg-background p-2 sm:p-4" aria-busy={pending}>
    <h3 className="font-medium">Template and form upgrades</h3><p className="text-sm text-muted-foreground">Adopt document membership and migrate form answers as separate decisions. Existing text, independent files, overrides and prior reviews remain preserved.</p>
    {!editable && <p className="text-sm text-muted-foreground">Open the current owning revision to prepare an upgrade.</p>}{error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <fieldset disabled={locked} className="min-w-0 space-y-3">
      <Button className={buttonClass} variant="outline" onClick={() => void perform(async current => { const items = await listPackageTemplates(); if (current()) setLibrary(items.filter((item): item is PackageTemplateV2 => item.version === 2)); })}>Refresh upgrade templates</Button>
      <label className="block text-sm">New template source<select aria-label="Upgrade template source" className={inputClass} value={sourceId} onChange={event => { invalidate(); setSourceId(event.target.value); }}><option value="">Choose a maintained revision</option>
        {maintainedPackageActions.map(item => <option key={item.id} value={`maintained:${item.id}`}>{item.name}</option>)}{library.map(item => <option key={item.id} value={item.id}>{item.name} · {item.program.revision}</option>)}
      </select></label>
      <Button className={buttonClass} variant="outline" disabled={!sourceId} onClick={() => void perform(async current => {
        const next = sourceId.startsWith('maintained:') ? await maintainedPackageAction(sourceId.slice(11) as Parameters<typeof maintainedPackageAction>[0]) : library.find(item => item.id === sourceId);
        if (!next) throw new Error('Refresh and choose an available template.');
        const old = revision.templateState ? await readConditionalPackageTemplate(record, revision.id) : null;
        if (current()) { setTarget(next); setSource(old); setAttachments({}); setPreserve(false); setPreview(null); setFresh(false); setReviewed(false); setMemberChoices({}); setAnswerChoices({}); setFieldChoices({});
          if (old) { const mappings = Object.fromEntries(old.program.questions.map(item => [item.id, next.program.questions.some(value => value.id === item.id && value.kind === item.kind && value.groupId === item.groupId) ? item.id : null]));
            setQuestions(mappings); setMembers(Object.fromEntries(old.members.map(item => [item.key, next.members.some(value => value.key === item.key && value.kind === item.kind && value.repeatGroupId === item.repeatGroupId) ? item.key : null]))); setMappedAnswers(old, next, mappings);
          } else setAnswers(freshPackageTemplateAnswers(next.program));
        }
      })}>Load upgrade declarations</Button>
      {target && <>
        <p className="break-words text-sm">Selected target: {target.name} · revision {target.program.revision}</p>
        <PackageTemplateContentsPreview template={target} disabled={locked} />
        {source && <details open className="min-w-0 rounded border p-3"><summary className="cursor-pointer font-medium">Adopt template membership</summary><div className="space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">Map each source declaration or preserve it independently. Current document bodies are retained; new starter text never overwrites them. Changed configured definitions must be migrated separately.</p>
          {source.program.questions.map(question => <label key={question.id} className="block text-sm">{question.label}<select aria-label={`Upgrade question ${question.id}`} className={inputClass} value={questions[question.id] ?? ''} onChange={event => { invalidate(); const mapping = { ...questions, [question.id]: event.target.value || null }; setQuestions(mapping); setMappedAnswers(source, target, mapping); }}>
            <option value="">Preserve answer independently</option>{target.program.questions.filter(item => item.kind === question.kind && item.groupId === question.groupId).map(item => <option key={item.id} value={item.id}>{item.label} · {item.id}</option>)}
          </select></label>)}
          {source.members.map(member => <label key={member.key} className="block text-sm">{member.label}<select aria-label={`Upgrade document ${member.key}`} className={inputClass} value={members[member.key] ?? ''} onChange={event => { invalidate(); setMembers({ ...members, [member.key]: event.target.value || null }); }}>
            <option value="">Preserve document independently</option>{target.members.filter(item => item.kind === member.kind && item.repeatGroupId === member.repeatGroupId).map(item => <option key={item.key} value={item.key}>{item.label} · {item.key}</option>)}
          </select></label>)}
          <PackageIntakeQuestions program={target.program} answers={answers} disabled={locked} onChange={next => { invalidate(); setAnswers(next); setAttachments({}); }} />
          {slots.map(slot => <label key={slot.key} className="block text-sm">{slot.label}: fresh PDF if not already retained<input aria-label={`Upgrade PDF for ${slot.label}`} type="file" accept="application/pdf,.pdf" className="mt-1 block max-w-full" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; if (file) void perform(async current => { if (file.size > 25 * 1024 * 1024) throw new Error('Choose a PDF no larger than 25 MB.'); const data = await file.arrayBuffer(); if (current()) { invalidate(); setAttachments(before => ({ ...before, [slot.key]: { name: file.name, data, signedOriginal: false } })); } });
          }} /></label>)}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={preserve} onChange={event => { invalidate(); setPreserve(event.target.checked); }} />Preserve unmapped answers, independent documents, local links and earlier review history. Reset template-controlled requirements for explicit review.</label>
          <Button className={buttonClass} variant="outline" disabled={!preserve} onClick={() => void perform(async current => { const result = await prepareConditionalTemplateUpgrade({ record, template: target, answers, questionMappings: questions, memberMappings: members, preserveUnmapped: preserve, attachments, memberChoices, answerChoices, fieldChoices }, await getExportDeploymentPolicy(), signal()); if (current()) { setPreview(result); setFresh(true); setReviewed(false); } })}>Preview template adoption</Button>
          {preview && <><p className="break-words text-sm">{preview.upgrade.from} → {preview.upgrade.to} · {preview.upgrade.preservedAnswers} independently preserved question declarations · {preview.upgrade.preservedMembers} independently preserved documents</p>
            <PackageIntakePreview preview={preview} fresh={fresh} disabled={locked} reviewed={reviewed} memberChoices={memberChoices} answerChoices={answerChoices} fieldChoices={fieldChoices} onReviewed={setReviewed}
              onMemberChoice={(key, choice) => { invalidate(); setMemberChoices(before => { const next = { ...before }; if (choice) next[key] = choice; else delete next[key]; return next; }); }}
              onAnswerChoice={(key, choice) => { invalidate(); setAnswerChoices(before => { const next = { ...before }; if (choice) next[key] = choice; else delete next[key]; return next; }); }}
              onFieldChoice={(key, choice) => { invalidate(); setFieldChoices(before => { const next = { ...before }; if (choice) next[key] = choice; else delete next[key]; return next; }); }}
              onApply={() => void perform(async current => { if (!fresh) throw new Error('Preview the changed upgrade decisions again.'); const saved = (await applyPreparedConditionalPackage(preview, await getExportDeploymentPolicy(), reviewed, signal(), current)).record; if (current()) { callback.current?.(false); onApply(saved); } })} />
          </>}
        </div></details>}
        {configured.length > 0 && <details className="min-w-0 rounded border p-3"><summary className="cursor-pointer font-medium">Migrate one form definition</summary><div className="space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">Select an exact replacement blueprint, map every existing answer, option and repeating group, then decide each affected field link. This does not adopt the template's document membership.</p>
          <label className="block text-sm">Captured form<select aria-label="Form to upgrade" className={inputClass} value={formId} onChange={event => chooseDefinition(event.target.value, blueprintKey)}><option value="">Choose a configured form</option>{configured.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="block text-sm">Replacement blueprint<select aria-label="Upgraded form blueprint" className={inputClass} value={blueprintKey} onChange={event => chooseDefinition(formId, event.target.value)}><option value="">Choose the exact new definition</option>{target.members.filter(item => item.kind === 'native' && item.draft.genericForm).map(item => <option key={item.key} value={item.key}>{item.label} · {item.key}</option>)}</select></label>
          {form && blueprint && <><label className="block text-sm">Answer, option and row-group mappings<textarea aria-label="Form definition migration" className={`${inputClass} font-mono text-xs`} rows={10} value={migrationJSON} onChange={event => { invalidate(); setMigrationJSON(event.target.value); }} /></label>
            {affected.map(binding => <label key={binding.id} className="block text-sm">Field link: {revision.information?.facts.find(fact => fact.id === binding.factId)?.label ?? binding.id}<select aria-label={`Definition link decision ${binding.id}`} className={inputClass} value={bindingChoices[binding.id] ?? ''} onChange={event => { invalidate(); setBindingChoices(before => { const next = { ...before }; if (event.target.value) next[binding.id] = event.target.value as PackageDefinitionBindingChoice; else delete next[binding.id]; return next; }); }}>
              <option value="">Choose how to preserve this link</option><option value="remap">Remap to the qualified new field</option><option value="override">Remap as a local override</option><option value="detach">Detach and preserve the document answer</option>
            </select></label>)}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={preserveSignatures} onChange={event => { invalidate(); setPreserveSignatures(event.target.checked); }} />Keep any signature answers in the original history and leave the upgraded signature fields blank.</label>
            <Button className={buttonClass} variant="outline" onClick={() => void perform(async current => { const result = await preparePackageDefinitionUpgrade(record, formId, target, blueprintKey, JSON.parse(migrationJSON) as FormMigration, bindingChoices, preserveSignatures, await getExportDeploymentPolicy(), signal()); if (current()) { setDefinitionPreview(result); setDefinitionReviewed(false); } })}>Preview form definition upgrade</Button>
          </>}
          {definitionPreview && <div className="space-y-3 rounded border p-3 text-sm"><p>{definitionPreview.label}: definition {definitionPreview.from} → {definitionPreview.to}</p>
            {definitionPreview.mappedAnswers.map(item => <div key={item.before} className="min-w-0 rounded border p-2"><p className="break-words">Answer {item.before} → {item.after}</p>
              <p className="whitespace-pre-wrap break-words text-xs">Before: {JSON.stringify(item.beforeValue)}</p><p className="whitespace-pre-wrap break-words text-xs">After: {JSON.stringify(item.afterValue)}</p></div>)}
            {definitionPreview.signatureAnswersOmitted > 0 && <p>{definitionPreview.signatureAnswersOmitted} signature answers remain only in original history; upgraded signature fields are blank.</p>}
            <PackageChangeImpactSummary impact={definitionPreview.impact} />
            {definitionPreview.reviews.flatMap(review => [...review.notices, ...review.privacy.findings.map(finding => `${finding.type}: ${finding.value}`)]).map((text, index) => <p key={index} className="whitespace-pre-wrap break-words text-xs">{text}</p>)}
            <label className="flex items-start gap-2"><input type="checkbox" checked={definitionReviewed} onChange={event => setDefinitionReviewed(event.target.checked)} />I reviewed the exact definition, template pages, mapped answers and every field-link decision. Original captures and reviews remain historical.</label>
            <Button className={buttonClass} disabled={!definitionReviewed} onClick={() => void perform(async current => { const saved = await applyPackageDefinitionUpgrade(definitionPreview, await getExportDeploymentPolicy(), definitionReviewed, signal(), current); if (current()) { callback.current?.(false); onApply(saved); } })}>Apply reviewed form definition upgrade</Button>
          </div>}
        </div></details>}
      </>}
    </fieldset>
    {target && <Button className={buttonClass} variant="outline" disabled={busy || pending} onClick={() => { invalidate(); setTarget(null); setPreview(null); setSource(null); setAttachments({}); }}>Discard upgrade preparation</Button>}
  </section>;
}

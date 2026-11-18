import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { newPackageId, type ActionPackage, type PackageRevision } from '@/lib/actionPackages';
import { packageFactSchema, packageInformationSchema, type PackageFact, type PackageFactSource, type PackageInformation, type PackageParticipant } from '@/lib/packageInformation';
import { listPackageBindingFields, packageBindingTargetKey, type PackageBindingField } from '@/lib/packageBindingTargets';
import { formatPackageFactForField, suggestPackageFieldValues, type PackageFieldBinding, type PackageFieldBindings, type PackageFieldSuggestion } from '@/lib/packageFieldBindings';
import { applyPreparedPackageUpdate, preparePackageUpdate, undoPackageUpdate, type PackageUpdateChoice, type PackageUpdateChoices, type PackageUpdateUndo, type PreparedPackageUpdate } from '@/lib/packageUpdates';
import { focusPackageDestination, matchesPackageDestination, type PackageDestinationRequest } from '@/lib/packageDestinations';

interface FactDraft {
  id: string;
  label: string;
  participantId?: string;
  kind: PackageFact['kind'];
  value: string | boolean;
  source: PackageFactSource;
}
interface MemberField { memberId: string; memberLabel: string; field: PackageBindingField; key: string; search: string }
interface InformationDraft { facts: FactDraft[]; participants: PackageParticipant[]; bindings: PackageFieldBinding[] }
interface Props {
  record: ActionPackage;
  revision: PackageRevision;
  disabled: boolean;
  busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  onApply(record: ActionPackage): void;
  isCurrent(): boolean;
  signal(): AbortSignal | undefined;
  onDirtyChange?(dirty: boolean): void;
  destination?: PackageDestinationRequest;
}
const inputClass = 'block w-full rounded border bg-background p-2 text-sm';
const factKinds: Array<{ kind: PackageFact['kind']; label: string }> = [
  { kind: 'text', label: 'Text' }, { kind: 'identifier', label: 'Identifier' },
  { kind: 'date', label: 'Date (YYYY-MM-DD)' }, { kind: 'decimal', label: 'Number' }, { kind: 'boolean', label: 'Yes / No' },
];
function draftFrom(revision: PackageRevision): InformationDraft {
  return structuredClone({ facts: revision.information?.facts ?? [], participants: revision.information?.participants ?? [], bindings: revision.bindings?.items ?? [] });
}
function displayValue(value: string | boolean | null | undefined): string {
  return value === null || value === undefined ? 'Unanswered' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : value || '(Empty)';
}
function fieldKey(value: MemberField): string { return value.key; }
function optionValue(value: PackageBindingField['value']): string { const text = displayValue(value); return text.length > 80 ? `${text.slice(0, 80)}…` : text; }
function compatible(fact: PackageFact | undefined, field: PackageBindingField): boolean {
  if (!fact) return false;
  try { formatPackageFactForField(fact, field); return true; } catch { return false; }
}
function matchingTargets(fact: PackageFact | undefined, fields: MemberField[], usedTargets: Set<string>, search: string) {
  const targets: MemberField[] = [];
  if (!fact) return { targets, more: false };
  const needle = search.trim().toLowerCase();
  for (const field of fields) {
    if (needle && !field.search.includes(needle)) continue;
    if (fact.kind === 'boolean' ? field.field.kind !== 'boolean' : field.field.kind === 'boolean') continue;
    if (field.field.kind === 'date' && fact.kind !== 'date' || field.field.kind === 'decimal' && fact.kind !== 'decimal') continue;
    if (usedTargets.has(fieldKey(field))) continue;
    if (!compatible(fact, field.field)) continue;
    if (targets.length === 100) return { targets, more: true };
    targets.push(field);
  }
  return { targets, more: false };
}
function Source({ source }: { source: PackageFactSource }) {
  const sourceField = source.kind === 'document' ? source.field.replace(/ \[[a-f0-9]{64}\]$/u, '') : '';
  const capturedDate = source.kind === 'document' ? new Date(source.capturedAt) : null;
  const capturedAt = capturedDate && Number.isFinite(capturedDate.getTime()) ? capturedDate.toISOString() : 'Unknown date';
  return source.kind === 'entered' ? <p className="text-xs text-muted-foreground">Entered in this package.</p> : <details className="text-xs text-muted-foreground">
    <summary className="break-words">Captured from {source.label} · {sourceField}</summary>
    {source.kind === 'document' && source.field !== sourceField && <p className="break-all">Captured field locator: {source.field}</p>}
    <p>Captured {capturedAt}</p>
    {source.sha256 && <p className="break-all">Source digest: {source.sha256}</p>}
    <p>Captured provenance does not create a live source-document connection.</p>
  </details>;
}

/** Edits stay local until an exact, reviewed update is committed as a package revision. */
export function PackageInformationPanel({ record, revision, disabled, busy, run, onApply, isCurrent, signal, onDirtyChange, destination }: Props) {
  const headingId = useId();
  const content = useRef<HTMLElement>(null), handledDestination = useRef<number | null>(null);
  const owner = `${record.id}:${record.sequence}:${record.currentRevisionId}:${revision.id}:${record.archived}`;
  const ownerRef = useRef(owner);
  const [draft, setDraft] = useState<InformationDraft>(() => draftFrom(revision));
  const [choices, setChoices] = useState<PackageUpdateChoices>({});
  const [preview, setPreview] = useState<PreparedPackageUpdate | null>(null);
  const [fresh, setFresh] = useState(false), [reviewed, setReviewed] = useState(false);
  const [undo, setUndo] = useState<PackageUpdateUndo | null>(null);
  const [fieldMemberId, setFieldMemberId] = useState(revision.members.find(member => member.kind === 'native')?.id ?? '');
  const [fields, setFields] = useState<MemberField[]>([]), [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<PackageFieldSuggestion[] | null>(null);
  const [suggestionPage, setSuggestionPage] = useState(0);
  const [targetSearch, setTargetSearch] = useState<Record<string, string>>({});
  const [suggestionTargets, setSuggestionTargets] = useState<Record<number, string>>({});
  const [targetSelections, setTargetSelections] = useState<Record<string, string>>({});
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState(false);
  const mounted = useRef(false), running = useRef(false), generation = useRef(0);
  const lastOwner = useRef(owner), dirtyCallback = useRef(onDirtyChange);
  const ownRevision = useRef<string | null>(null);
  useLayoutEffect(() => { ownerRef.current = owner; dirtyCallback.current = onDirtyChange; }, [owner, onDirtyChange]);
  const editable = revision.id === record.currentRevisionId && !record.archived && !record.reviewRounds?.some(round => round.ownerPackageId === undefined);
  const savedDraft = useMemo(() => JSON.stringify(draftFrom(revision)), [revision]);
  const dirty = JSON.stringify(draft) !== savedDraft || Object.keys(choices).length > 0;
  const usedTargets = useMemo(() => new Set(draft.bindings.map(binding => `${binding.memberId}:${packageBindingTargetKey(binding.target)}`)), [draft.bindings]);
  const locked = disabled || !editable || busy || pending;
  useEffect(() => {
    if (!matchesPackageDestination(destination, record.id, revision.id) || handledDestination.current === destination.requestId) return;
    const attribute = destination.bindingId ? 'data-package-binding-id' : 'data-package-fact-id';
    const identity = destination.bindingId ?? destination.factId;
    if (!identity) return;
    if (focusPackageDestination(content.current, attribute, identity)) handledDestination.current = destination.requestId;
  }, [destination, record.id, revision.id, draft]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; dirtyCallback.current?.(false); };
  }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => {
    if (lastOwner.current === owner) return;
    lastOwner.current = owner; generation.current++;
    setDraft(draftFrom(revision)); setChoices({}); setPreview(null); setFresh(false); setReviewed(false);
    setFieldMemberId(revision.members.find(member => member.kind === 'native')?.id ?? '');
    setFields([]); setFieldErrors([]); setSuggestions(null); setSuggestionPage(0); setSuggestionTargets({}); setTargetSelections({}); setTargetSearch({}); setError('');
    const ownTransition = ownRevision.current === revision.id;
    if (!ownTransition) setNotice('');
    ownRevision.current = null;
    setUndo(value => ownTransition && value?.packageId === record.id && value.appliedRevisionId === record.currentRevisionId && revision.id === record.currentRevisionId ? value : null);
  }, [owner, record.id, record.currentRevisionId, revision]);
  // Switching to a historical/reviewer view or a native editor invalidates an in-flight plan.
  const wasDisabled = useRef(disabled || !editable);
  useEffect(() => {
    if (wasDisabled.current !== (disabled || !editable)) {
      generation.current++; setPreview(null); setFresh(false); setReviewed(false);
    }
    wasDisabled.current = disabled || !editable;
  }, [disabled, editable]);

  function invalidate(keepPreview = false) {
    generation.current++; setFresh(false); setReviewed(false); setError(''); setNotice('');
    if (!keepPreview) setPreview(null);
  }
  function edit(next: InformationDraft) { invalidate(); setDraft(next); }
  function editFact(id: string, patch: Partial<FactDraft>) {
    edit({ ...draft, facts: draft.facts.map(fact => fact.id === id ? { ...fact, ...patch } : fact) });
  }
  async function perform(action: (current: () => boolean) => Promise<void>) {
    if (locked || running.current) return;
    running.current = true; setPending(true); setError('');
    const capturedOwner = owner, capturedGeneration = generation.current;
    const current = () => mounted.current && ownerRef.current === capturedOwner && generation.current === capturedGeneration && isCurrent() && !signal()?.aborted;
    try {
      await run(async () => {
        try { await action(current); }
        catch (cause) {
          if (current()) { setPreview(null); setFresh(false); setReviewed(false); setError(cause instanceof Error ? cause.message : 'The package information operation failed.'); }
        }
      });
    } finally { running.current = false; if (mounted.current) setPending(false); }
  }
  function snapshots(): { information: PackageInformation | undefined; bindings: PackageFieldBindings | undefined } {
    const parsed = packageInformationSchema.safeParse({ version: 1, participants: draft.participants, facts: draft.facts });
    if (!parsed.success) {
      const messages = parsed.error.issues.slice(0, 4).map(issue => {
        const index = issue.path[1];
        const label = issue.path[0] === 'facts' && typeof index === 'number' ? draft.facts[index]?.label || `Package value ${index + 1}` : 'Package information';
        return `${label}: ${issue.message}`;
      });
      throw new Error(messages.join(' '));
    }
    return { information: revision.information || draft.facts.length || draft.participants.length ? parsed.data : undefined,
      bindings: revision.bindings || draft.bindings.length ? { version: 1, items: structuredClone(draft.bindings) } : undefined };
  }
  function decision(id: string, value: string) {
    invalidate(true);
    const next = { ...choices };
    if (value) next[id] = value as PackageUpdateChoice; else delete next[id];
    setChoices(next);
  }
  function reset() {
    invalidate(); setDraft(draftFrom(revision)); setChoices({}); setTargetSelections({});
    setNotice('Unapplied changes discarded. The saved package is unchanged.');
  }
  function adopt(suggestion: PackageFieldSuggestion, index: number) {
    const targetId = suggestionTargets[index];
    const existing = draft.facts.find(fact => fact.id === targetId);
    if (existing && existing.kind !== suggestion.kind) return;
    const value: FactDraft = existing ? { ...existing, value: suggestion.value, source: structuredClone(suggestion.source) }
      : { id: newPackageId('fact'), label: suggestion.label.slice(0, 160), kind: suggestion.kind, value: suggestion.value, source: structuredClone(suggestion.source) };
    edit({ ...draft, facts: existing ? draft.facts.map(fact => fact.id === existing.id ? value : fact) : [...draft.facts, value] });
    setNotice('Suggestion added to the unapplied draft. Preview changes to review and save it.');
  }

  return <section ref={content} tabIndex={-1} data-package-panel="information" aria-labelledby={headingId} className="min-w-0 space-y-4 rounded-lg border bg-background p-3 sm:p-4" aria-busy={pending}>
    <div className="space-y-1">
      <h3 id={headingId} className="font-medium">Package information</h3>
      <p className="text-sm text-muted-foreground">Keep shared details here and link only the document fields you choose. Each application saves a new package revision.</p>
      <p role="status" className="text-xs text-muted-foreground">{dirty ? 'Unapplied changes · not saved to the package yet.' : 'Showing saved package information.'}</p>
      {!editable && <p className="text-xs text-muted-foreground">Information is read-only in historical, archived and reviewer copies.</p>}
      {disabled && editable && <p className="text-xs text-muted-foreground">Finish the active document edit before changing package information.</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    </div>
    <fieldset disabled={locked} className="min-w-0 space-y-4">
      <legend className="text-sm font-medium">Shared values</legend>
      {!draft.facts.length && <p className="text-sm text-muted-foreground">No shared values yet. Add one or inspect suggestions from the package documents.</p>}
      {draft.facts.map((fact, index) => {
        const saved = !!revision.information?.facts.some(value => value.id === fact.id);
        const links = draft.bindings.filter(binding => binding.factId === fact.id);
        const parsedFact = packageFactSchema.safeParse(fact);
        const { targets, more } = matchingTargets(parsedFact.success ? parsedFact.data : undefined, fields, usedTargets, targetSearch[fact.id] ?? '');
        return <fieldset key={fact.id} className="min-w-0 space-y-3 rounded border p-3">
          <legend tabIndex={-1} data-package-fact-id={fact.id} className="max-w-full break-words px-1 text-sm font-medium">{fact.label || `Package value ${index + 1}`}</legend>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-sm">Label<input aria-label={`Value label ${index + 1}`} className={inputClass} value={fact.label} maxLength={160} onChange={event => editFact(fact.id, { label: event.target.value })} /></label>
            <label className="min-w-0 text-sm">Kind<select aria-label={`Value kind ${index + 1}`} className={inputClass} value={fact.kind} disabled={saved} onChange={event => editFact(fact.id, { kind: event.target.value as PackageFact['kind'], value: event.target.value === 'boolean' ? false : '', source: { kind: 'entered' } })}>
              {factKinds.map(kind => <option key={kind.kind} value={kind.kind}>{kind.label}</option>)}
            </select></label>
            <label className="min-w-0 text-sm sm:col-span-2">Value{fact.kind === 'boolean'
              ? <select aria-label={`Value ${index + 1}`} className={inputClass} value={String(fact.value)} onChange={event => editFact(fact.id, { value: event.target.value === 'true', source: { kind: 'entered' } })}><option value="false">No</option><option value="true">Yes</option></select>
              : fact.kind === 'text' ? <textarea aria-label={`Value ${index + 1}`} className={inputClass} rows={2} value={String(fact.value)} maxLength={10000} onChange={event => editFact(fact.id, { value: event.target.value, source: { kind: 'entered' } })} />
                : <input aria-label={`Value ${index + 1}`} className={inputClass} value={String(fact.value)} inputMode={fact.kind === 'decimal' ? 'decimal' : undefined} placeholder={fact.kind === 'date' ? 'YYYY-MM-DD' : undefined} maxLength={fact.kind === 'identifier' ? 200 : 100} onChange={event => editFact(fact.id, { value: event.target.value, source: { kind: 'entered' } })} />}
            </label>
            <label className="min-w-0 text-sm">Person<select aria-label={`Value person ${index + 1}`} className={inputClass} value={fact.participantId ?? ''} disabled={saved} onChange={event => {
              const next = { ...fact }; if (event.target.value) next.participantId = event.target.value; else delete next.participantId;
              edit({ ...draft, facts: draft.facts.map(value => value.id === fact.id ? next : value) });
            }}><option value="">Package-wide</option>{draft.participants.map(person => <option key={person.id} value={person.id}>{person.label || 'Unnamed person'} · {person.role}</option>)}</select></label>
          </div>
          {saved && <p className="text-xs text-muted-foreground">Kind and person identify this saved value. Add a new value to change either.</p>}
          <Source source={fact.source} />
          {fields.length > 0 && <div className="space-y-2">
            <label className="block text-sm">Search document fields<input aria-label={`Search fields for value ${index + 1}`} className={inputClass} value={targetSearch[fact.id] ?? ''} onChange={event => { setTargetSearch({ ...targetSearch, [fact.id]: event.target.value }); setTargetSelections({ ...targetSelections, [fact.id]: '' }); }} placeholder="Field name or current value" /></label>
            <p className="text-xs text-muted-foreground">{targets.length} compatible fields shown.{more ? ' More are available; refine your search.' : ''}</p>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm">Link a document field<select aria-label={`Link field for value ${index + 1}`} className={inputClass} value={targetSelections[fact.id] ?? ''} onChange={event => setTargetSelections({ ...targetSelections, [fact.id]: event.target.value })}>
              <option value="">Choose a compatible, unlinked field</option>{targets.map(field => <option key={fieldKey(field)} value={fieldKey(field)}>{field.memberLabel} · {field.field.label} · {optionValue(field.field.value)}</option>)}
            </select></label>
            <Button variant="outline" disabled={!targets.some(field => fieldKey(field) === targetSelections[fact.id]) || draft.bindings.length >= 500} onClick={() => {
              const target = targets.find(field => fieldKey(field) === targetSelections[fact.id]); if (!target) return;
              edit({ ...draft, bindings: [...draft.bindings, { id: newPackageId('binding'), factId: fact.id, memberId: target.memberId, target: structuredClone(target.field.target), expectedValue: target.field.value, mode: 'linked', format: 'field' }] });
              setTargetSelections({ ...targetSelections, [fact.id]: '' });
            }}>Link value {index + 1}</Button>
            </div>
          </div>}
          {links.length > 0 && <ul aria-label={`Linked fields for value ${index + 1}`} className="space-y-2 text-sm">
            {links.map(binding => {
              const field = fields.find(value => value.memberId === binding.memberId && packageBindingTargetKey(value.field.target) === packageBindingTargetKey(binding.target));
              const member = revision.members.find(value => value.id === binding.memberId);
              return <li key={binding.id} tabIndex={-1} data-package-binding-id={binding.id} className="space-y-1 rounded border p-2">
                <p className="break-words">{member?.label ?? 'Unavailable document'} · {field?.field.label ?? ('field' in binding.target ? binding.target.field : binding.target.fieldId)} · {binding.mode === 'override' ? 'Local override' : 'Linked'}</p>
                <p className="text-xs text-muted-foreground">Last shared value: {displayValue(binding.expectedValue)}{field ? ` · Current field: ${displayValue(field.field.value)}` : ''}</p>
                <label className="block text-xs">Link decision<select aria-label={`Link decision ${binding.id}`} className={inputClass} value={choices[binding.id] ?? ''} onChange={event => decision(binding.id, event.target.value)}>
                  <option value="">Keep existing link behavior</option><option value="keep-local">Keep document value as a local override</option><option value="reconnect">Reconnect and apply package value</option><option value="detach">Detach and preserve document value</option>
                </select></label>
              </li>;
            })}
          </ul>}
          <Button variant="outline" disabled={links.some(binding => choices[binding.id] !== 'detach')} onClick={() => {
            const ids = new Set(links.map(binding => binding.id));
            const nextChoices = { ...choices }; for (const id of ids) delete nextChoices[id];
            edit({ ...draft, facts: draft.facts.filter(value => value.id !== fact.id), bindings: draft.bindings.filter(value => !ids.has(value.id)) }); setChoices(nextChoices);
          }}>Remove value {index + 1}</Button>
          {links.some(binding => choices[binding.id] !== 'detach') && <p className="text-xs text-muted-foreground">Detach this value’s document fields before removing it.</p>}
        </fieldset>;
      })}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={draft.facts.length >= 200} onClick={() => edit({ ...draft, facts: [...draft.facts, { id: newPackageId('fact'), label: '', kind: 'text', value: '', source: { kind: 'entered' } }] })}>Add shared value</Button>
        <label className="min-w-0 flex-1 text-sm">Document for field links<select aria-label="Document for field links" className={inputClass} value={fieldMemberId} onChange={event => { setFieldMemberId(event.target.value); setFields([]); setFieldErrors([]); setTargetSelections({}); }}>
          {!revision.members.some(member => member.kind === 'native') && <option value="">No editable package documents</option>}
          {revision.members.filter(member => member.kind === 'native').map(member => <option key={member.id} value={member.id}>{member.label}</option>)}
        </select></label>
        <Button variant="outline" disabled={!fieldMemberId} onClick={() => void perform(async current => {
          const member = revision.members.find(member => member.id === fieldMemberId); if (!member) return;
          try {
            const available = await listPackageBindingFields(member);
            if (!current()) return;
            setFields(available.map(field => ({ memberId: member.id, memberLabel: member.label, field, key: `${member.id}:${packageBindingTargetKey(field.target)}`, search: `${member.label} ${field.label} ${displayValue(field.value)}`.toLowerCase() }))); setFieldErrors([]);
            setNotice('Only supported scalar fields can be linked. Narrative text, signatures and calculated fields stay in their document editors.');
          } catch (cause) {
            if (current()) { setFields([]); setFieldErrors([cause instanceof Error ? cause.message : 'Document fields could not be read.']); }
          }
        })}>Load document fields</Button>
      </div>
      {fieldErrors.map((message, index) => <p key={index} className="text-xs text-destructive">{message}</p>)}
      {draft.bindings.some(binding => !draft.facts.some(fact => fact.id === binding.factId)) && <div className="space-y-2 rounded border p-2 text-sm">
        <p>Some retained links refer to unavailable package values.</p>
        {draft.bindings.filter(binding => !draft.facts.some(fact => fact.id === binding.factId)).map(binding => <label key={binding.id} tabIndex={-1} data-package-binding-id={binding.id} className="block break-words">{binding.id}<select aria-label={`Link decision ${binding.id}`} className={inputClass} value={choices[binding.id] ?? ''} onChange={event => decision(binding.id, event.target.value)}><option value="">Keep retained link</option><option value="detach">Detach and preserve document value</option></select></label>)}
      </div>}
    </fieldset>
    <details className="space-y-3 rounded border p-3">
      <summary className="cursor-pointer text-sm font-medium">People ({draft.participants.length})</summary>
      <fieldset disabled={locked} className="min-w-0 space-y-3 pt-3">
        {draft.participants.map((person, index) => <div key={person.id} className="grid min-w-0 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="min-w-0 text-sm">Person label<input aria-label={`Person label ${index + 1}`} className={inputClass} value={person.label} maxLength={160} onChange={event => edit({ ...draft, participants: draft.participants.map(value => value.id === person.id ? { ...value, label: event.target.value } : value) })} /></label>
          <label className="min-w-0 text-sm">Role<select aria-label={`Person role ${index + 1}`} className={inputClass} value={person.role} disabled={!!revision.information?.participants.some(value => value.id === person.id)} onChange={event => edit({ ...draft, participants: draft.participants.map(value => value.id === person.id ? { ...value, role: event.target.value as PackageParticipant['role'] } : value) })}>
            <option value="subject">Subject</option><option value="requester">Requester</option><option value="approver">Approver</option><option value="other">Other</option>
          </select></label>
          <Button variant="outline" disabled={draft.facts.some(fact => fact.participantId === person.id)} onClick={() => edit({ ...draft, participants: draft.participants.filter(value => value.id !== person.id) })}>Remove person {index + 1}</Button>
        </div>)}
        <p className="text-xs text-muted-foreground">Saved roles keep their identity. Remove a person’s values before removing that person.</p>
        <Button variant="outline" disabled={draft.participants.length >= 100} onClick={() => edit({ ...draft, participants: [...draft.participants, { id: newPackageId('person'), label: '', role: 'subject' }] })}>Add person</Button>
      </fieldset>
    </details>
    <details className="min-w-0 space-y-3 rounded border p-3">
      <summary className="cursor-pointer text-sm font-medium">Suggestions from documents</summary>
      <p className="pt-2 text-xs text-muted-foreground">Each source is listed separately. Nothing is adopted or linked automatically.</p>
      <Button variant="outline" disabled={locked} onClick={() => void perform(async current => {
        const value = await suggestPackageFieldValues(revision.members); if (current()) { setSuggestions(value); setSuggestionPage(0); setSuggestionTargets({}); }
      })}>Inspect document suggestions</Button>
      {suggestions?.length === 0 && <p className="text-sm text-muted-foreground">No supported, answered source values were found.</p>}
      {suggestions && <ul aria-label="Document suggestions" className="space-y-3 pt-3">{suggestions.slice(suggestionPage * 25, (suggestionPage + 1) * 25).map((suggestion, offset) => { const index = suggestionPage * 25 + offset; return <li key={`${suggestion.memberId}:${packageBindingTargetKey(suggestion.target)}`} className="min-w-0 space-y-2 rounded border p-3">
        <p className="break-words text-sm font-medium">{suggestion.label}: {displayValue(suggestion.value)}</p>
        <Source source={suggestion.source} />
        <p className="break-all text-xs text-muted-foreground">Captured member revision: {suggestion.memberRevisionId}</p>
        <label className="block text-sm">Adopt into<select aria-label={`Suggestion destination ${index + 1}`} disabled={locked} className={inputClass} value={suggestionTargets[index] ?? ''} onChange={event => setSuggestionTargets({ ...suggestionTargets, [index]: event.target.value })}>
          <option value="">New package value</option>{draft.facts.filter(fact => fact.kind === suggestion.kind).map(fact => {
            const person = draft.participants.find(participant => participant.id === fact.participantId);
            const owner = fact.participantId ? `${person?.label || 'Unnamed person'} · ${person?.role ?? 'other'}` : 'Package-wide';
            return <option key={fact.id} value={fact.id}>{fact.label || 'Unnamed package value'} · {owner}</option>;
          })}
        </select></label>
        <Button variant="outline" disabled={locked || !suggestionTargets[index] && draft.facts.length >= 200} onClick={() => adopt(suggestion, index)}>Adopt suggestion {index + 1}</Button>
      </li>; })}</ul>}
      {!!suggestions?.length && <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">Suggestions {suggestionPage * 25 + 1}–{Math.min((suggestionPage + 1) * 25, suggestions.length)} of {suggestions.length}</p>
        <Button variant="outline" disabled={locked || suggestionPage === 0} onClick={() => setSuggestionPage(value => value - 1)}>Previous suggestions</Button>
        <Button variant="outline" disabled={locked || (suggestionPage + 1) * 25 >= suggestions.length} onClick={() => setSuggestionPage(value => value + 1)}>Show more suggestions</Button>
      </div>}
    </details>
    <div className="flex flex-wrap gap-2">
      <Button disabled={locked || !dirty} onClick={() => void perform(async current => {
        const next = snapshots();
        const value = await preparePackageUpdate(record, next.information, next.bindings, choices, await getExportDeploymentPolicy(), signal());
        if (current()) { setPreview(value); setFresh(true); setReviewed(false); }
      })}>Preview package changes</Button>
      <Button variant="outline" disabled={locked || !dirty} onClick={reset}>Discard unapplied changes</Button>
    </div>
    {preview && <section aria-label="Package changes preview" className="min-w-0 space-y-3 rounded border p-3">
      <h4 className="font-medium">Review package changes</h4>
      <p className="break-all text-xs text-muted-foreground">Based on saved revision {preview.revisionId}. Previous revisions and source documents are preserved.</p>
      {!fresh && <p role="status" className="text-sm">Decisions changed. Preview again before applying.</p>}
      {preview.changes.length === 0 && <p className="text-sm">Package information changes only; no linked document fields change.</p>}
      {preview.changes.map(change => <article key={change.bindingId} className="min-w-0 space-y-2 border-t pt-2 text-sm">
        <p className="break-words font-medium">{revision.members.find(member => member.id === change.memberId)?.label ?? 'Unavailable document'} · {change.label}</p>
        <p>{change.state} · {change.message}</p>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2"><p className="whitespace-pre-wrap break-words">Current: {displayValue(change.before)}</p><p className="whitespace-pre-wrap break-words">Package value: {displayValue(change.after)}</p></div>
        {change.state !== 'detach' && <label className="block">Decision<select aria-label={`Preview decision ${change.bindingId}`} className={inputClass} disabled={locked} value={choices[change.bindingId] ?? ''} onChange={event => decision(change.bindingId, event.target.value)}>
          <option value="">Keep planned behavior</option>{change.state !== 'unavailable' && <><option value="apply-package">Apply package value</option><option value="keep-local">Keep document value as a local override</option><option value="reconnect">Reconnect and apply package value</option></>}<option value="detach">Detach and preserve document value</option>
        </select></label>}
      </article>)}
      {preview.issues.map((issue, index) => <p key={index} className="break-words text-sm text-destructive">{issue}</p>)}
      <div className="space-y-2 text-xs" aria-label="Package privacy and deployment review">
        {preview.reviews.map((review, index) => <div key={index} className="space-y-1">
          {review.notices.map((message, messageIndex) => <p key={messageIndex} className="whitespace-pre-wrap break-words">{message}</p>)}
          {review.privacy.findings.map((finding, findingIndex) => <p key={findingIndex} className="break-words">{finding.type}: {finding.value}</p>)}
          {review.structure.map((finding, findingIndex) => <p key={findingIndex} className="break-words">{finding.message}</p>)}
          {review.markingReview && <p>Review the classification markings before applying.</p>}
        </div>)}
      </div>
      {!preview.changed && <p className="text-sm">No saved changes are needed.</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={locked || !fresh || !preview.ready || !preview.changed} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the package values, linked field changes, local decisions and privacy findings.</label>
      <Button disabled={locked || !fresh || !preview.ready || !preview.changed || !reviewed} onClick={() => void perform(async current => {
        const policy = await getExportDeploymentPolicy();
        const policyCurrent = () => { const value = getExportDeploymentPolicySync(); return current() && value.status === 'ready' && policy.status === 'ready' && JSON.stringify(value.policy) === JSON.stringify(policy.policy); };
        const result = await applyPreparedPackageUpdate(preview, policy, reviewed, signal(), policyCurrent);
        if (!current()) return;
        setUndo(result.undo); setPreview(null); setFresh(false); setReviewed(false); setChoices({});
        setDraft(draftFrom(result.record.revisions.find(value => value.id === result.record.currentRevisionId)!));
        ownRevision.current = result.record.currentRevisionId; dirtyCallback.current?.(false); setNotice('Package changes saved as a new revision.'); onApply(result.record);
      })}>Apply package changes</Button>
    </section>}
    {undo && <div className="space-y-2 rounded border p-3">
      <p className="text-xs text-muted-foreground">Undo creates another revision and restores the package information and document values from before this application.</p>
      <Button variant="outline" disabled={locked || dirty} onClick={() => void perform(async current => {
        const policy = await getExportDeploymentPolicy();
        const result = await undoPackageUpdate(undo, policy, signal(), () => { const value = getExportDeploymentPolicySync(); return current() && value.status === 'ready' && policy.status === 'ready' && JSON.stringify(value.policy) === JSON.stringify(policy.policy); });
        if (!current()) return;
        setUndo(null); setChoices({}); setPreview(null); setDraft(draftFrom(result.revisions.find(value => value.id === result.currentRevisionId)!));
        ownRevision.current = result.currentRevisionId; dirtyCallback.current?.(false); setNotice('Package changes undone in a new revision.'); onApply(result);
      })}>Undo package changes</Button>
    </div>}
  </section>;
}

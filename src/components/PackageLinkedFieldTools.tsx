import { packageBindingFieldLabel } from '@/lib/packageBindingTargets';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ActionPackage, NativePackageMember, PackageRevision } from '@/lib/actionPackages';
import type { PackageFieldBinding } from '@/lib/packageFieldBindings';
import type { PackageDestination } from '@/lib/packageDestinations';
import { getExportDeploymentPolicy } from '@/config/classification';
import { changeDocumentOverride } from '@/lib/packageUpdates';
import { Button } from './ui/button';

type Props = {
  record: ActionPackage;
  onSave(record: ActionPackage): void;
  member: NativePackageMember;
  revision: PackageRevision;
  disabled: boolean;
  onReview(target: PackageDestination): void;
};

function matchesField(element: HTMLElement, binding: PackageFieldBinding) {
  const target = binding.target;
  if (target.kind === 'configured-form' && target.row) {
    const cell = element.closest<HTMLElement>('[data-binding-row]');
    return cell?.dataset.bindingGroup === target.row.groupId && cell.dataset.bindingRow === target.row.rowId
      && cell.dataset.bindingField === target.fieldId;
  }
  const field = target.kind === 'configured-form' ? 'answer-' + target.fieldId : target.field;
  return element.id === field || element.id === 'pkg-' + field;
}

export function PackageLinkedFieldTools({ record, member, revision, disabled, onReview, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState('');
  const links = revision.bindings?.items;
  useEffect(() => {
    const root = host.current?.closest('[role="dialog"]');
    if (!root || !links) return;
    const focus = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || host.current?.contains(el)) return;
      const link = links.find(item => item.memberId === member.id && matchesField(el, item));
      if (link) setSelected(link.id);
      else if (el.matches('input,textarea,select,[role="combobox"],[contenteditable="true"]')) setSelected('');
    };
    root.addEventListener('focusin', focus);
    return () => root.removeEventListener('focusin', focus);
  }, [links, member.id]);
  const [undo, setUndo] = useState<{ revisionId: string; bindingId: string }>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const current = useRef({ record, disabled });
  useLayoutEffect(() => { current.current = { record, disabled }; }, [record, disabled]);
  useEffect(() => () => operation.current?.abort(), []);
  async function change(bindingId: string, undoRevisionId?: string) {
    if (disabled || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true); setError('');
    try {
      const next = await changeDocumentOverride(record, member.id, bindingId, undoRevisionId, await getExportDeploymentPolicy(),
        controller.signal, () => current.current.record === record && !current.current.disabled);
      if (controller.signal.aborted) return;
      setUndo(undoRevisionId ? undefined : { revisionId: next.currentRevisionId, bindingId });
      onSave(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not save this field link.');
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  const bindings = links?.filter(item => item.memberId === member.id);
  if (!bindings?.length) return null;
  const binding = bindings.find(item => item.id === selected);
  const fact = revision.information?.facts.find(item => item.id === binding?.factId);
  return <div ref={host} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-sm">
    <label>Linked field <select className="rounded border bg-background px-2 py-1" value={binding?.id ?? ''} onChange={event => setSelected(event.target.value)}>
      <option value="">Select a field</option>
      {bindings.map(link => <option key={link.id} value={link.id}>{packageBindingFieldLabel(member.session, link.target)}</option>)}
    </select></label>
    {binding && fact && <>
      <span className="break-words text-muted-foreground">{fact.label} · {String(fact.value)}{binding.mode === 'override' ? ' · Document override' : ''}</span>
      {binding.mode === 'linked' && <Button size="sm" variant="link" disabled={disabled || pending} onClick={() => void change(binding.id)}>Keep for this document</Button>}
      {undo?.revisionId === revision.id && undo.bindingId === binding.id && <Button size="sm" variant="link" disabled={disabled || pending} onClick={() => void change(binding.id, undo.revisionId)}>Undo</Button>}
      <Button size="sm" variant="link" disabled={disabled || pending} onClick={() => onReview({ bindingId: binding.id, factId: fact.id, fieldDecision: 'shared', revisionId: revision.id })}>Update package details</Button>
    </>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}

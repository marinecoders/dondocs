import { packageBindingFieldLabel } from '@/lib/packageBindingTargets';
import { useEffect, useRef, useState } from 'react';
import type { NativePackageMember, PackageRevision } from '@/lib/actionPackages';
import type { PackageFieldBinding } from '@/lib/packageFieldBindings';
import type { PackageDestination } from '@/lib/packageDestinations';
import { Button } from './ui/button';

type Props = {
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

export function PackageLinkedFieldTools({ member, revision, disabled, onReview }: Props) {
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
      <Button size="sm" variant="link" disabled={disabled} onClick={() => onReview({ bindingId: binding.id, factId: fact.id, fieldDecision: 'keep-local', revisionId: revision.id })}>Keep for this document</Button>
      <Button size="sm" variant="link" disabled={disabled} onClick={() => onReview({ bindingId: binding.id, factId: fact.id, fieldDecision: 'shared', revisionId: revision.id })}>Update package details</Button>
    </>}
  </div>;
}

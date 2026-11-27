import { useEffect, useState } from 'react';
import type { PackageMember, PackageRevision } from '@/lib/actionPackages';
import { activePackageSignatureLabels, packageSignatureFieldLabel } from '@/lib/packageSignatureFieldLabel';
import { resolveConditionalPackageRequirements } from '@/lib/packageConditionalRequirements';
import type { PackageRequirements } from '@/lib/packageRequirementsModel';
import { inspectedOfficialSignatureSlots } from '@/services/forms/signingBridge';
import { Button } from './ui/button';

const returnAssessment = {
  'checks-agree': 'Handoff content checks matched.',
  unchanged: 'Returned copy matches the unsigned or previously signed handoff exactly.',
  different: 'Content differs from the handoff. Association accepted manually.',
  inconclusive: 'Content match inconclusive. Association accepted manually.',
};
interface Props {
  member: PackageMember;
  revision: PackageRevision;
  disabled: boolean;
  onField?(field: string): void;
  onHandoff(id: string): void;
}

export function PackageDocumentSignatures({ member, revision, disabled, onField, onHandoff }: Props) {
  const [legacy, setLegacy] = useState<{ revision: PackageRevision; requirements?: PackageRequirements; error?: boolean }>();
  useEffect(() => {
    if (revision.requirements || !revision.templateState) return;
    let current = true;
    void resolveConditionalPackageRequirements(revision).then(requirements => {
      if (current) setLegacy({ revision, requirements });
    }).catch(() => { if (current) setLegacy({ revision, error: true }); });
    return () => { current = false; };
  }, [revision]);
  const resolved = legacy?.revision === revision ? legacy : undefined;
  const requirements = revision.requirements ?? resolved?.requirements;
  const labels = activePackageSignatureLabels(requirements, member);
  const slots = new Map<string, 'Required' | 'Conditional' | 'Available field'>();
  for (const rule of requirements?.items ?? []) {
    if (rule.kind !== 'document' || rule.memberId !== member.id || !rule.operations.includes('pdf') || rule.condition === 'inactive' ||
        rule.memberRevisionId && rule.memberRevisionId !== member.revisionId) continue;
    for (const field of rule.completion?.signatureFields ?? []) {
      if (slots.get(field) !== 'Required') slots.set(field, rule.condition === 'active' ? 'Required' : 'Conditional');
    }
  }
  if (member.kind === 'native' && onField) {
    for (const field of Object.values(member.session.genericForm?.definition.fields ?? {})) {
      if (field.kind === 'signature') for (const id of field.sourceIds ?? []) if (!slots.has(id)) slots.set(id, 'Available field');
    }
  }
  const inspection = member.kind === 'original' ? inspectedOfficialSignatureSlots(member.original.sha256) : undefined;
  const inspected = new Map(inspection?.map(slot => [slot.name, slot]));
  for (const field of inspected.keys()) if (!slots.has(field)) slots.set(field, 'Available field');
  const handoffs = revision.signing?.handoffs.filter(entry => member.kind === 'original' &&
    (entry.target.kind === 'member' && entry.target.id === member.id && entry.target.revisionId === member.revisionId &&
      entry.sourceSha256 === member.original.sha256 ||
      entry.returns?.some(returned => returned.memberId === member.id && returned.returnedAsset.sha256 === member.original.sha256))) ?? [];
  const signedOriginal = member.kind === 'original' && member.signedOriginal;
  if (!slots.size && !handoffs.length && !signedOriginal && !resolved?.error) return null;

  return <details className="border-b pb-3 text-sm">
    <summary className="cursor-pointer font-medium">Signatures</summary>
    {resolved?.error && <p role="alert">Signature requirements could not be loaded for this saved revision.</p>}
    {signedOriginal && !inspection && <p className="mt-2">Original marked signed. Signature trust and field locks have not been checked on this device.</p>}
    {inspection?.some(slot => slot.signed && !slot.trusted) && <p className="mt-2">Signature requirements remain open until every signature on this copy has a trusted chain.</p>}
    <ul className="divide-y">{Array.from(slots, ([field, requirement]) => {
      const slot = inspected.get(field);
      const label = labels.get(field) || packageSignatureFieldLabel(member, field);
      const status = slot?.signed ? slot.trusted ? 'Signed · trusted chain' : 'Signed · trust unconfirmed'
        : slot?.locked ? 'Locked' : member.kind !== 'native' && !inspection ? 'Requires inspection' : inspection && !slot ? 'Field not found' : 'Unsigned';
      return <li key={field} className="py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span>{label === field ? slot?.label || label : label} · {requirement} · {status}</span>
          {onField && !slot?.signed && !slot?.locked && (!inspection || slot) && <Button size="sm" variant="link" disabled={disabled}
            aria-label={'Review signature field: ' + label} onClick={() => onField(field)}>Review field</Button>}
        </div>
        {slot && !slot.signed && !slot.locked && slot.lockAction && <p className="break-words text-xs text-muted-foreground">
          {slot.lockAction === 'All' ? 'Signing locks all fields.' : slot.lockAction === 'Include' ? 'Signing locks: ' + slot.lockFields.join(', ')
            : slot.lockAction === 'Exclude' ? 'Signing locks all fields except: ' + slot.lockFields.join(', ') : 'Review field locks before signing.'}
        </p>}
      </li>;
    })}</ul>
    {handoffs.map(entry => <div key={entry.id} className="mt-2 space-y-1">
      <p>{entry.returns?.length ? 'Return recorded' : 'Awaiting a returned copy'}</p>
      {(entry.returns ?? []).filter(returned => member.kind === 'original' &&
        (entry.target.kind === 'member' && entry.target.id === member.id && entry.sourceSha256 === member.original.sha256 ||
          returned.memberId === member.id && returned.returnedAsset.sha256 === member.original.sha256)).map(returned =>
          <p key={returned.id} className="text-xs text-muted-foreground">{returnAssessment[returned.assessment]}</p>)}
      {entry.signers.length > 0 && <p className="break-words text-xs">Signers on handoff · {entry.signers.join(', ')}</p>}
      <Button variant="link" size="sm" disabled={disabled} onClick={() => onHandoff(entry.id)}>Inspect handoff</Button>
    </div>)}
  </details>;
}

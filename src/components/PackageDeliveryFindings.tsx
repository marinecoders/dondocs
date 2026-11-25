import type { PackageRevision } from '@/lib/actionPackages';
import type { PackageDestination } from '@/lib/packageDestinations';
import type { PackageRequirementFinding } from '@/lib/packageRequirements';
import { Button } from './ui/button';

interface Props {
  revision: PackageRevision;
  findings: PackageRequirementFinding[];
  onNavigate(target: PackageDestination): void;
  disabled: boolean;
}

export function PackageDeliveryFindings({ revision, findings, onNavigate, disabled }: Props) {
  return <ul aria-label="Items to resolve" className="space-y-2">{findings.map(item => {
    const member = revision.members.find(candidate => candidate.id === item.memberId);
    const slot = revision.templateState?.instances.find(instance => instance.memberId === item.memberId);
    const target: PackageDestination = member ? { memberId: member.id } :
      slot || item.id.startsWith('intake:') || item.state === 'unknown' && revision.templateState
        ? { panel: 'intake', intakeSlot: slot?.key } : { panel: 'requirements', requirementId: item.id };
    const fields = item.signatureFields ?? [];
    const action = member ? 'Open document' : target.panel === 'requirements' ? 'Review requirement' : slot ? 'Open intake slot' : 'Review intake';
    return <li key={item.id} className="rounded border p-2">
      <p className="font-medium">{item.label}</p>
      <p className="break-words text-xs">{item.message}</p>
      <Button type="button" size="sm" variant="link" disabled={disabled}
        onClick={() => onNavigate({ ...target, revisionId: revision.id })}>{action}</Button>
      {member && fields.map(field => {
        const definition = member.kind === 'native' ? member.session.genericForm?.definition : undefined;
        const label = Object.values(definition?.fields ?? {}).find(entry => entry.sourceIds?.includes(field))?.label
          ?? field.split('.').at(-1)?.replace(/\[\d+\]$/, '').replaceAll('_', ' ') ?? field;
        return <Button type="button" key={field} size="sm" variant="link" disabled={disabled}
          onClick={() => onNavigate({ revisionId: revision.id, memberId: member.id, signatureField: field })}>Review {label}</Button>;
      })}
    </li>;
  })}</ul>;
}

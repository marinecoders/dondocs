import { packageFormSigningAction } from '@/lib/packageOfficialForms';
import { packageSignatureFieldLabel } from '@/lib/packageSignatureFieldLabel';
import type { PackageRevision } from '@/lib/actionPackages';
import type { PackageDestination } from '@/lib/packageDestinations';
import type { PackageRequirementFinding } from '@/lib/packageRequirements';
import { Button } from './ui/button';

interface Props {
  revision: PackageRevision;
  findings: PackageRequirementFinding[];
  onNavigate(target: PackageDestination): void;
  disabled: boolean;
  canSign?: boolean;
}

export function PackageDeliveryFindings({ revision, findings, onNavigate, disabled, canSign = true }: Props) {
  const members = new Map(revision.members.map(member => [member.id, member]));
  const slots = new Map(revision.templateState?.instances.map(slot => [slot.memberId, slot]));
  const groups = new Map<string, PackageRequirementFinding[]>();
  for (const item of findings) {
    const byDocument = item.memberId && members.has(item.memberId) && !item.fromIntake && !(item.state === 'unknown' && revision.templateState);
    const key = byDocument ? 'document:' + item.memberId : 'item:' + item.id;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return <ul aria-label="Items to resolve" className="divide-y">{Array.from(groups, ([key, items]) => {
    const item = items[0];
    const member = item.memberId ? members.get(item.memberId) : undefined;
    const slot = item.memberId ? slots.get(item.memberId) : undefined;
    const needsIntake = item.fromIntake || (item.state === 'unknown' && revision.templateState) || (!member && slot);
    const target: PackageDestination = needsIntake ? { panel: 'intake', intakeSlot: slot?.key }
      : member ? { memberId: member.id } : { panel: 'requirements', requirementId: item.id };
    const fields = new Set(items.flatMap(finding => finding.signatureFields ?? []));
    const action = target.memberId ? 'Open document' : target.panel === 'requirements' ? 'Review requirement' : slot && !member ? 'Open intake slot' : 'Review intake';
    const messages = new Set(items.flatMap(finding => {
      const details = finding.documentIssues ?? [finding.message];
      return target.memberId && finding.label !== member?.label
        ? details.map(message => finding.label + ' — ' + message) : details;
    }));
    const signingAvailable = !!target.memberId && !!member && canSign && !!packageFormSigningAction(member);
    if (!signingAvailable && member && fields.size) {
      messages.add('Outstanding signatures: ' + Array.from(fields, field => packageSignatureFieldLabel(member, field)).join(', ') + '.');
    }
    return <li key={key} className="space-y-1 py-3">
      <p className="font-medium">{target.memberId ? member?.label : item.label}</p>
      {Array.from(messages, message => <p key={message} className="break-words text-xs">{message}</p>)}
      {(messages.size > 0 || !fields.size || !member) && <Button type="button" size="sm" variant="link" disabled={disabled}
        onClick={() => onNavigate({ ...target, revisionId: revision.id })}>{action}</Button>}
      {signingAvailable && member && Array.from(fields, field => {
        return <Button type="button" key={field} size="sm" variant="link" disabled={disabled}
          onClick={() => onNavigate({ revisionId: revision.id, memberId: member.id, signatureField: field })}>Review {packageSignatureFieldLabel(member, field)}</Button>;
      })}
    </li>;
  })}</ul>;
}

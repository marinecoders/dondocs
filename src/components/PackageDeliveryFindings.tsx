import { indexDeliveryDocuments } from '@/lib/packageDeliveryDocuments';
import { packageFormSigningAction } from '@/lib/packageOfficialForms';
import { packageSignatureFieldLabel } from '@/lib/packageSignatureFieldLabel';
import type { PackageRevision } from '@/lib/actionPackages';
import type { PackageDestination } from '@/lib/packageDestinations';
import type { PackageRequirementFinding } from '@/lib/packageRequirements';
import { Button } from './ui/button';

interface Props {
  revision: PackageRevision;
  documents?: ReturnType<typeof indexDeliveryDocuments>;
  findings: PackageRequirementFinding[];
  onNavigate(target: PackageDestination): void;
  disabled: boolean;
  canSign?: boolean;
}

export function PackageDeliveryFindings({ revision, documents, findings, onNavigate, disabled, canSign = true }: Props) {
  const { members, slots } = documents ?? indexDeliveryDocuments(revision);
  const groups = new Map<string, PackageRequirementFinding[]>();
  for (const item of findings) {
    const byDocument = item.memberId && members.has(item.memberId) && !item.fromIntake && !(item.state === 'unknown' && revision.templateState);
    const intakeSlot = item.memberId && slots.get(item.memberId);
    const key = byDocument ? 'document:' + item.memberId
      : intakeSlot && !members.has(intakeSlot.memberId) ? 'slot:' + intakeSlot.key : 'item:' + item.id;
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
    const labels = new Map(items.flatMap(finding => Object.entries(finding.signatureLabels ?? {})));
    const fields = new Set(items.flatMap(finding => finding.signatureFields ?? []));
    const action = target.memberId ? 'Open document' : target.panel === 'requirements' ? 'Review requirement' : slot && !member ? 'Open intake slot' : 'Review intake';
    const messages = new Set(items.flatMap(finding => {
      const details = finding.documentIssues ?? [finding.message];
      return finding.label !== (target.memberId ? member?.label : item.label)
        ? details.map(message => finding.label + ' — ' + message) : details;
    }));
    const corrections = canSign && target.memberId ? [...new Map(items.flatMap(item => item.corrections ?? []).map(action => [JSON.stringify(action), action])).values()] : [];
    const signingAvailable = !!target.memberId && !!member && canSign && !!packageFormSigningAction(member);
    const handoff = member && fields.size > 0 && revision.signing?.handoffs.slice().reverse().find(entry =>
      entry.target.kind === 'member' && entry.target.id === member.id && entry.target.revisionId === member.revisionId && !entry.returns?.length);
    if (!signingAvailable && member && fields.size) {
      messages.add('Outstanding signatures: ' + Array.from(fields, field => (labels.get(field) || packageSignatureFieldLabel(member, field))).join(', ') + '.');
    }
    return <li key={key} className="space-y-1 py-3">
      <p className="font-medium">{target.memberId ? member?.label : item.label}</p>
      {Array.from(messages, message => <p key={message} className="break-words text-xs">{message}</p>)}
      {corrections.map(action => <Button key={JSON.stringify(action)} size="sm" variant="link" disabled={disabled}
        onClick={() => onNavigate({ ...target, revisionId: revision.id, correction: action })}>{action.label}</Button>)}
      {!corrections.length && (messages.size > 0 || !fields.size || !member) && <Button type="button" size="sm" variant="link" disabled={disabled}
        onClick={() => onNavigate({ ...target, revisionId: revision.id })}>{action}</Button>}
      {handoff && <p className="text-xs">Signing handoff prepared. No return recorded.{' '}
        <Button type="button" size="sm" variant="link" disabled={disabled} onClick={() => onNavigate({ revisionId: revision.id, signingId: handoff.id })}>Review handoff</Button>
      </p>}
      {signingAvailable && member && Array.from(fields, field => {
        return <Button type="button" key={field} size="sm" variant="link" disabled={disabled}
          onClick={() => onNavigate({ revisionId: revision.id, memberId: member.id, signatureField: field })}>Review {labels.get(field) || packageSignatureFieldLabel(member, field)}</Button>;
      })}
    </li>;
  })}</ul>;
}

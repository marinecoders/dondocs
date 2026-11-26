import { packageFormSigningAction } from '@/lib/packageOfficialForms';
import { packageDocumentName } from '@/lib/actionPackages';
import type { PreparedPackageAssembly } from '@/lib/actionPackageAssembly';
import type { PackageRevision } from '@/lib/actionPackages';
import type { PackageDestination } from '@/lib/packageDestinations';
import { Button } from './ui/button';
import type { ExportReview } from '@/lib/preparedExport';

export function PackageContentFindings({ reviews }: { reviews: readonly { member: string; review: ExportReview }[] }) {
  const content = new Map<string, { type: string; value: string; members: Set<string> }>();
  const notices = new Set<string>();
  for (const entry of reviews) {
    for (const finding of entry.review.privacy.findings) {
      const key = JSON.stringify([finding.type, finding.value]);
      const current = content.get(key) ?? { type: finding.type, value: finding.value, members: new Set<string>() };
      if (entry.member) current.members.add(entry.member);
      content.set(key, current);
    }
    for (const finding of entry.review.structure) notices.add(finding.message);
    for (const notice of entry.review.notices) notices.add(notice);
  }
  if (!content.size && !notices.size) return null;
  return <details className="text-sm"><summary className="cursor-pointer">{content.size ? `Content findings (${content.size})` : 'Export details'}</summary>
    <div className="mt-4 space-y-4">{[...content.entries()].map(([key, finding]) => <div key={key} className="space-y-1 border-t pt-3"><p className="break-words">{finding.type}: {finding.value}</p>{finding.members.size > 0 && <p className="break-words text-xs text-muted-foreground">{[...finding.members].join(' · ')}</p>}</div>)}
      {[...notices].map(notice => <p key={notice} className="break-words text-xs text-muted-foreground">{notice}</p>)}
    </div>
  </details>;
}

export function PackageExportFindings({ results, revision, onNavigate, editable }: {
  editable: boolean;
  results: readonly PreparedPackageAssembly[];
  revision: PackageRevision;
  onNavigate(destination: PackageDestination): void;
}) {
  const seen = new Set<string>();
  const findings = results.flatMap(result => result.readiness.findings).filter(finding => {
    const key = JSON.stringify([finding.severity, finding.question?.key ?? [finding.memberId, finding.message, finding.correction, finding.signatureLabels]]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const members = new Map(revision.members.map(member => [member.id, member]));
  return <div className="space-y-4">
    {findings.map((finding, index) => {
      if (finding.question) {
        const question = finding.question;
        return <div key={JSON.stringify([finding.severity, question.key])} className="text-sm"><Button variant="link" size="sm" className="h-auto p-0"
          onClick={() => onNavigate({ revisionId: revision.id, section: 'documents', panel: 'intake', intakeQuestion: question.key })}>{question.label}</Button></div>;
      }
      const member = finding.memberId ? members.get(finding.memberId) : undefined;
      const signatures = editable && member && packageFormSigningAction(member) ? Object.entries(finding.signatureLabels ?? {}) : [];
      const name = member && packageDocumentName(revision, member);
      const message = member && finding.message.startsWith(member.label + ': ')
        ? finding.message.slice(member.label.length + 2) : finding.message;
      return <div key={index} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <p role={finding.severity === 'error' ? 'alert' : undefined} className="break-words">{name && `${name}: `}{message}</p>
        {signatures.map(([field, label]) => <Button key={field} variant="link" size="sm"
          onClick={() => onNavigate({ memberId: finding.memberId, revisionId: revision.id, signatureField: field })}>
          Review {label}
        </Button>)}
        {finding.memberId && (!signatures.length || finding.correction) && <Button variant="link" size="sm" className="h-auto shrink-0 p-0"
          onClick={() => onNavigate({ section: 'documents', memberId: finding.memberId, revisionId: revision.id, correction: editable ? finding.correction : undefined })}>
          {editable && finding.correction ? finding.correction.label : 'Open document'}
        </Button>}
      </div>;
    })}
    <PackageContentFindings reviews={results.flatMap(result => result.reviews)} />
  </div>;
}

import { packageDocumentName } from '@/lib/actionPackages';
import type { ReactNode } from 'react';
import { FileText, Files, History, Paperclip } from 'lucide-react';
import type { ActionPackage, PackageMember, PackageRevision } from '@/lib/actionPackages';
import type { PackageWorkspaceSection } from '@/lib/packageWorkspaceContext';
import { Button } from './ui/button';

const sectionLabels: Record<PackageWorkspaceSection, string> = {
  overview: 'Overview', documents: 'Documents', review: 'Review', delivery: 'Delivery',
};

export function PackageWorkspaceNavigation({ active, hasPackage, disabled, onNavigate }: {
  active: PackageWorkspaceSection;
  hasPackage: boolean;
  disabled: boolean;
  onNavigate(section: PackageWorkspaceSection): void;
}) {
  return <nav aria-label="Package workspace" className="grid min-w-0 grid-cols-4 gap-1 border-b pb-3 sm:flex sm:flex-wrap">
    {(Object.keys(sectionLabels) as PackageWorkspaceSection[]).map(section => <Button
      key={section} size="sm" variant={active === section ? 'secondary' : 'ghost'}
      className="min-w-0 px-1 text-xs sm:px-3 sm:text-sm"
      aria-current={active === section ? 'location' : undefined}
      disabled={disabled || section !== 'overview' && !hasPackage}
      onClick={() => onNavigate(section)}
    >{sectionLabels[section]}</Button>)}
  </nav>;
}

/** Selected-record context and a stable home for contextual package panels. */
export function PackageWorkspaceSummary({ record, revision, children }: {
  record: ActionPackage;
  revision: PackageRevision;
  children?: ReactNode;
}) {
  const native = revision.members.filter(member => member.kind === 'native').length;
  const revisionNumber = record.revisions.findIndex(item => item.id === revision.id) + 1;
  return <section aria-label="Selected package" className="min-w-0 space-y-3 border-b pb-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="break-words text-lg font-semibold tracking-tight">{record.name}</h2>
        <p className="text-sm text-muted-foreground">
          {record.historyScope === 'selected-revision' ? `Saved revision ${revision.id.slice(-8)}` : `Revision ${revisionNumber}`} · {record.archived ? 'Archived package' : revision.id === record.currentRevisionId ? 'Current saved revision' : 'Historical saved revision'}
        </p>
      </div>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><History className="size-3.5" aria-hidden="true" />{record.revisions.length} saved revision{record.revisions.length === 1 ? '' : 's'}</span>
    </div>
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><Files className="size-4" aria-hidden="true" />{revision.members.length} document{revision.members.length === 1 ? '' : 's'}</span>
      <span>{native} editable draft{native === 1 ? '' : 's'}</span>
      <span>{revision.members.length - native} supporting original{revision.members.length - native === 1 ? '' : 's'}</span>
    </p>
    {children}
  </section>;
}

function memberKind(member: PackageMember): string {
  if (member.kind === 'original') return member.signedOriginal ? 'Marked signed · original PDF' : 'Original PDF';
  if (member.kind === 'attachment') return 'Supporting file · original bytes';
  return member.session.documentCategory === 'forms' ? 'Editable form' : 'Editable document';
}

export function PackageMemberNavigation({ revision, members, selectedId, disabled, onSelect }: {
  revision: PackageRevision;
  members: readonly PackageMember[];
  selectedId?: string;
  disabled: boolean;
  onSelect(id: string): void;
}) {
  if (!members.length) return null;
  const participants = new Map(revision.information?.participants.map(person => [person.id, person.label]));
  const owners = new Map(revision.templateState?.instances.map(slot => [slot.memberId, slot.participantId]));
  const groupAt = (index: number) => participants.get(owners.get(members[index]?.id) ?? '');
  return <nav aria-label="Package documents" className="min-w-0 space-y-2 lg:sticky lg:top-0 lg:self-start">
    <label className="block text-sm lg:hidden">Document to inspect
      <select aria-label="Document to inspect" className="mt-1 w-full min-w-0 rounded border bg-background p-2"
        value={selectedId ?? ''} disabled={disabled} onChange={event => onSelect(event.target.value)}>
        {members.map((member, index) => <option key={member.id} value={member.id}>{index + 1}. {packageDocumentName(revision, member)} · {memberKind(member)}</option>)}
      </select>
    </label>
    <div className="hidden space-y-1 lg:block">
      <p className="px-2 text-xs font-medium text-muted-foreground">Package documents</p>
      {members.map((member, index) => <div key={member.id}>
        {groupAt(index) && groupAt(index) !== groupAt(index - 1) && <p className="px-2 pt-3 text-xs font-medium">{groupAt(index)}</p>}
        <button type="button"
        disabled={disabled} aria-current={selectedId === member.id ? 'true' : undefined}
        className={`flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2.5 text-left text-sm disabled:opacity-50 ${selectedId === member.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
        onClick={() => onSelect(member.id)}>
        {member.kind !== 'native' ? <Paperclip className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <FileText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 break-words"><span className="font-medium">{index + 1}. {packageDocumentName(revision, member)}</span><span className="block text-xs text-muted-foreground">{memberKind(member)}</span></span>
      </button></div>)}
    </div>
  </nav>;
}

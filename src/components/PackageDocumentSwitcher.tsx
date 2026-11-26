import { useMemo } from 'react';
import { packageNavigationNames } from '@/lib/packageNavigationNames';
import { type PackageRevision } from '@/lib/actionPackages';

interface Props {
  revision: PackageRevision;
  history?: readonly PackageRevision[];
  memberId: string;
  disabled: boolean;
  onSelect(memberId: string): void;
}

export function PackageDocumentSwitcher({ revision, history, memberId, disabled, onSelect }: Props) {
  const names = useMemo(() => packageNavigationNames(revision, history), [revision, history]);
  return <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm">
    Package document
    <select aria-label="Package document" className="min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5"
      value={memberId} disabled={disabled} onChange={event => onSelect(event.target.value)}>
      {revision.members.map((member, index) =>
        <option key={member.id} value={member.id}>{index + 1}. {names.get(member.id)}</option>)}
    </select>
  </label>;
}

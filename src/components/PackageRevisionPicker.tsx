import { useState } from 'react';
import type { MemberRevisionSource, RevisionSourceOption } from '@/lib/packageRevisionSources';

interface Props {
  label: string;
  sources: RevisionSourceOption[];
  value?: MemberRevisionSource;
  disabled: boolean;
  onSelect(source: RevisionSourceOption): void;
}

export function PackageRevisionPicker({ label, sources, value, disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  return <details className="text-sm" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer">Use a document already in this package</summary>
    {open && <label className="mt-2 block">Saved version
      <select aria-label={`Saved version for ${label}`} className="mt-1 w-full min-w-0 rounded border bg-background p-2"
        disabled={disabled} value={value ? JSON.stringify([value.memberId, value.revisionId]) : ''}
        onChange={event => {
          const selected = sources.find(source => source.key === event.target.value);
          if (selected) onSelect(selected);
        }}>
        <option value="" disabled>Choose a saved version</option>
        {sources.map(source => <option key={source.key} value={source.key}>{source.label}</option>)}
      </select>
    </label>}
  </details>;
}

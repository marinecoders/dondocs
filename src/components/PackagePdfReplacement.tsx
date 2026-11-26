import { useState } from 'react';
import type { PackageMember } from '@/lib/actionPackages';
import { Button } from './ui/button';

export function PackagePdfReplacement({ member, disabled, onReplace }: {
  member: Extract<PackageMember, { kind: 'original' }>; disabled: boolean; onReplace(file: File, signed: boolean): void;
}) {
  const [file, setFile] = useState<File>();
  const [signed, setSigned] = useState(false);
  return <div className="space-y-2 text-sm">
    <label className="inline-block cursor-pointer rounded border px-3 py-2 focus-within:ring-2">
      Replace PDF in this slot
      <input data-replacement-input className="sr-only" type="file" accept="application/pdf,.pdf" disabled={disabled} onChange={event => {
        setFile(event.target.files?.[0]); setSigned(false); event.target.value = '';
      }} />
    </label>
    {file && <fieldset disabled={disabled} className="space-y-2">
      <p>Replace <strong>{member.original.name}</strong> with <strong>{file.name}</strong>? The previous PDF stays in version history.</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={signed} onChange={event => setSigned(event.target.checked)} />Incoming PDF is signed</label>
      <div className="flex gap-2"><Button size="sm" onClick={() => onReplace(file, signed)}>Replace PDF</Button>
        <Button size="sm" variant="ghost" onClick={() => setFile(undefined)}>Cancel</Button></div>
    </fieldset>}
  </div>;
}

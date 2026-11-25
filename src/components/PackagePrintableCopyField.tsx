import { useState } from 'react';
import type { PackageMember } from '@/lib/actionPackages';
import { Button } from './ui/button';
import { PackagePdfCompatibility } from './PackagePdfCompatibility';

export function PackagePrintableCopyField({ member, editable, disabled, onChange }: {
  member: Extract<PackageMember, { kind: 'original' }>; editable: boolean; disabled: boolean;
  onChange(file: File | null): void;
}) {
  const [file, setFile] = useState<File>();
  const copy = member.printableCopy?.asset;
  return <section className="space-y-2 text-sm" aria-label="Printable PDF">
    {copy ? <p>Combined PDF uses <strong>{copy.name}</strong>. The original is {member.original.name}.</p>
      : <PackagePdfCompatibility source={member.original} />}
    {editable && <details><summary className="cursor-pointer">{copy ? 'Manage printable copy' : 'Add printable copy'}</summary>
      <fieldset disabled={disabled} className="mt-2 space-y-2">
        <label className="block">Printable PDF for {member.original.name}
          <input className="mt-1 block" type="file" accept=".pdf,application/pdf" onChange={event => {
            setFile(event.target.files?.[0]); event.target.value = '';
          }} />
        </label>
        {file && <><p>Confirm that {file.name} shows all pages and completed fields from this original.</p>
          <Button size="sm" onClick={() => onChange(file)}>Use reviewed printable copy</Button></>}
        {copy && <Button size="sm" variant="outline" onClick={() => onChange(null)}>Remove printable copy</Button>}
      </fieldset></details>}
  </section>;
}

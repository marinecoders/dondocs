import { useState } from 'react';
import type { PackageMember } from '@/lib/actionPackages';
import { officialFormMappings, type SharedMarineDetail } from '@/lib/officialFormFieldLinks';
import type { PackageFact } from '@/lib/packageInformation';
import { Button } from './ui/button';

interface Props {
  members: PackageMember[];
  facts: ReadonlyArray<Pick<PackageFact, 'id' | 'kind' | 'label'>>;
  disabled: boolean;
  onLink(memberIds: string[], detail: SharedMarineDetail, factId?: string): void;
}

export function OfficialFormLinks({ members, facts, disabled, onLink }: Props) {
  const [value, setValue] = useState('new:name');
  const [selected, setSelected] = useState<string[]>([]);
  const forms = members.map((member, index) => ({ member, index })).filter(({ member }) => officialFormMappings(member));
  if (!forms.length) return null;
  const fact = facts.find(item => 'fact:' + item.id === value);
  const detail = value === 'new:edipi' || fact?.kind === 'identifier' ? 'edipi' : 'name';
  const ids = forms.filter(({ member }) => selected.includes(member.id)).map(({ member }) => member.id);
  return <details className="rounded border p-3">
    <summary className="cursor-pointer text-sm font-medium">Share Marine details across forms</summary>
    <fieldset disabled={disabled} className="mt-3 space-y-3 text-sm">
      <label className="block">Shared value
        <select aria-label="Official form shared value" className="mt-1 block w-full rounded border bg-background p-2"
          value={value} onChange={event => setValue(event.target.value)}>
          <option value="new:name">New Marine name</option>
          <option value="new:edipi">New Marine EDIPI</option>
          {facts.filter(f => f.kind === 'text' || f.kind === 'identifier').map(f =>
            <option key={f.id} value={'fact:' + f.id}>Use {f.label || 'unnamed value'} as {f.kind === 'identifier' ? 'EDIPI' : 'Marine name'}</option>)}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">{detail === 'name'
        ? 'Use commas between the last, first and optional middle name. Spaces within a name are preserved.'
        : 'Enter all ten digits, including leading zeros.'}</p>
      <fieldset className="space-y-1"><legend>Forms for this Marine</legend>
        {forms.map(({ member, index }) => <label key={member.id} className="flex items-center gap-2">
          <input type="checkbox" checked={selected.includes(member.id)} onChange={event => setSelected(event.target.checked
            ? [...selected, member.id] : selected.filter(id => id !== member.id))} />{index + 1}. {member.label}
        </label>)}
      </fieldset>
      <Button size="sm" variant="outline" disabled={!ids.length || (!value.startsWith('new:') && !fact)}
        onClick={() => onLink(ids, detail, fact?.id)}>Link selected forms</Button>
    </fieldset>
  </details>;
}

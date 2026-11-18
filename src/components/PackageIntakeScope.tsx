import { useState } from 'react';
import { Button } from './ui/button';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';

const operationLabel = { review: 'Review', pdf: 'Combined PDF', portable: 'Editable handoff' };

/** Declarations describe possible content, separately from the saved package's computed readiness. */
export function PackageIntakeScope({ template }: { template: PackageTemplateV2 }) {
  const [count, setCount] = useState(25);
  return <details className="min-w-0 rounded border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Document scope and requirements</summary>
    <div className="space-y-3 pt-3">
      <p className="text-xs text-muted-foreground">These are the template's declarations. The reviewed preview determines which documents change; the saved requirements show which operations are available.</p>
      <ul className="space-y-2">{template.members.slice(0, count).map((member, index) => {
        const group = template.program.participantGroups.find(group => group.id === member.repeatGroupId);
        return <li key={member.key} className="min-w-0">
          <p className="break-words font-medium">{index + 1}. {member.label}</p>
          <p className="break-words text-xs text-muted-foreground">{member.kind === 'attachment' ? 'Original PDF slot' : member.draft.documentCategory === 'forms' ? 'Editable worksheet' : 'Editable correspondence'}
            {' · '}{member.required ? 'Required member' : 'Optional member'}{member.when ? ' · Conditional' : ''}{group ? ` · Per person in ${group.label}` : ''}</p>
        </li>;
      })}</ul>
      {template.program.requirements.length > 0 && <div className="space-y-2"><h4 className="font-medium">Declared operation requirements</h4>
        <ul className="space-y-1">{template.program.requirements.slice(0, count).map(requirement => <li key={requirement.id} className="break-words">
          {requirement.label} · {requirement.operations.map(operation => operationLabel[operation]).join(', ')}{requirement.when ? ' · Conditional' : ''}
        </li>)}</ul>
      </div>}
      {(template.members.length > count || template.program.requirements.length > count) && <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" onClick={() => setCount(value => value + 25)}>Show more declarations</Button>}
    </div>
  </details>;
}

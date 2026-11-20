import { Checkbox } from '@/components/ui/checkbox';

import { PROOFREAD_MANUAL_CHECKS } from '@/lib/proofreadChecklist';

export function ProofreadManualChecklist({ checked, onCheckedChange }: {
  checked: readonly string[];
  onCheckedChange: (id: string, checked: boolean) => void;
}) {
  return <section aria-labelledby="proofread-manual-title" className="mt-6 border-t pt-5">
    <h3 id="proofread-manual-title" className="text-sm font-semibold">Manual review</h3>
    <p className="mt-1 text-xs text-muted-foreground">Start with format, then review language and content. These session checks apply to this draft and clear when it changes.</p>
    <p className="mt-2 text-xs font-medium" aria-live="polite">{checked.length} of {PROOFREAD_MANUAL_CHECKS.length} personal checks completed</p>
    {(['Framework', 'Language', 'Content'] as const).map(group => <fieldset key={group} className="mt-4 space-y-3">
      <legend className="mb-2 text-xs font-medium text-muted-foreground">{group}</legend>
      {PROOFREAD_MANUAL_CHECKS.filter(item => item.group === group).map(item => <label key={item.id} className="flex cursor-pointer items-start gap-3 text-sm leading-5">
        <Checkbox checked={checked.includes(item.id)} className="mt-0.5 shrink-0" onCheckedChange={value => onCheckedChange(item.id, value === true)} />
        <span>{item.label}</span>
      </label>)}
    </fieldset>)}
    <p className="mt-4 text-xs text-muted-foreground">Source: SECNAV M-5216.5, Chapter 2, paragraph 19. Apply the layout requirements of the selected document type.</p>
  </section>;
}

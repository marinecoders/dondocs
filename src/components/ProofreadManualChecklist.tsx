import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import { PROOFREAD_MANUAL_CHECKS } from '@/lib/proofreadChecklist';

export function ProofreadManualChecklist({ checked, onCheckedChange, onViewSource }: {
  checked: readonly string[];
  onViewSource?: () => void;
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
    {onViewSource && <Button variant="link" className="mt-3 h-auto min-h-10 whitespace-normal px-0 text-left text-xs" onClick={onViewSource}>Read the manual checklist · Ch 2 ¶19</Button>}
    <p className="mt-4 text-xs text-muted-foreground">Source: SECNAV M-5216.5, Chapter 2, paragraph 19. Apply the layout requirements of the selected document type.</p>
  </section>;
}

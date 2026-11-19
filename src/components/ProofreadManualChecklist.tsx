import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import type { ProofreadSource } from '@/lib/proofread';

/** Source-based personal checks: SECNAV M-5216.5 (June 2015, Ch 1 2018),
 * Chapter 2 paragraph 19b(1–11), 19c(1–3), and 19d. Rendered-page questions
 * remain human checks; matching editor values cannot establish their result. */
export const PROOFREAD_MANUAL_CHECKS = [
  { id: 'letterhead', group: 'Framework', label: 'Inspect the letterhead and its alignment.' },
  { id: 'margins', group: 'Framework', label: 'Check the rendered page margins.' },
  { id: 'page-numbers', group: 'Framework', label: 'Check page-number placement and sequence.' },
  { id: 'date-space', group: 'Framework', label: 'Check the space reserved for the date.' },
  { id: 'paragraph-alignment', group: 'Framework', label: 'Inspect paragraph alignment and indentation.' },
  { id: 'paragraph-sequence', group: 'Framework', label: 'Check paragraph numbering and lettering.' },
  { id: 'enclosure-markings', group: 'Framework', label: 'Inspect enclosure markings on the actual pages.' },
  { id: 'line-hyphenation', group: 'Framework', label: 'Inspect successive hyphenated lines and excessive line-end hyphenation.' },
  { id: 'signature-space', group: 'Framework', label: 'Check the space reserved for signatures.' },
  { id: 'header-margin', group: 'Framework', label: 'Inspect the header position.' },
  { id: 'footer-margin', group: 'Framework', label: 'Inspect the footer position.' },
  { id: 'word-review', group: 'Language', label: 'Read slowly and inspect each word, punctuation and spacing.' },
  { id: 'uncertain-words', group: 'Language', label: 'Look up uncertain spelling and hyphenated words.' },
  { id: 'spelling-tools', group: 'Language', label: 'Use spelling and grammar tools alongside your own review.' },
  { id: 'content', group: 'Content', label: 'Read for meaning, accuracy and completeness.' },
] as const;

export function ProofreadManualChecklist({ source, owner }: { source: ProofreadSource; owner: string }) {
  const [saved, setSaved] = useState<{ source: ProofreadSource; owner: string; checked: readonly string[] } | null>(null);
  // Derived scope avoids one painted frame of confirmations from an older draft.
  const checked = saved?.source === source && saved.owner === owner ? saved.checked : [];
  return <section aria-labelledby="proofread-manual-title" className="mt-6 border-t pt-5">
    <h3 id="proofread-manual-title" className="text-sm font-semibold">Manual review</h3>
    <p className="mt-1 text-xs text-muted-foreground">Start with format, then review language and content. These session checks apply to this draft and clear when it changes.</p>
    <p className="mt-2 text-xs font-medium" aria-live="polite">{checked.length} of {PROOFREAD_MANUAL_CHECKS.length} personal checks completed</p>
    {(['Framework', 'Language', 'Content'] as const).map(group => <fieldset key={group} className="mt-4 space-y-3">
      <legend className="mb-2 text-xs font-medium text-muted-foreground">{group}</legend>
      {PROOFREAD_MANUAL_CHECKS.filter(item => item.group === group).map(item => <label key={item.id} className="flex cursor-pointer items-start gap-3 text-sm leading-5">
        <Checkbox checked={checked.includes(item.id)} className="mt-0.5 shrink-0" onCheckedChange={value => {
          setSaved({ source, owner, checked: value === true ? [...checked.filter(id => id !== item.id), item.id] : checked.filter(id => id !== item.id) });
        }} />
        <span>{item.label}</span>
      </label>)}
    </fieldset>)}
    <p className="mt-4 text-xs text-muted-foreground">Source: SECNAV M-5216.5, Chapter 2, paragraph 19. Apply the layout requirements of the selected document type.</p>
  </section>;
}

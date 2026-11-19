import { useState } from 'react';
import type { ProofreadSource } from '@/lib/proofread';

/** Keep session checks across dialog closes, but never across draft changes. */
export function useProofreadManualChecklist(source: ProofreadSource, owner: string) {
  const [saved, setSaved] = useState<{ source: ProofreadSource; owner: string; checked: readonly string[] } | null>(null);
  // Derived scope prevents a painted frame of confirmations from an older draft.
  const checked = saved?.source === source && saved.owner === owner ? saved.checked : [];
  const onCheckedChange = (id: string, value: boolean) => {
    setSaved({ source, owner, checked: value ? [...checked.filter(item => item !== id), id] : checked.filter(item => item !== id) });
  };
  return { checked, onCheckedChange };
}

import { ClipboardCheck } from 'lucide-react';
import { useProofreadFindings } from '@/hooks/useProofreadFindings';
import { useUIStore } from '@/stores/uiStore';
import { Button } from './ui/button';

export function ProofreadButton() {
  const findings = useProofreadFindings();
  const open = useUIStore(s => s.setProofreadOpen);
  return <Button variant="ghost" size="sm" className="h-11 gap-1.5 px-2 text-xs sm:h-8" onClick={event => { event.currentTarget.focus({ preventScroll: true });open(true); }}
    aria-label={`Proofread: ${findings.length} finding${findings.length === 1 ? '' : 's'}`}>
    <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />Proofread
    <span className="rounded-full bg-muted px-1.5 text-2xs tabular-nums" aria-hidden="true">{findings.length}</span>
  </Button>;
}

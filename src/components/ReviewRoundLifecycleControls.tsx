import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { reviewRoundStatus, type ReviewRound } from '@/lib/reviewRounds';
import type { ReviewRoundTransition } from '@/lib/reviewRoundLifecycle';

interface Props {
  round: ReviewRound;
  rounds: ReviewRound[];
  owner: boolean;
  disabled: boolean;
  onTransition: (transition: ReviewRoundTransition, replacementId?: string) => void;
}

export function ReviewRoundLifecycleControls({ round, rounds, owner, disabled, onTransition }: Props) {
  const [replacement, setReplacement] = useState('');
  const status = reviewRoundStatus(round);
  const event = round.lifecycle?.events.at(-1);
  const replacements = rounds.filter(candidate => candidate.ownerDocumentId === round.ownerDocumentId
    && candidate.createdAt > round.createdAt && reviewRoundStatus(candidate) === 'active');
  const selected = replacements.some(candidate => candidate.id === replacement) ? replacement : '';
  return <div className="space-y-2 text-sm">
    <p>Round status: {status}{event?.replacementRoundId
      ? ` · Replaced by ${rounds.find(candidate => candidate.id === event.replacementRoundId)?.label ?? 'an unavailable retained round'}` : ''}</p>
    {!owner && <p className="text-xs text-muted-foreground">Status describes the received copy; it is not a live status or authenticated decision from its sender.</p>}
    {owner && status !== 'superseded' && <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={disabled}
        onClick={() => onTransition(status === 'closed' ? 'reopen' : 'close')}>
        {status === 'closed' ? 'Reopen review' : 'Close review'}
      </Button>
      {status === 'active' && <div className="w-full space-y-1">
        <Label htmlFor={`replacement-${round.id}`}>Replacement for {round.label}</Label>
        <select id={`replacement-${round.id}`} value={selected} disabled={disabled || !replacements.length}
          className="w-full rounded-md border bg-background p-2" onChange={event => setReplacement(event.target.value)}>
          <option value="">Choose a newer active round</option>
          {replacements.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
        </select>
        <Button size="sm" variant="outline" disabled={disabled || !selected}
          onClick={() => onTransition('supersede', selected)}>Supersede review</Button>
      </div>}
    </div>}
    {round.lifecycle && <details><summary>Round state history ({round.lifecycle.events.length})</summary>
      <ol className="space-y-1 pl-4">{round.lifecycle.events.map(item => <li key={item.id}>
        {item.state} · {new Date(item.changedAt).toLocaleString()}
      </li>)}</ol>
    </details>}
  </div>;
}

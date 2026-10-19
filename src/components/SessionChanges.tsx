import { useMemo } from 'react';
import { diffSessions } from '@/lib/sessionDiff';
import { compareText, type TextSegment } from '@/lib/textChanges';
import type { SerializedSession } from '@/stores/documentStore';

function MarkedText({ segments, side }: { segments: TextSegment[]; side: 'before' | 'after' }) {
  return segments.map((segment, index) => !segment.changed ? segment.text : side === 'before'
    ? <del key={index} className="bg-destructive/10 [text-decoration-color:var(--destructive-text,var(--destructive))] decoration-2">{segment.text}</del>
    : <ins key={index} className="bg-success/15 decoration-success decoration-2 underline-offset-2">{segment.text}</ins>);
}

export function SessionChanges({ before, after, highlightText = false }: {
  before: SerializedSession;
  after: SerializedSession;
  highlightText?: boolean;
}) {
  const changes = useMemo(() => diffSessions(before, after).map(change => ({
    ...change,
    segments: highlightText ? compareText(change.before, change.after) : null,
  })), [before, after, highlightText]);

  return <div className="min-w-0 space-y-3">
    <p className="text-sm text-muted-foreground">{changes.length
      ? `${changes.length} changed ${changes.length === 1 ? 'field' : 'fields'}.`
      : 'No content differences.'}</p>
    {highlightText && changes.length > 0 && <p className="text-xs text-muted-foreground">Restoring removes struck-through text and adds underlined text.</p>}
    {changes.map(change => <section key={change.field} className="min-w-0 rounded-md border border-border overflow-hidden">
      <h3 className="break-words bg-muted px-3 py-2 text-xs font-medium">{change.field}</h3>
      <div className="grid sm:grid-cols-2 text-sm">
        <div className="min-w-0 p-3 border-b sm:border-b-0 sm:border-r border-border"><span className="text-xs text-muted-foreground">Current</span><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{change.segments ? <MarkedText segments={change.segments.before} side="before" /> : change.before}</p></div>
        <div className="min-w-0 p-3"><span className="text-xs text-muted-foreground">Selected</span><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{change.segments ? <MarkedText segments={change.segments.after} side="after" /> : change.after}</p></div>
      </div>
    </section>)}
  </div>;
}

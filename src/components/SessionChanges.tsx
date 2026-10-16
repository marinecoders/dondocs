import { diffSessions } from '@/lib/sessionDiff';
import type { SerializedSession } from '@/stores/documentStore';

export function SessionChanges({ before, after }: { before: SerializedSession; after: SerializedSession }) {
  const changes = diffSessions(before, after);
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{changes.length ? `${changes.length} changed fields. Current content is on the left; the selected version is on the right.` : 'No content differences.'}</p>
    {changes.map((change) => <section key={change.field} className="rounded-md border border-border overflow-hidden">
      <h3 className="bg-muted px-3 py-2 text-xs font-medium">{change.field}</h3>
      <div className="grid sm:grid-cols-2 text-sm">
        <div className="p-3 border-b sm:border-b-0 sm:border-r border-border"><span className="text-xs text-muted-foreground">Current</span><p className="whitespace-pre-wrap break-words">{change.before}</p></div>
        <div className="p-3"><span className="text-xs text-muted-foreground">Selected</span><p className="whitespace-pre-wrap break-words">{change.after}</p></div>
      </div>
    </section>)}
  </div>;
}

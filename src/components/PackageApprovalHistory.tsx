import type { ApprovalRoute } from '@/lib/packageApprovalClient';

const actionLabels: Record<ApprovalRoute['history'][number]['action'], string> = {
  request: 'Requested approval', approve: 'Approved', return: 'Returned for corrections',
  delegate: 'Delegated', cancel: 'Canceled',
};

export function PackageApprovalHistory({ route }: { route: ApprovalRoute }) {
  return <details className="min-w-0 rounded border p-2">
    <summary className="cursor-pointer font-medium">Approval history ({route.sequence})</summary>
    <p className="mt-2 text-xs text-muted-foreground">The approval service supplies these identities and timestamps for the selected PDF. Keep a downloaded copy with the saved package for reference.</p>
    <ol className="mt-2 space-y-2">
      {route.history.map(event => <li key={event.sequence} className="rounded border p-2">
        <p className="break-words">{actionLabels[event.action]} · <strong>{event.actorId}</strong>
          {'stage' in event && ` · Stage ${event.stage}`}{event.action === 'delegate' && ` · Assigned to ${event.assignee}`}</p>
        <time dateTime={event.occurredAt} className="text-xs">{new Date(event.occurredAt).toLocaleString()}</time>
        {event.action === 'request' && <ol className="ml-5 list-decimal break-words text-xs">
          {event.assignments.map((item, index) => <li key={index}>{item.assignee}{item.dueAt && ` · Due ${new Date(item.dueAt).toLocaleString()}`}</li>)}
        </ol>}
        <p className="break-all text-xs text-muted-foreground">Certificate SHA-256 {event.certificateFingerprint}</p>
      </li>)}
    </ol>
  </details>;
}

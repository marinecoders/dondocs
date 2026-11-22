import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { readPackageAsset } from '@/lib/actionPackageAssets';
import { reservePackageApprovalRequest } from '@/lib/packageApprovalRequests';
import type { PackageRevision } from '@/lib/actionPackages';
import {
  approvalRouteId, assertApprovalBinding, createPackageApprovalClient,
  type ApprovalAssignment, type ApprovalRoute, type ApprovalSession,
} from '@/lib/packageApprovalClient';

const fieldClass = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';

export function PackageApprovalPanel({ packageId, revision, origin, canStart, disabled }: {
  packageId: string; revision: PackageRevision; origin: string; canStart: boolean; disabled: boolean;
}) {
  const [session, setSession] = useState<ApprovalSession>();
  const [route, setRoute] = useState<ApprovalRoute>();
  const [outputId, setOutputId] = useState(revision.outputs[0]?.id ?? '');
  const [lookup, setLookup] = useState('');
  const [stages, setStages] = useState<Array<{ assignee: string; dueAt: string }>>([{ assignee: '', dueAt: '' }]);
  const [replacement, setReplacement] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<AbortController>(null);
  const output = revision.outputs.find(item => item.id === outputId);
  const client = createPackageApprovalClient(origin);

  useEffect(() => () => { operation.current?.abort(); }, []);

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (operation.current || disabled) return;
    const owner = new AbortController();
    operation.current = owner;
    setBusy(true);
    setError('');
    try {
      await work(owner.signal);
    } catch (cause) {
      if (!owner.signal.aborted) setError(cause instanceof Error ? cause.message : 'The approval request failed.');
    } finally {
      if (operation.current === owner) operation.current = null;
      if (!owner.signal.aborted) setBusy(false);
    }
  }

  function binding() {
    if (!output) throw new Error('Choose a retained PDF for this saved revision.');
    return { packageId, revisionId: revision.id, artifactSha256: output.asset.sha256 };
  }

  function showRoute(result: ApprovalRoute, expectedId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (result.id !== expectedId.toLowerCase()) throw new Error('The approval service returned a different route.');
    assertApprovalBinding(result, binding());
    setRoute(result);
    setReviewed(false);
    setReplacement('');
  }

  async function start(signal: AbortSignal) {
    if (!reviewed || !output || !canStart || !session?.canRequest) throw new Error('Review the exact saved PDF before requesting approval.');
    const exact = binding();
    const assignments: ApprovalAssignment[] = stages.map(item => ({
      assignee: item.assignee.trim(),
      ...(item.dueAt ? { dueAt: new Date(item.dueAt).toISOString() } : {}),
    }));
    await readPackageAsset(output.asset);
    signal.throwIfAborted();
    const id = await reservePackageApprovalRequest(origin, session.id, exact, assignments);
    signal.throwIfAborted();
    setLookup(id);
    showRoute(await client.start(id, exact, assignments, signal), id, signal);
  }

  async function read(signal: AbortSignal) {
    const id = lookup.trim();
    if (!approvalRouteId.safeParse(id).success) throw new Error('Enter the approval route UUID.');
    setRoute(undefined);
    showRoute(await client.read(id, signal), id, signal);
  }

  async function act(action: 'approve' | 'return' | 'delegate' | 'cancel', signal: AbortSignal) {
    if (!route || !output) return;
    const expected = binding();
    assertApprovalBinding(route, expected);
    const expectedSequence = route.sequence;
    const decision = action === 'approve' || action === 'return';
    if (decision) {
      if (!reviewed) throw new Error('Review the exact saved PDF before deciding.');
      await readPackageAsset(output.asset);
      signal.throwIfAborted();
    }
    setRoute(undefined);
    showRoute(await client.act(route.id, decision ? { action, expectedSequence, artifactSha256: expected.artifactSha256 }
      : action === 'delegate' ? { action, expectedSequence, assignee: replacement.trim() } : { action, expectedSequence }, signal), route.id, signal);
  }

  const requester = route?.history[0].actorId;
  const mayManage = route?.status === 'pending' && requester === session?.id && session?.canRequest;
  const mayDecide = route?.status === 'pending' && route.activeAssignment?.assignee === session?.id && session?.canApprove;
  return <section aria-label="Authenticated approvals" className="min-w-0 space-y-3 text-sm" aria-busy={busy}>
    <p>Route an exact saved PDF through your organization’s approval service. The service receives revision identifiers, the PDF checksum and assignments. Share the PDF and route ID through your approved channel. A participant who needs to open the route on another device also needs the editable package for this saved revision.</p>
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    {!session ? <Button disabled={busy || disabled} className={buttonClass} onClick={() => void run(async signal => {
      const actor = await client.session(signal);
      signal.throwIfAborted();
      setSession(actor);
    })}>Connect to approval service</Button> : <fieldset disabled={busy || disabled} className="min-w-0 space-y-3">
      <p role="status">Authenticated as <strong>{session.id}</strong></p>
      <label className="block">Saved PDF
        <select className={fieldClass} value={outputId} onChange={event => {
          setOutputId(event.target.value); setRoute(undefined); setReviewed(false); setError('');
        }}>
          {!revision.outputs.length && <option value="">No saved PDF in this revision</option>}
          {revision.outputs.map((item, index) => <option key={item.id} value={item.id}>Saved PDF {index + 1} · {new Date(item.createdAt).toLocaleString()}</option>)}
        </select>
      </label>
      {output && <>
        <p className="break-all text-xs">Revision {revision.id} · SHA-256 {output.asset.sha256}</p>
        <label className="block">Approval route ID
          <input className={fieldClass} maxLength={36} value={lookup} onChange={event => {
            setLookup(event.target.value); setRoute(undefined); setReviewed(false); setError('');
          }} />
        </label>
        <Button variant="outline" className={buttonClass} disabled={!lookup.trim()} onClick={() => void run(read)}>Read approval route</Button>
        {route ? <div className="space-y-2 rounded border p-3">
          <p role="status">Approval status <strong>{route.status}</strong></p>
          {route.activeAssignment && <p>Stage {route.activeAssignment.stage} · {route.activeAssignment.assignee}{route.activeAssignment.dueAt ? ` · Due ${new Date(route.activeAssignment.dueAt).toLocaleString()}` : ''}</p>}
          {mayManage && <div className="space-y-2">
            <label className="block">New assignee
              <input className={fieldClass} maxLength={100} value={replacement} onChange={event => setReplacement(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className={buttonClass} disabled={!replacement.trim()} onClick={() => void run(signal => act('delegate', signal))}>Delegate current stage</Button>
              <Button variant="outline" className={buttonClass} onClick={() => void run(signal => act('cancel', signal))}>Cancel approval route</Button>
            </div>
          </div>}
        </div> : session.canRequest && canStart && <div className="space-y-3 rounded border p-3">
          <h4 className="font-medium">Request approval</h4>
          {stages.map((item, index) => <div key={index} className="grid gap-2 sm:grid-cols-2">
            <label>Stage {index + 1} approver
              <input className={fieldClass} maxLength={100} value={item.assignee} onChange={event => setStages(current => current.map((stage, at) => at === index ? { ...stage, assignee: event.target.value } : stage))} />
            </label>
            <label>Stage {index + 1} due date (local time)
              <input className={fieldClass} type="datetime-local" value={item.dueAt} onChange={event => setStages(current => current.map((stage, at) => at === index ? { ...stage, dueAt: event.target.value } : stage))} />
            </label>
          </div>)}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className={buttonClass} disabled={stages.length === 12} onClick={() => setStages(current => [...current, { assignee: '', dueAt: '' }])}>Add stage</Button>
            {stages.length > 1 && <Button variant="outline" className={buttonClass} onClick={() => setStages(current => current.slice(0, -1))}>Remove last stage</Button>}
          </div>
        </div>}
        {(mayDecide || !route && session.canRequest && canStart) && <label className="flex items-start gap-2">
          <input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />
          I reviewed this exact saved PDF in Delivery.
        </label>}
        {mayDecide && <div className="flex flex-wrap gap-2">
          <Button className={buttonClass} disabled={!reviewed} onClick={() => void run(signal => act('approve', signal))}>Approve stage</Button>
          <Button variant="outline" className={buttonClass} disabled={!reviewed} onClick={() => void run(signal => act('return', signal))}>Return for corrections</Button>
        </div>}
        {!route && session.canRequest && canStart && <Button className={buttonClass} disabled={!reviewed || stages.some(item => !item.assignee.trim())} onClick={() => void run(start)}>Request approval</Button>}
      </>}
    </fieldset>}
  </section>;
}

import { z } from 'zod';
import { approvalServiceOrigin } from './packageApprovalOrigin';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const approvalRouteId = z.uuid({ version: 'v4' });
const assignment = z.object({ assignee: id, dueAt: z.iso.datetime().optional() });
const assignmentsSchema = z.array(assignment).min(1).max(12);
const revision = z.object({ packageId: id, revisionId: id, artifactSha256: sha256 });
const session = z.object({ id, canRequest: z.boolean(), canApprove: z.boolean() });
const sequence = z.number().int().positive().max(213);
const event = {
  routeId: approvalRouteId, sequence, actorId: id, occurredAt: z.iso.datetime(),
  certificateFingerprint: z.string().regex(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/),
};
const stage = z.number().int().min(1).max(12);
const historyEvent = z.discriminatedUnion('action', [
  z.object({ ...event, action: z.literal('request'), revision, assignments: z.array(assignment).min(1).max(12) }),
  z.object({ ...event, action: z.literal('approve'), stage, artifactSha256: sha256 }),
  z.object({ ...event, action: z.literal('return'), stage, artifactSha256: sha256 }),
  z.object({ ...event, action: z.literal('delegate'), stage, assignee: id }),
  z.object({ ...event, action: z.literal('cancel'), stage }),
]);
const route = z.object({
  id: approvalRouteId, revision, status: z.enum(['pending', 'approved', 'returned', 'cancelled']), sequence,
  activeAssignment: assignment.extend({ stage }).nullable(),
  history: z.array(historyEvent).min(1).max(213),
}).refine(value => {
  const [request, ...events] = value.history;
  if (request?.action !== 'request' || !request.assignments.length || value.history.length !== value.sequence
    || request.revision.packageId !== value.revision.packageId || request.revision.revisionId !== value.revision.revisionId
    || request.revision.artifactSha256 !== value.revision.artifactSha256
    || request.assignments.some(item => item.assignee === request.actorId)
    || value.history.some((entry, index) => entry.sequence !== index + 1 || entry.routeId !== value.id)) return false;

  let status: 'pending' | 'approved' | 'returned' | 'cancelled' = 'pending';
  let stage = 0;
  let assignee = request.assignments[stage].assignee;
  for (const entry of events) {
    if (status !== 'pending' || entry.action === 'request' || entry.stage !== stage + 1) return false;
    if (entry.action === 'delegate' || entry.action === 'cancel') {
      if (entry.actorId !== request.actorId) return false;
      if (entry.action === 'cancel') {
        status = 'cancelled';
      } else {
        if (entry.assignee === request.actorId || entry.assignee === assignee) return false;
        assignee = entry.assignee;
      }
    } else {
      if (entry.actorId !== assignee || entry.artifactSha256 !== value.revision.artifactSha256) return false;
      if (entry.action === 'return') {
        status = 'returned';
      } else if (++stage === request.assignments.length) {
        status = 'approved';
      } else {
        assignee = request.assignments[stage].assignee;
      }
    }
  }

  if (value.status !== status) return false;
  const active = value.activeAssignment;
  return status === 'pending'
    ? active?.stage === stage + 1 && active.assignee === assignee && active.dueAt === request.assignments[stage].dueAt
    : active === null;
});

export type ApprovalBinding = z.infer<typeof revision>;
export type ApprovalRoute = z.infer<typeof route>;
export type ApprovalSession = z.infer<typeof session>;
export type ApprovalAssignment = z.infer<typeof assignment>;
type ApprovalAction =
  | { action: 'approve' | 'return'; expectedSequence: number; artifactSha256: string }
  | { action: 'delegate'; expectedSequence: number; assignee: string }
  | { action: 'cancel'; expectedSequence: number };

export { approvalServiceOrigin } from './packageApprovalOrigin';

export function assertApprovalBinding(route: ApprovalRoute, expected: ApprovalBinding): void {
  const actual = route.revision;
  if (actual.packageId !== expected.packageId || actual.revisionId !== expected.revisionId
    || actual.artifactSha256 !== expected.artifactSha256) {
    throw new Error('This route belongs to a different saved package revision or PDF.');
  }
}

export function createPackageApprovalClient(origin: string, send = fetch) {
  if (approvalServiceOrigin(origin) !== origin) throw new Error('Configure an exact HTTPS approval service origin.');
  async function request<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T> {
    const response = await send(new URL(path, origin), {
      signal, credentials: 'include', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const parsed = z.object({ error: z.string().max(300) }).safeParse(payload);
      throw new Error(parsed.success ? parsed.data.error : 'The approval service refused the request.');
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new Error('The approval service returned an invalid result.');
    return parsed.data;
  }
  const routePath = (id: string) => `/approvals/${approvalRouteId.parse(id).toLowerCase()}`;
  return {
    session: (signal: AbortSignal) => request('/approvals/session', session, signal),
    start: (id: string, binding: ApprovalBinding, assignments: ApprovalAssignment[], signal: AbortSignal) =>
      request('/approvals', route, signal, { requestId: approvalRouteId.parse(id), revision: revision.parse(binding), assignments: assignmentsSchema.parse(assignments) }),
    read: (id: string, signal: AbortSignal) => request(routePath(id), route, signal),
    act: (id: string, action: ApprovalAction, signal: AbortSignal) => request(routePath(id), route, signal, action),
  };
}

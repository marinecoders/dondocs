import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export class ApprovalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const dueAt = z.iso.datetime().optional();
const revisionSchema = z.object({ packageId: id, revisionId: id, artifactSha256: digest }).strict();
const assignmentSchema = z.object({ assignee: id, dueAt }).strict();
export const startSchema = z.object({
  requestId: z.uuid({ version: 'v4' }).toLowerCase(),
  revision: revisionSchema,
  assignments: z.array(assignmentSchema).min(1).max(12),
}).strict();
const common = { expectedSequence: z.number().int().positive().max(213) };
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('approve'), artifactSha256: digest }).strict(),
  z.object({ ...common, action: z.literal('return'), artifactSha256: digest }).strict(),
  z.object({ ...common, action: z.literal('delegate'), assignee: id }).strict(),
  z.object({ ...common, action: z.literal('cancel') }).strict(),
]);
export const actorSchema = z.object({
  id,
  fingerprint256: z.string().regex(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/),
  canRequest: z.boolean(),
  canApprove: z.boolean(),
}).strict();

function routeSnapshot(events) {
  const first = events[0];
  const { revision, assignments } = first;
  const participants = new Set([first.actorId, ...assignments.map(item => item.assignee)]);
  let stage = 0;
  let assignee = assignments[0].assignee;
  let status = 'pending';
  for (const event of events.slice(1)) {
    switch (event.action) {
      case 'approve':
        stage++;
        if (stage === assignments.length) status = 'approved';
        else assignee = assignments[stage].assignee;
        break;
      case 'delegate':
        assignee = event.assignee;
        participants.add(assignee);
        break;
      case 'return':
        status = 'returned';
        break;
      case 'cancel':
        status = 'cancelled';
        break;
    }
  }
  return {
    participants,
    snapshot: { id: first.routeId, revision, status, sequence: events.length,
      activeAssignment: status === 'pending' ? { ...assignments[stage], assignee, stage: stage + 1 } : null,
      history: events },
  };
}

export function openJournal(filename, actors) {
  const directory = new Map(z.array(actorSchema).min(1).max(500).parse(actors).map(actor => [actor.id, actor]));
  if (directory.size !== actors.length || new Set(actors.map(actor => actor.fingerprint256)).size !== actors.length) {
    throw new Error('Each configured identity and certificate fingerprint must be unique.');
  }
  const certificateOwners = new Map([...directory.values()].map(actor => [actor.fingerprint256, actor.id]));
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS approval_event (
      route_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event TEXT NOT NULL,
      PRIMARY KEY (route_id, sequence)
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS approval_event_no_update
      BEFORE UPDATE ON approval_event BEGIN SELECT RAISE(ABORT, 'Approval history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS approval_event_no_delete
      BEFORE DELETE ON approval_event BEGIN SELECT RAISE(ABORT, 'Approval history is append-only'); END;
  `);
  const select = db.prepare('SELECT event FROM approval_event WHERE route_id = ? ORDER BY sequence');
  const selectRequest = db.prepare('SELECT event FROM approval_event WHERE route_id = ? AND sequence = 1');
  const insert = db.prepare('INSERT INTO approval_event (route_id, sequence, event) VALUES (?, ?, ?)');
  function requireActor(actorId) {
    const actor = directory.get(actorId);
    if (!actor) throw new ApprovalError(403, 'This identity is not provisioned.');
    return actor;
  }
  function requireAssignee(assignee, requester) {
    if (assignee === requester || !directory.get(assignee)?.canApprove) {
      throw new ApprovalError(422, 'Choose a provisioned approver other than the requester.');
    }
  }
  function read(actorId, routeId) {
    requireActor(actorId);
    const events = select.all(routeId).map(row => JSON.parse(row.event));
    if (!events.length) throw new ApprovalError(404, 'Approval route not found.');
    const { participants, snapshot } = routeSnapshot(events);
    if (!participants.has(actorId)) throw new ApprovalError(404, 'Approval route not found.');
    return snapshot;
  }
  function append(routeId, sequence, actor, details) {
    insert.run(routeId, sequence, JSON.stringify({
      routeId, sequence, actorId: actor.id, certificateFingerprint: actor.fingerprint256,
      occurredAt: new Date().toISOString(), ...details,
    }));
  }
  function start(actorId, input) {
    const actor = requireActor(actorId);
    if (!actor.canRequest) throw new ApprovalError(403, 'This identity cannot request approval.');
    const { requestId: routeId, revision, assignments } = startSchema.parse(input);
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = selectRequest.get(routeId);
      if (existing) {
        const first = JSON.parse(existing.event);
        if (first.actorId !== actorId || !isDeepStrictEqual(first.revision, revision)
          || !isDeepStrictEqual(first.assignments, assignments)) {
          throw new ApprovalError(409, 'The request ID is already in use.');
        }
      } else {
        for (const { assignee } of assignments) requireAssignee(assignee, actorId);
        append(routeId, 1, actor, { action: 'request', revision, assignments });
      }
      const route = read(actorId, routeId);
      db.exec('COMMIT');
      return route;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function act(actorId, routeId, input) {
    const actor = requireActor(actorId);
    const { expectedSequence, action, ...details } = actionSchema.parse(input);
    db.exec('BEGIN IMMEDIATE');
    try {
      const route = read(actorId, routeId);
      if (route.sequence !== expectedSequence || route.status !== 'pending') {
        throw new ApprovalError(409, 'The route changed. Read its current state before acting.');
      }
      const requester = route.history[0].actorId;
      if (action === 'cancel' || action === 'delegate') {
        if (actorId !== requester || !actor.canRequest) throw new ApprovalError(403, 'Only the requester can change the assignment.');
        if (action === 'delegate') {
          requireAssignee(details.assignee, requester);
          if (details.assignee === route.activeAssignment.assignee) throw new ApprovalError(422, 'Choose a different assignee.');
          if (route.sequence >= 200) throw new ApprovalError(409, 'The route reached its assignment limit.');
        }
      } else {
        if (actorId !== route.activeAssignment.assignee || !actor.canApprove) throw new ApprovalError(403, 'Only the assigned approver can decide this stage.');
        if (details.artifactSha256 !== route.revision.artifactSha256) {
          throw new ApprovalError(409, 'The reviewed artifact differs from the requested revision.');
        }
      }
      append(routeId, route.sequence + 1, actor, { action, stage: route.activeAssignment.stage, ...details });
      const updated = read(actorId, routeId);
      db.exec('COMMIT');
      return updated;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return { start, read, act, close: () => db.close(), actorForCertificate: fingerprint => certificateOwners.get(fingerprint) };
}

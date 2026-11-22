import { describe, expect, it, vi } from 'vitest';
import { approvalServiceOrigin, assertApprovalBinding, createPackageApprovalClient } from '@/lib/packageApprovalClient';

const origin = 'https://approvals.example.test:7713';
const id = '3aac77c5-245c-4c3a-8d37-6e855022a6ac';
const revision = { packageId: 'package_one', revisionId: 'revision_one', artifactSha256: 'a'.repeat(64) };
const fingerprint = Array.from({ length: 32 }, () => 'AA').join(':');
const request = { routeId: id, sequence: 1, actorId: 'drafter', certificateFingerprint: fingerprint,
  occurredAt: '2026-11-22T06:00:00Z', action: 'request', revision, assignments: [{ assignee: 'chief' }] };
const approval = { routeId: id, sequence: 2, actorId: 'chief', certificateFingerprint: fingerprint,
  occurredAt: '2026-11-22T07:00:00Z', action: 'approve', stage: 1, artifactSha256: revision.artifactSha256 };
const response = { id, revision, status: 'approved', sequence: 2, activeAssignment: null, history: [request, approval] };
const signal = new AbortController().signal;

describe('package approval client', () => {
  it('uses a configured HTTPS origin, credentialed requests and refuses redirects', async () => {
    for (const bad of ['http://example.test', 'https://example.test/', 'https://example.test/other', 'https://user:password@example.test']) {
      expect(approvalServiceOrigin(bad)).toBeNull();
    }
    const send = vi.fn().mockResolvedValue(Response.json(response));
    const client = createPackageApprovalClient(origin, send);
    await client.start(id, revision, [{ assignee: 'chief' }], signal);
    const [url, options] = send.mock.calls[0];
    expect(String(url)).toBe(`${origin}/approvals`);
    expect(options).toMatchObject({ credentials: 'include', redirect: 'error', cache: 'no-store', signal,
      headers: { 'Content-Type': 'text/plain' } });
    expect(JSON.parse(options.body)).toEqual({ requestId: id, revision, assignments: [{ assignee: 'chief' }] });
  });

  it('checks history sequence, identity evidence and the exact artifact binding', async () => {
    const send = vi.fn().mockResolvedValueOnce(Response.json(response));
    const client = createPackageApprovalClient(origin, send);
    const route = await client.read(id, signal);
    expect(route.history).toEqual([request, approval]);
    expect(() => assertApprovalBinding(route, { ...revision, revisionId: 'different' })).toThrow('different saved package revision or PDF');
    for (const conflicting of [
      { sequence: 3 }, { certificateFingerprint: 'not-a-fingerprint' }, { artifactSha256: 'b'.repeat(64) },
    ]) {
      send.mockResolvedValueOnce(Response.json({ ...response, history: [request, { ...approval, ...conflicting }] }));
      await expect(client.read(id, signal)).rejects.toThrow('invalid result');
    }
  });
  it('replays delegation and stage advancement to verify the current state', async () => {
    const dueAt = '2026-11-29T18:00:00Z';
    const assigned = { ...request, assignments: [{ assignee: 'chief' }, { assignee: 'officer', dueAt }] };
    const delegation = { ...approval, action: 'delegate', actorId: request.actorId, assignee: 'deputy' };
    const deputyApproval = { ...approval, sequence: 3, actorId: 'deputy' };
    const pending = { ...response, status: 'pending', sequence: 3,
      history: [assigned, delegation, deputyApproval], activeAssignment: { stage: 2, assignee: 'officer', dueAt } };
    const send = vi.fn().mockResolvedValueOnce(Response.json(pending));
    const client = createPackageApprovalClient(origin, send);
    expect((await client.read(id, signal)).activeAssignment).toEqual(pending.activeAssignment);
    for (const invalid of [
      { ...response, sequence: 1, history: [request] },
      { ...response, sequence: 0, history: [] },
      { ...response, sequence: 1, history: [{ ...request, assignments: [] }] },
      { ...response, history: [request, { ...approval, actorId: 'unassigned' }] },
      { ...pending, activeAssignment: { stage: 1, assignee: 'chief' } },
      { ...pending, history: [assigned, { ...delegation, actorId: 'officer' }, deputyApproval] },
      { ...response, sequence: 3, history: [request, approval, { ...approval, sequence: 3, action: 'return' }] },
    ]) {
      send.mockResolvedValueOnce(Response.json(invalid));
      await expect(client.read(id, signal)).rejects.toThrow('invalid result');
    }
  });
});

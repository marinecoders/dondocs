import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { reservePackageApprovalRequest } from '@/lib/packageApprovalRequests';

const binding = { packageId: 'package', revisionId: 'revision', artifactSha256: 'a'.repeat(64) };
const origin = 'https://approval.example.test';
const initial = [{ assignee: 'chief', dueAt: '2026-12-01T12:00:00.000Z' }];

it('commits one ID before concurrent requesters on the same browser retry it', async () => {
  const reserve = () => reservePackageApprovalRequest(origin, 'drafter', binding, initial);
  const [first, second, third] = await Promise.all([reserve(), reserve(), reserve()]);
  expect([second, third, await reserve()]).toEqual([first, first, first]);
});

it('scopes an ID to the service, actor, exact PDF and ordered assignments', async () => {
  const base = await reservePackageApprovalRequest(origin, 'drafter', binding, initial);
  const separate = await Promise.all([
    reservePackageApprovalRequest('https://other.example.test', 'drafter', binding, initial),
    reservePackageApprovalRequest(origin, 'other-drafter', binding, initial),
    reservePackageApprovalRequest(origin, 'drafter', { ...binding, revisionId: 'changed' }, initial),
    reservePackageApprovalRequest(origin, 'drafter', { ...binding, artifactSha256: 'b'.repeat(64) }, initial),
    reservePackageApprovalRequest(origin, 'drafter', binding, [{ assignee: 'chief' }]),
  ]);
  expect(new Set([base, ...separate]).size).toBe(6);
});

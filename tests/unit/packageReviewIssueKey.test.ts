import { expect, it } from 'vitest';
import { reviewIssueKey } from '@/lib/packageNextActions';
import type { PackageNextAction } from '@/lib/packageNextActions';

it('advances to the next remaining member when inspection indices shift after a fix', () => {
  const finding: PackageNextAction = { id: 'readiness-0', kind: 'inspection', blocking: true, label: 'Fix',
    message: 'Missing recipient', destination: { memberId: 'first', correction: { kind: 'edit', label: 'Add recipient', fieldKey: 'to' } } };
  expect(reviewIssueKey(finding)).toBe(reviewIssueKey({ ...finding, id: 'readiness-3' }));
  expect(reviewIssueKey(finding)).not.toBe(reviewIssueKey({ ...finding, destination: { ...finding.destination, memberId: 'second' } }));
});

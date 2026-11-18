import { beforeEach, expect, it, vi } from 'vitest';
import { PACKAGE_WORKSPACE_CONTEXT_KEY, readPackageWorkspaceContext, rememberPackageWorkspaceContext } from '@/lib/packageWorkspaceContext';

beforeEach(() => { localStorage.removeItem(PACKAGE_WORKSPACE_CONTEXT_KEY); vi.restoreAllMocks(); });

it('retains only bounded package, revision and member navigation identities', () => {
  const context = { version: 1 as const, packageId: 'package-1', revisionId: 'revision-2', memberId: 'member-3', section: 'documents' as const };
  rememberPackageWorkspaceContext(context);
  expect(readPackageWorkspaceContext()).toEqual(context);
  expect(localStorage.getItem(PACKAGE_WORKSPACE_CONTEXT_KEY)).not.toContain('name');
  for (const value of ['not json', JSON.stringify({ ...context, section: 'unsafe' }), JSON.stringify({ ...context, memberId: 'member"selector' }),
    JSON.stringify({ ...context, packageId: 'x'.repeat(101) }), JSON.stringify({ ...context, name: 'Unexpected retained text' }), ' '.repeat(513)]) {
    localStorage.setItem(PACKAGE_WORKSPACE_CONTEXT_KEY, value);
    expect(readPackageWorkspaceContext()).toBeNull();
  }
});

it('leaves blocked preference storage independent of saved package operations', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  expect(readPackageWorkspaceContext()).toBeNull();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  expect(() => rememberPackageWorkspaceContext({ version: 1, packageId: 'p', revisionId: 'r', memberId: null, section: 'overview' })).not.toThrow();
});

import { beforeEach, expect, it, vi } from 'vitest';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
const mocks = vi.hoisted(() => ({ policy: vi.fn(), review: vi.fn(), confirm: vi.fn() }));
vi.mock('@/config/classification', () => ({ getExportDeploymentPolicy: mocks.policy }));
vi.mock('@/lib/signingDisclosure', () => ({ reviewSigningDisclosure: mocks.review }));
vi.mock('@/stores/alertStore', () => ({ showAppConfirm: mocks.confirm }));
import { confirmSigningDisclosure } from '@/components/signingDisclosure';

const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
beforeEach(() => {
  vi.clearAllMocks();mocks.policy.mockResolvedValue(policy);mocks.confirm.mockResolvedValue(true);
  mocks.review.mockResolvedValue({ privacy: { found: false, findings: [] }, notices: [] });
});
it('resolves fresh policy before review and checks it again before delivery', async () => {
  await confirmSigningDisclosure({ pdfs: [] }, () => true);
  expect(mocks.policy).toHaveBeenCalledTimes(2);expect(mocks.policy).toHaveBeenCalledWith(undefined, true);expect(mocks.confirm).not.toHaveBeenCalled();
});
it('requires explicit privacy review and reserves PDF windows again after the reviewing gesture', async () => {
  mocks.review.mockResolvedValue({ privacy: { found: true, findings: [{ type: 'SSN', field: 'Original.pdf', value: '123-45-6789' }] }, notices: [] });
  const onPrivacyReview = vi.fn(), onPrivacyApproved = vi.fn();
  await confirmSigningDisclosure({ pdfs: [] }, () => true, { onPrivacyReview, onPrivacyApproved });
  expect(onPrivacyReview).toHaveBeenCalledOnce();expect(onPrivacyApproved).toHaveBeenCalledOnce();
  expect(mocks.confirm.mock.calls[0][0].message).not.toContain('123-45-6789');
  mocks.confirm.mockResolvedValue(false);
  await expect(confirmSigningDisclosure({ pdfs: [] }, () => true)).rejects.toThrow('cancelled');
});
it('blocks delivery when policy or workspace ownership changes during review', async () => {
  mocks.policy.mockResolvedValueOnce(policy).mockResolvedValueOnce(resolveExportDeploymentPolicy({ hostname: 'other.test', environment: null, runtime: { status: 'absent' } }));
  await expect(confirmSigningDisclosure({ pdfs: [] }, () => true)).rejects.toThrow('policy changed');
  await expect(confirmSigningDisclosure({ pdfs: [] }, () => false)).rejects.toThrow('cancelled');
});

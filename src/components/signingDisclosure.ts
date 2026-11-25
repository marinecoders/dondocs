import { getExportDeploymentPolicy } from '@/config/classification';
import { reviewSigningDisclosure, type SigningDisclosureInput } from '@/lib/signingDisclosure';
import { getPIITypeLabel } from '@/services/pii/detector';
import { showAppConfirm } from '@/stores/alertStore';

/** Resolve current policy again for each external signing delivery. */
export async function confirmSigningDisclosure(input: SigningDisclosureInput, isCurrent: () => boolean,
  callbacks: { action?: 'sign' | 'inspect'; onPrivacyReview?(): void; onPrivacyApproved?(): void } = {}): Promise<void> {
  const policy = await getExportDeploymentPolicy(undefined, true);
  const review = await reviewSigningDisclosure(input, policy, isCurrent);
  if (review.privacy.found) {
    callbacks.onPrivacyReview?.();
    const fields = [...new Set(review.privacy.findings.map(finding => `${getPIITypeLabel(finding.type)} in ${finding.field}`))];
    if (!await showAppConfirm({ title: 'Review signing export', message: `Potential personal information was found:\n\n${fields.slice(0, 20).join('\n')}\n\nReview these documents and their markings before downloading. Text inspection cannot read scanned images.`, confirmLabel: callbacks.action === 'sign' ? 'Continue to signing' : callbacks.action === 'inspect' ? 'Inspect reviewed PDF' : 'Download reviewed signing files' })) {
      throw new Error('The signing download was cancelled.');
    }
    if (!isCurrent()) throw new Error('The signing delivery was cancelled.');
    callbacks.onPrivacyApproved?.();
  }
  if (!isCurrent()) throw new Error('The signing delivery was cancelled.');
  const current = await getExportDeploymentPolicy(undefined, true);
  if (!isCurrent()) throw new Error('The signing delivery was cancelled.');
  if (policy.status !== 'ready' || current.status !== 'ready' || current.policy.identity !== policy.policy.identity) throw new Error('The deployment policy changed. Review the signing download again.');
}

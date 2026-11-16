import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageReviewApplicationPanel } from '@/components/PackageReviewApplicationPanel';
import { createActionPackage, getPackageRevision, reviseActionPackage, listActionPackages } from '@/lib/actionPackages';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { createPackageMemberReview, savePackageMemberReview } from '@/lib/packageMemberReviews';
import { appendReviewSuggestions, createReviewSuggestion } from '@/lib/reviewSuggestions';
import { buildPackageReviewReturn, packageReviewTransferFile } from '@/lib/packageReviewTransfer';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
const { currentPolicy } = vi.hoisted(() => ({ currentPolicy: { value: undefined as unknown } }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy.value,
  getExportDeploymentPolicySync: () => currentPolicy.value }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });

it('discards an accepted resolution when the package reviewer switches to rejection', async () => {
  currentPolicy.value = policy;
  const session = createBlankSession(); session.formData.subject = 'SYNTHETIC BASELINE';
  session.paragraphs = [{ id: 'decision-choice-body', text: 'Retained native body.', level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'decision-choice-source', epoch: 0, editSequence: 0, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), 'Synthetic choice member', 'basic-letter');
  let owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Synthetic decision choice'), [native]));
  const round = owner.reviewRounds![0], child = await createPackageMemberReview(round, native.id);
  const proposal = createReviewSuggestion(child.nativeRound!, { author: 'Synthetic reviewer', label: 'Synthetic subject replacement', changes: [{ target: { kind: 'field', field: 'subject', docType: native.session.docType }, proposed: 'SYNTHETIC RETURNED SUBJECT' }] });
  owner = await savePackageMemberReview(owner, round.id, { ...child, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [proposal]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, round.id, policy), policy);
  session.formData.subject = 'SYNTHETIC CURRENT SUBJECT';
  const updated = await capturePackageMember(captureDocumentRevision({ documentId: 'decision-choice-source', epoch: 0, editSequence: 1, capturedAt: 200 }, { ...session, endItems: [], publicationTables: {} }), native.label, native.role, native);
  const latest = await reviseActionPackage(owner, [updated]), user = userEvent.setup();
  render(<PackageReviewApplicationPanel record={latest} round={round} busy={false} signal={() => undefined} isCurrent={() => true}
    onApply={vi.fn()} run={async action => { await action(); }} />);
  await user.upload(screen.getByLabelText('Import package feedback return'), new File([json], 'synthetic-choice-return.json', { type: 'application/json' }));
  await screen.findByText('Latest saved content: SYNTHETIC CURRENT SUBJECT');
  await user.selectOptions(screen.getByLabelText(`Discussion decision ${native.label}`), 'skip');
  await user.selectOptions(screen.getByLabelText(`Proposal decision ${proposal.label}`), 'accepted');
  await user.type(screen.getByLabelText(`Resolved replacement ${proposal.changes[0].id}`), 'SYNTHETIC DELIBERATE RESOLUTION');
  expect(screen.getByRole('button', { name: 'Review new package revision' })).toBeEnabled();
  await user.selectOptions(screen.getByLabelText(`Proposal decision ${proposal.label}`), 'rejected');
  expect(screen.getByRole('button', { name: 'Review new package revision' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Review new package revision' }));
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the baseline/ }));
  await user.click(screen.getByRole('button', { name: 'Apply feedback as new package revision' }));
  await waitFor(async () => {
    const saved = (await listActionPackages()).find(item => item.id === owner.id)!;
    expect(saved.revisions).toHaveLength(latest.revisions.length + 1);
    expect(getPackageRevision(saved).members[0]).toEqual(updated);
    expect(saved.reviewApplications![0].outcomes[0].suggestions!.decisions[0]).toMatchObject({ action: 'rejected' });
    expect(saved.reviewApplications![0].outcomes[0].suggestions!.decisions[0].resolutions).toBeUndefined();
  });
});

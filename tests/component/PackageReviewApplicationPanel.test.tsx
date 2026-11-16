import 'fake-indexeddb/auto';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageReviewApplicationPanel } from '@/components/PackageReviewApplicationPanel';
import { createActionPackage, getPackageRevision, reviseActionPackage, listActionPackages, type ActionPackage } from '@/lib/actionPackages';
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
function View({ initial }: { initial: ActionPackage }) {
  const [record, setRecord] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <><p role="status">{error}</p><PackageReviewApplicationPanel key={record.sequence} record={record} round={record.reviewRounds![0]} busy={busy}
    signal={() => undefined} isCurrent={() => true} onApply={setRecord} run={async action => { setBusy(true); try { await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }} /></>;
}
it('shows exact conflict context, requires explicit choices and applies one revision; policy failure invalidates the displayed plan safely', async () => {
  currentPolicy.value = policy;
  const session = createBlankSession(); session.formData.subject = 'SYNTHETIC REVIEWED SUBJECT'; session.paragraphs = [{ id: 'application-body', text: 'Synthetic paragraph unchanged.', level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'application-ui-source', epoch: 0, editSequence: 0, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), 'Synthetic reviewed member', 'basic-letter');
  let owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Synthetic application UI'), [native]));
  const round = owner.reviewRounds![0], child = await createPackageMemberReview(round, native.id), proposal = createReviewSuggestion(child.nativeRound!, { author: 'Synthetic reviewer', label: 'Replace reviewed subject', changes: [{ target: { kind: 'field', field: 'subject', docType: native.session.docType }, proposed: 'SYNTHETIC RETURNED SUBJECT' }] });
  owner = await savePackageMemberReview(owner, round.id, { ...child, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [proposal]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, round.id, policy), policy);
  session.formData.subject = 'SYNTHETIC LATEST SUBJECT';
  const updated = await capturePackageMember(captureDocumentRevision({ documentId: 'application-ui-source', epoch: 0, editSequence: 1, capturedAt: 200 }, { ...session, endItems: [], publicationTables: {} }), native.label, native.role, native);
  const latest = await reviseActionPackage(owner, [updated]);
  const user = userEvent.setup(); render(<View initial={latest} />);
  const file = new File([json], 'synthetic-return.json', { type: 'application/json' });
  await user.upload(screen.getByLabelText('Import package feedback return'), file);
  await screen.findByText('Latest saved content: SYNTHETIC LATEST SUBJECT');
  expect(screen.getByText('Reviewed baseline: SYNTHETIC REVIEWED SUBJECT')).toBeVisible(); expect(screen.getByText('Returned proposal: SYNTHETIC RETURNED SUBJECT')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Review new package revision' })).toBeDisabled();
  currentPolicy.value = { status: 'loading', message: 'Synthetic changed deployment policy' };
  await user.selectOptions(screen.getByLabelText(`Discussion decision ${native.label}`), 'merge');
  await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('Synthetic changed deployment policy');
  expect(screen.queryByRole('button', { name: 'Review new package revision' })).toBeNull();
  currentPolicy.value = policy;
  await user.upload(screen.getByLabelText('Import package feedback return'), file); await screen.findByText('Latest saved content: SYNTHETIC LATEST SUBJECT');
  await user.selectOptions(screen.getByLabelText(`Discussion decision ${native.label}`), 'merge');
  await user.selectOptions(screen.getByLabelText(`Proposal decision ${proposal.label}`), 'accepted');
  expect(screen.getByRole('button', { name: 'Review new package revision' })).toBeDisabled();
  await user.type(screen.getByLabelText(`Resolved replacement ${proposal.changes[0].id}`), 'SYNTHETIC DELIBERATE SUBJECT');
  await user.click(screen.getByRole('button', { name: 'Review new package revision' }));
  const apply = await screen.findByRole('button', { name: 'Apply feedback as new package revision' }); expect(apply).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the baseline/ })); await user.click(apply);
  await waitFor(async () => {
    const saved = (await listActionPackages()).find(item => item.id === owner.id)!;
    expect(saved.revisions).toHaveLength(latest.revisions.length + 1); expect(saved.reviewApplications).toHaveLength(1);
    const member = getPackageRevision(saved).members[0]; expect(member.kind === 'native' && member.session.formData.subject).toBe('SYNTHETIC DELIBERATE SUBJECT');
  });
});

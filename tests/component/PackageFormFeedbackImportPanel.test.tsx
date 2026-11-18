import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageFormFeedbackImportPanel } from '@/components/PackageFormFeedbackImportPanel';
import { preparePackageFormFeedbackImport } from '@/lib/packageFormFeedbackImport';
import { addPackageFormComment, capturePackageFormAnchor, packageFormReviewFields } from '@/lib/packageFormReview';
import { packageFormFixture } from '../_helpers/packageFormReviewFixture';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/packageFormFeedbackImport', () => ({ preparePackageFormFeedbackImport: vi.fn(), preparePackagePdfFeedbackImport: vi.fn(), applyPreparedPackageFormFeedbackImport: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('shows category and resolution changes when returned discussion text is identical', async () => {
  const { record, round, member } = await packageFormFixture(), field = (await packageFormReviewFields(member))[0];
  const anchor = await capturePackageFormAnchor(member, field.target);
  const comment = addPackageFormComment(undefined, anchor, 'Alex Example', 'Identical discussion text.', 'required-correction').comments[0];
  const current = { ...comment, resolved: true }, returned = { ...comment, category: 'question' as const };
  vi.mocked(preparePackageFormFeedbackImport).mockResolvedValue({ ready: false, label: member.label, comments: 1, proposals: 0,
    reviews: [], conflicts: [{ id: comment.id, label: anchor.label, current, returned }] });
  const user = userEvent.setup();
  render(<PackageFormFeedbackImportPanel record={record} roundId={round.id} memberId={member.id} busy={false} run={async action => action()} onApply={() => {}} />);
  await user.click(screen.getByText('Collect returned form feedback'));
  await user.upload(screen.getByLabelText('Collect form feedback return'), new File(['{}'], 'return.json', { type: 'application/json' }));
  expect(await screen.findByText('Current: Required correction · Resolved')).toBeVisible();
  expect(screen.getByText('Returned: Question · Open')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: /^I reviewed the returned field feedback/ })).toBeDisabled();
});

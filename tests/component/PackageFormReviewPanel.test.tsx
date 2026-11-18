import 'fake-indexeddb/auto';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageMemberReviewPanel } from '@/components/PackageMemberReviewPanel';
import type { ActionPackage } from '@/lib/actionPackages';
import { listActionPackages } from '@/lib/actionPackages';
import { packageFormFixture } from '../_helpers/packageFormReviewFixture';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
afterEach(cleanup);
function Review({ initial }: { initial: ActionPackage }) {
  const [record, setRecord] = useState(initial);
  return <PackageMemberReviewPanel record={record} round={record.reviewRounds![0]} busy={false} run={async action => action()} onChange={setRecord} />;
}
it('posts a field-specific comment through the real package controller and supports Undo and Redo', async () => {
  const { record, member } = await packageFormFixture(), user = userEvent.setup();
  render(<Review initial={record} />);
  await user.click(screen.getByRole('button', { name: member.label }));
  const panel = await screen.findByRole('region', { name: 'Captured form field feedback' });
  await user.selectOptions(within(panel).getByLabelText('Reviewed form field'), within(panel).getByRole('option', { name: 'Name' }));
  await within(panel).findByText('Reviewed answer: 000123');
  await user.type(within(panel).getByLabelText('Form comment reviewer name'), 'Alex Example');
  await user.type(within(panel).getByLabelText('Form field comment'), 'Confirm the fictional identifier.');
  expect(screen.getByRole('button', { name: member.label })).toBeDisabled();
  await user.click(within(panel).getByRole('button', { name: 'Post form field comment' }));
  await within(panel).findByText('Confirm the fictional identifier.', { exact: false });
  await waitFor(() => expect(within(panel).getByLabelText('Form field comment')).toHaveValue(''));
  let saved = (await listActionPackages()).find(item => item.id === record.id)!;
  expect(saved.reviewRounds![0].memberReviews![0].fieldReview?.comments[0].anchor.context).toBe('000123');
  await user.click(screen.getByRole('button', { name: 'Undo member comment' }));
  await waitFor(() => expect(within(panel).queryByText('Name · Open')).toBeNull());
  await user.click(screen.getByRole('button', { name: 'Redo member comment' }));
  await within(panel).findByText('Name · Open');
  saved = (await listActionPackages()).find(item => item.id === record.id)!;
  expect(saved.revisions).toEqual(record.revisions);
});

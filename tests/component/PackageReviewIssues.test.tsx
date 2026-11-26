import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageReviewIssues } from '@/components/PackageReviewIssues';

it('lists the documents affected by a grouped review decision without repeating the action', async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  const action = {
    id: 'question-evidence', kind: 'intake' as const, label: 'Answer question', message: 'Include evidence?', blocking: true,
    destination: { section: 'documents' as const, panel: 'intake' as const, intakeQuestion: 'evidence' },
    affectedDocuments: ['Statement', 'Evidence cover sheet'],
  };
  render(<PackageReviewIssues disabled={false} onOpen={onOpen} actions={[action]} />);
  await user.click(screen.getByText('Before PDF delivery · 1 issue'));
  await user.click(screen.getByText('Affects 2 documents'));
  expect(screen.getByText('Statement')).toBeVisible();
  expect(screen.getByText('Evidence cover sheet')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Answer question' }));
  expect(onOpen).toHaveBeenCalledWith(action);
});

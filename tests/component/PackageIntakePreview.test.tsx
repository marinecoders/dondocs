import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { PackageIntakePreview } from '@/components/PackageIntakePreview';
import type { PreparedConditionalPackage } from '@/lib/packageConditional';

it('summarizes a removed document without exposing its discarded internal field links', () => {
  const preview: PreparedConditionalPackage = { packageName: 'Training', ready: true, changed: true, reviews: [], issues: [], answerChanges: [],
    changes: [{ key: 'cost', memberId: 'cost-member', label: 'Cost estimate', state: 'remove', message: 'Remove this document; saved history preserves it.' }],
    fieldChanges: [{ bindingId: 'internal-link-id', memberId: 'cost-member', label: 'internal-link-id', state: 'detach', message: 'Link removed.' }] };
  render(<PackageIntakePreview directApply preview={preview} fresh disabled={false} reviewed={false} memberChoices={{}} answerChoices={{}} fieldChoices={{}}
    onMemberChoice={vi.fn()} onAnswerChoice={vi.fn()} onFieldChoice={vi.fn()} onReviewed={vi.fn()} onApply={vi.fn()} />);
  expect(screen.getByText('Cost estimate')).toBeVisible();
  expect(screen.queryByText('internal-link-id')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Linked field changes' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Apply action changes' })).toBeEnabled();
});

it('names decisions for their human owner while retaining exact keys and requiring a new reviewed preview', async () => {
  const onMemberChoice = vi.fn(), onAnswerChoice = vi.fn(), onFieldChoice = vi.fn(), onApply = vi.fn();
  const preview: PreparedConditionalPackage = {
    packageName: 'Training participation', ready: false, changed: true, reviews: [], issues: ['Decide which document to preserve.'],
    changes: [{ key: 'opaque-member-key', label: 'Participants · person 2 · Blair · In-person worksheet', state: 'conflict',
      message: 'This edited document leaves the current branch.', choices: ['keep', 'remove'] }],
    answerChanges: [{ key: 'opaque-answer-key', label: 'Participants · person 2 · Blair · Location', current: 'Current room', requested: 'New room', state: 'conflict' }],
    fieldChanges: [{ bindingId: 'opaque-field-key', memberId: 'member', label: 'Blair · In-person worksheet · Location', before: 'Local room', after: 'New room',
      message: 'A local edit requires a decision.', state: 'conflict', choices: ['keep-local', 'detach'] }],
  };
  const user = userEvent.setup();
  render(<PackageIntakePreview preview={preview} fresh={false} disabled={false} reviewed={false} memberChoices={{}} answerChoices={{}} fieldChoices={{}}
    onMemberChoice={onMemberChoice} onAnswerChoice={onAnswerChoice} onFieldChoice={onFieldChoice} onReviewed={vi.fn()} onApply={onApply} />);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Document decision Participants · person 2 · Blair · In-person worksheet · Document 1' }), 'keep');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Answer decision Participants · person 2 · Blair · Location · Answer 1' }), 'keep-current');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Field decision Blair · In-person worksheet · Location · Link 1' }), 'keep-local');
  const field = screen.getByRole('combobox', { name: /^Field decision/ });
  expect(within(field).queryByRole('option', { name: 'Apply the shared package value' })).toBeNull();
  expect(within(field).getAllByRole('option')).toHaveLength(3);
  expect(onMemberChoice).toHaveBeenCalledWith('opaque-member-key', 'keep');
  expect(onAnswerChoice).toHaveBeenCalledWith('opaque-answer-key', 'keep-current');
  expect(onFieldChoice).toHaveBeenCalledWith('opaque-field-key', 'keep-local');
  expect(screen.getByRole('checkbox', { name: /^I reviewed the intake/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Apply action changes' })).toBeDisabled();
  expect(onApply).not.toHaveBeenCalled();
});

it('collapses routine fills and exposes overwrites on separate copies of a form', () => {
  const fields = ['first', 'second'].map((memberId, index) => ({ memberId, bindingId: memberId, memberLabel: 'Request',
    state: 'update' as const, label: 'Recipient', before: index ? 'Earlier entry' : '', after: 'Updated entry', message: 'Shared value changed.' }));
  const preview: PreparedConditionalPackage = { packageName: 'Custom', ready: true, changed: true, reviews: [], issues: [], changes: [], answerChanges: [], fieldChanges: fields };
  render(<PackageIntakePreview directApply preview={preview} fresh disabled={false} reviewed={false} memberChoices={{}} answerChoices={{}} fieldChoices={{}}
    onMemberChoice={vi.fn()} onAnswerChoice={vi.fn()} onFieldChoice={vi.fn()} onReviewed={vi.fn()} onApply={vi.fn()} />);
  const groups = screen.getAllByText('Request · 1 field').map(summary => summary.closest('details'));
  expect(groups).toHaveLength(2);
  expect(groups[0]).toHaveAttribute('open');
  expect(groups[1]).not.toHaveAttribute('open');
  expect(screen.getByText('Current document: Earlier entry')).toBeVisible();
});

it('shows a late conflict before paginating routine fields', () => {
  const routine = Array.from({ length: 25 }, (_, i) => ({
    bindingId: 'fill-' + i, memberId: 'letter', memberLabel: 'Letter', label: 'Field ' + i,
    state: 'update' as const, before: '', after: 'Example', message: 'Fill field',
  }));
  const preview: PreparedConditionalPackage = { packageName: 'Training', ready: false, changed: true, changes: [], reviews: [], issues: [], answerChanges: [],
    fieldChanges: [...routine, { bindingId: 'conflict', memberId: 'form', memberLabel: 'Form', label: 'Recipient', state: 'conflict', before: 'Local', after: 'New', message: 'Resolve the recipient.' }] };
  render(<PackageIntakePreview directApply preview={preview} fresh disabled={false} reviewed={false} memberChoices={{}} answerChoices={{}} fieldChoices={{}}
    onMemberChoice={vi.fn()} onAnswerChoice={vi.fn()} onFieldChoice={vi.fn()} onReviewed={vi.fn()} onApply={vi.fn()} />);
  expect(screen.getByRole('combobox', { name: /Field decision Recipient/ })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Show more linked fields' })).toBeVisible();
});

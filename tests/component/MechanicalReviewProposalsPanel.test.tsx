import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { MechanicalReviewProposalsPanel } from '@/components/editor/MechanicalReviewProposalsPanel';
import type { ReviewRound } from '@/lib/reviewRounds';
import { getSerializedSession } from '@/stores/documentStore';
import type { ReviewSuggestion } from '@/lib/reviewSuggestions';

function props() {
  const session = getSerializedSession();session.documentCategory = 'correspondence';session.docType = 'naval_letter';
  session.formData = { subject: 'TRAINING EXAMPLE', to: 'Example recipient', date: '13 November 2026', sigFirst: ' A . ' };
  session.paragraphs = [{ id: 'original', text: 'Due 5 Nov 2026 and 06 Dec 2026.', level: 0 }];
  session.references = [{ letter: 'a', title: 'Training source (notal)' }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt: 1, label: 'Training review', sourceDocumentId: 'source', ownerDocumentId: 'source', baselineDigest: 'a'.repeat(64),
    baseline: { ts: 1, session: structuredClone(session) } };
  return { round, busy: false, proposalCount: 0, onCreate: vi.fn<(proposal: ReviewSuggestion) => Promise<boolean>>().mockResolvedValue(true) };
}

it('proposes selected existing findings as one group without applying them to the baseline', async () => {
  const input = props();const original = structuredClone(input.round.baseline);
  render(<MechanicalReviewProposalsPanel {...input} />);
  expect(screen.getByRole('button', { name: 'Propose 3 corrections' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Body date audience for review' })).toHaveValue('');
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for formatting corrections' }), 'Example reviewer');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Body date audience for review' }), 'military');
  await userEvent.click(screen.getByRole('checkbox', { name: 'First name initial' }));
  await userEvent.click(screen.getByRole('button', { name: 'Propose 4 corrections' }));
  expect(input.onCreate).toHaveBeenCalledTimes(1);
  const proposal = input.onCreate.mock.calls[0][0];
  expect(proposal.origin.kind).toBe('mechanical');expect(proposal.changes).toHaveLength(3);
  expect(proposal.changes.find(change => change.target.kind === 'paragraph')).toMatchObject({ target: { kind: 'paragraph', paragraphId: 'original' }, proposed: 'Due 5 November 2026 and 6 December 2026.' });
  expect(proposal.changes.some(change => change.target.kind === 'field' && change.target.field === 'sigFirst')).toBe(false);
  expect(await screen.findByRole('status')).toHaveTextContent('Draft text is unchanged');
  expect(input.round.baseline).toEqual(original);
  expect(screen.getByRole('button', { name: 'Propose 0 corrections' })).toBeDisabled();
});

it('changes the displayed date proposals only after an explicit audience choice', async () => {
  const input = props();render(<MechanicalReviewProposalsPanel {...input} />);
  const audience = screen.getByRole('combobox', { name: 'Body date audience for review' });
  expect(screen.queryByRole('checkbox', { name: 'Paragraph 1, date 1' })).not.toBeInTheDocument();
  await userEvent.selectOptions(audience, 'military');
  const military = screen.getByRole('article', { name: /Paragraph 1, date 1/ });
  expect(military).toHaveTextContent('5 November 2026');
  await userEvent.click(within(military).getByRole('checkbox'));
  await userEvent.selectOptions(audience, 'civilian');
  const civilian = screen.getByRole('article', { name: /Paragraph 1, date 1/ });
  expect(civilian).toHaveTextContent('November 5, 2026');
  expect(within(civilian).getByRole('checkbox')).toBeChecked();
});

it('prevents repeated submissions while saving and reuses the same proposal identity on retry', async () => {
  const input = props();let finish!: (value: boolean) => void;
  input.onCreate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<MechanicalReviewProposalsPanel {...input} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for formatting corrections' }), 'Example');
  const button = screen.getByRole('button', { name: 'Propose 3 corrections' });
  await userEvent.click(button);await userEvent.click(button);
  expect(input.onCreate).toHaveBeenCalledTimes(1);expect(button).toBeDisabled();
  await act(async () => finish(false));
  expect(screen.getByRole('alert')).toHaveTextContent('The proposal was not submitted');
  expect(button).toBeEnabled();await userEvent.click(button);
  expect(input.onCreate).toHaveBeenCalledTimes(2);
  expect(input.onCreate.mock.calls[1][0]).toEqual(input.onCreate.mock.calls[0][0]);
});

it('preserves the selected corrections after a persistence error and announces it', async () => {
  const input = props();input.onCreate.mockRejectedValueOnce(new Error('Storage unavailable. Retry.'));
  render(<MechanicalReviewProposalsPanel {...input} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for formatting corrections' }), 'Example');
  await userEvent.click(screen.getByRole('button', { name: 'Propose 3 corrections' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
  expect(screen.getByRole('checkbox', { name: 'Date' })).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Propose 3 corrections' }));
  expect(input.onCreate.mock.calls[1][0].id).toEqual(input.onCreate.mock.calls[0][0].id);
});

it('does not carry pending success, author or audience choices into a different review round', async () => {
  const input = props();let finish!: (value: boolean) => void;
  input.onCreate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<MechanicalReviewProposalsPanel {...input} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for formatting corrections' }), 'Old reviewer');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Body date audience for review' }), 'military');
  await userEvent.click(screen.getByRole('button', { name: 'Propose 5 corrections' }));
  const next = props();view.rerender(<MechanicalReviewProposalsPanel {...next} />);
  expect(screen.getByRole('textbox', { name: 'Reviewer name for formatting corrections' })).toHaveValue('');
  expect(screen.getByRole('combobox', { name: 'Body date audience for review' })).toHaveValue('');
  await act(async () => finish(true));
  expect(screen.getByRole('status')).toHaveTextContent('');
  expect(screen.getByRole('checkbox', { name: 'Date' })).toBeChecked();
  expect(next.onCreate).not.toHaveBeenCalled();
});

it('leaves ambiguous dates advisory and never makes them selectable', async () => {
  const input = props();input.round.baseline.session.formData.date = '03/04/26';
  input.round.baseline.session.formData.sigFirst = 'A.';input.round.baseline.session.references = [];
  input.round.baseline.session.paragraphs[0].text = 'Due 5 Nov 26.';
  render(<MechanicalReviewProposalsPanel {...input} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for formatting corrections' }), 'Example');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Body date audience for review' }), 'military');
  expect(screen.getAllByText(/manual review required/)).toHaveLength(2);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Propose 0 corrections' })).toBeDisabled();
  expect(input.onCreate).not.toHaveBeenCalled();
});

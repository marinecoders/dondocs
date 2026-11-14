import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReviewSuggestionsPanel } from '@/components/editor/ReviewSuggestionsPanel';
import { createReviewSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision, planReviewSuggestionHistory } from '@/lib/reviewSuggestions';
import { getSerializedSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';

function props() {
  const current = getSerializedSession();current.documentCategory = 'correspondence';current.docType = 'naval_letter';
  current.formData.to = 'Original recipient';current.paragraphs = [{ id: 'paragraph-one', text: 'Original body.', level: 0 }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt: current.timestamp, label: 'Example', sourceDocumentId: 'source', ownerDocumentId: 'source', baselineDigest: 'a'.repeat(64),
    baseline: { ts: current.timestamp, session: structuredClone(current) } };
  return { round, current, state: emptyReviewSuggestionState(round), owner: true, busy: false,
    onCreate: vi.fn().mockResolvedValue(true), onDecide: vi.fn().mockResolvedValue(true) };
}

it('creates an exact field replacement proposal without modifying the baseline or current draft', async () => {
  const input = props();render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for suggestion' }), 'Example reviewer');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), 'field:to');
  const replacement = screen.getByRole('textbox', { name: 'Proposed replacement' });
  expect(replacement).toHaveValue('Original recipient');
  expect(screen.getByRole('button', { name: 'Add suggestion' })).toBeDisabled();
  await userEvent.clear(replacement);await userEvent.type(replacement, 'Proposed recipient');
  await userEvent.click(screen.getByRole('button', { name: 'Add suggestion' }));
  expect(input.onCreate).toHaveBeenCalledWith(expect.objectContaining({ author: 'Example reviewer', changes: [expect.objectContaining({ expected: 'Original recipient', proposed: 'Proposed recipient', target: { kind: 'field', field: 'to', docType: 'naval_letter' } })] }));
  expect(await screen.findByRole('status')).toHaveTextContent('Suggestion submitted');
  expect(input.current.formData.to).toBe('Original recipient');expect(input.round.baseline.session.formData.to).toBe('Original recipient');
});

it('keeps stable paragraph identity when the newer draft has moved it', async () => {
  const input = props();input.current.paragraphs.unshift({ id: 'newer', text: 'Newer body.', level: 0 });
  render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for suggestion' }), 'Example');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), 'paragraph:paragraph-one');
  await userEvent.clear(screen.getByRole('textbox', { name: 'Proposed replacement' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Proposed replacement' }), 'Edited original body.');
  await userEvent.click(screen.getByRole('button', { name: 'Add suggestion' }));
  expect(input.onCreate.mock.calls[0][0].changes[0].target.paragraphId).toBe('paragraph-one');
});

it('shows baseline/current/proposed values and blocks acceptance of an overlapping draft edit', () => {
  const input = props();input.state.proposals.push(createReviewSuggestion(input.round, { author: 'Example', label: 'Recipient', changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Proposed recipient' }] }));
  input.current.formData.to = 'Newer recipient';render(<ReviewSuggestionsPanel {...input} />);
  const comparison = screen.getByRole('region', { name: 'To replacement comparison' });
  expect(comparison).toHaveTextContent('Original recipient');expect(comparison).toHaveTextContent('Newer recipient');expect(comparison).toHaveTextContent('Proposed recipient');
  expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reject suggestion' })).toBeEnabled();
});

it('does not offer source-owner decisions on a received reviewer copy', () => {
  const input = props();input.state.proposals.push(createReviewSuggestion(input.round, { author: 'Example', label: 'Recipient', changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Proposed recipient' }] }));
  render(<ReviewSuggestionsPanel {...input} owner={false} />);
  expect(screen.queryByRole('button', { name: 'Accept suggestion' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject suggestion' })).not.toBeInTheDocument();
});

it('prevents repeated decisions while an owner operation is pending and retains failures for retry', async () => {
  const input = props();input.state.proposals.push(createReviewSuggestion(input.round, { author: 'Example', label: 'Recipient', changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Proposed recipient' }] }));
  let fail!: (error: Error) => void;
  input.onDecide.mockImplementationOnce(() => new Promise<boolean>((_resolve, reject) => { fail = reject; }));
  render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }));
  expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reject suggestion' })).toBeDisabled();
  expect(input.onDecide).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error('Storage unavailable. Retry Save before continuing.')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
  expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeEnabled();
});

it('distinguishes a recorded Undo from later manual changes to an accepted replacement', () => {
  const input = props();const proposal = createReviewSuggestion(input.round, { author: 'Example', label: 'Recipient', changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Proposed recipient' }] });
  input.state.proposals.push(proposal);
  const accepted = planReviewSuggestionDecision(input.round, input.current, input.state, proposal.id, 'accepted');
  const changed = structuredClone(accepted.session);changed.formData.to = 'Manual recipient';
  const view = render(<ReviewSuggestionsPanel {...input} state={accepted.state} current={changed} />);
  expect(screen.getByText(/Accepted earlier; current draft text has changed/)).toBeVisible();
  const undone = planReviewSuggestionHistory(input.round, accepted.session, input.current, accepted.state, accepted.state.decisions[0].id, 'undo');
  view.rerender(<ReviewSuggestionsPanel {...input} state={undone} />);
  expect(screen.getByText(/Acceptance undone/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeEnabled();
});

it('keeps new replacement input when the prior submission announcement is delayed', async () => {
  const frames: FrameRequestCallback[] = [];
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback);return frames.length; });
  try {
    const input = props();render(<ReviewSuggestionsPanel {...input} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for suggestion' }), 'Example reviewer');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), 'field:to');
    const first = screen.getByRole('textbox', { name: 'Proposed replacement' });
    await userEvent.clear(first);await userEvent.type(first, 'Reviewed recipient');
    await userEvent.click(screen.getByRole('button', { name: 'Add suggestion' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Suggestion submitted');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), 'paragraph:paragraph-one');
    const next = screen.getByRole('textbox', { name: 'Proposed replacement' }) as HTMLTextAreaElement;
    await userEvent.click(next);next.setSelectionRange(0, next.value.length);
    await act(async () => { for (const callback of frames.splice(0)) callback(1); });
    expect.soft(next).toHaveFocus();
    await userEvent.keyboard('Next paragraph correction.');
    expect(next).toHaveValue('Next paragraph correction.');
  } finally { raf.mockRestore(); }
});


it('announces repeated immediate successes once per submission and decision', async () => {
  const input = props();const view = render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for suggestion' }), 'Example reviewer');
  for (const target of ['field:to', 'paragraph:paragraph-one']) {
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), target);
    const replacement = screen.getByRole('textbox', { name: 'Proposed replacement' });
    await userEvent.clear(replacement);await userEvent.type(replacement, 'Review replacement.');
    const submit = screen.getByRole('button', { name: 'Add suggestion' });
    await act(async () => { submit.focus();fireEvent.submit(submit.closest('form')!); });
    expect(screen.getByRole('status')).toHaveFocus();
  }
  expect(input.onCreate).toHaveBeenCalledTimes(2);view.unmount();
  for (const field of ['to', 'subject']) input.state.proposals.push(createReviewSuggestion(input.round, { author: 'Reviewer', label: field,
    changes: [{ target: { kind: 'field', field, docType: 'naval_letter' }, proposed: `Reviewed ${field}` }] }));
  render(<ReviewSuggestionsPanel {...input} />);
  for (const button of screen.getAllByRole('button', { name: 'Accept suggestion' })) {
    await act(async () => { button.focus();fireEvent.click(button); });
    expect(screen.getByRole('status')).toHaveFocus();
  }
  expect(input.onDecide).toHaveBeenCalledTimes(2);
});

it('keeps the composer disabled until its submitted proposal finishes and does not focus after unmount', async () => {
  const input = props();let finish!: (value: boolean) => void;
  input.onCreate.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const view = render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for suggestion' }), 'Example reviewer');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), 'field:to');
  const replacement = screen.getByRole('textbox', { name: 'Proposed replacement' });
  await userEvent.clear(replacement);await userEvent.type(replacement, 'Submitted replacement.');
  await userEvent.click(screen.getByRole('button', { name: 'Add suggestion' }));
  await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
  expect(screen.getByRole('combobox', { name: 'Suggestion target' })).toBeDisabled();expect(replacement).toBeDisabled();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), 'paragraph:paragraph-one');
  await userEvent.type(replacement, 'Unsubmitted input');
  expect(replacement).toHaveValue('Submitted replacement.');
  view.unmount();const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  try { await act(async () => finish(true));expect(focus).not.toHaveBeenCalled(); }
  finally { focus.mockRestore(); }
});

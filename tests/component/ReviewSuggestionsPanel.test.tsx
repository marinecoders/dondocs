import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  expect(await screen.findByRole('status', { name: 'Suggestion submission status' })).toHaveTextContent('Suggestion submitted');
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

it('distinguishes comparison landmarks for multiple reviewers replacing the same target', () => {
  const input = props();
  for (const author of ['Reviewer One', 'Reviewer Two']) input.state.proposals.push(createReviewSuggestion(input.round, { author, label: 'Recipient', changes: [
    { target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: `${author} recipient` },
  ] }));
  render(<ReviewSuggestionsPanel {...input} />);
  expect(screen.getByRole('region', { name: 'To replacement comparison, suggestion 1' })).toHaveTextContent('Reviewer One recipient');
  expect(screen.getByRole('region', { name: 'To replacement comparison, suggestion 2' })).toHaveTextContent('Reviewer Two recipient');
});

it('previews independent changes, permits deliberate combined text and cancels without a decision', async () => {
  const input = props();input.round.baseline.session.paragraphs[0].text = 'Alpha team meets on Friday.';
  input.current.paragraphs[0].text = 'Bravo team meets on Friday.';
  const proposal = createReviewSuggestion(input.round, { author: 'Reviewer', label: 'Meeting', changes: [
    { target: { kind: 'paragraph', paragraphId: 'paragraph-one', docType: 'naval_letter' }, proposed: 'Alpha team meets on Monday.' },
  ] });input.state.proposals.push(proposal);render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.click(screen.getByRole('button', { name: 'Reconcile suggestion' }));
  expect(screen.getByRole('textbox', { name: 'Resolved replacement' })).toHaveValue('Bravo team meets on Monday.');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel reconciliation' }));
  expect(input.onDecide).not.toHaveBeenCalled();expect(screen.queryByRole('textbox', { name: 'Resolved replacement' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reconcile suggestion' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Resolved replacement' }), { target: { value: 'Équipe 👩🏽‍✈️\nCombined meeting.' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply resolution' }));
  expect(input.onDecide).toHaveBeenCalledWith(proposal.id, 'accepted', [{ changeId: proposal.changes[0].id,
    expectedCurrent: 'Bravo team meets on Friday.', value: 'Équipe 👩🏽‍✈️\nCombined meeting.' }]);
  expect(input.current.paragraphs[0].text).toBe('Bravo team meets on Friday.');
});

it('blocks a resolution captured before a newer target edit and requires reopening', async () => {
  const input = props();input.state.proposals.push(createReviewSuggestion(input.round, { author: 'Reviewer', label: 'Recipient', changes: [
    { target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Reviewed recipient' },
  ] }));input.current.formData.to = 'Current recipient';
  const view = render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.click(screen.getByRole('button', { name: 'Reconcile suggestion' }));
  await userEvent.click(screen.getByRole('button', { name: 'Use proposed text' }));
  expect(screen.getByRole('textbox', { name: 'Resolved replacement' })).toHaveValue('Reviewed recipient');
  const current = structuredClone(input.current);current.formData.to = 'Later recipient';view.rerender(<ReviewSuggestionsPanel {...input} current={current} />);
  expect(screen.getByRole('button', { name: 'Apply resolution' })).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('draft changed');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel reconciliation' }));
  await userEvent.click(screen.getByRole('button', { name: 'Reconcile suggestion' }));
  await userEvent.click(screen.getByRole('button', { name: 'Keep current text' }));
  await userEvent.click(screen.getByRole('button', { name: 'Apply resolution' }));
  expect(input.onDecide).toHaveBeenCalledWith(input.state.proposals[0].id, 'accepted', [expect.objectContaining({ expectedCurrent: 'Later recipient', value: 'Later recipient' })]);
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
    expect(await screen.findByRole('status', { name: 'Suggestion submission status' })).toHaveTextContent('Suggestion submitted');
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
    expect(screen.getByRole('status', { name: 'Suggestion submission status' })).toHaveFocus();
  }
  expect(input.onCreate).toHaveBeenCalledTimes(2);view.unmount();
  for (const field of ['to', 'subject']) input.state.proposals.push(createReviewSuggestion(input.round, { author: 'Reviewer', label: field,
    changes: [{ target: { kind: 'field', field, docType: 'naval_letter' }, proposed: `Reviewed ${field}` }] }));
  render(<ReviewSuggestionsPanel {...input} />);
  for (const button of screen.getAllByRole('button', { name: 'Accept suggestion' })) {
    await act(async () => { button.focus();fireEvent.click(button); });
    expect(screen.getByRole('status', { name: 'Suggestion submission status' })).toHaveFocus();
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

it('routes existing formatting findings through the shared proposal and decision callbacks', async () => {
  const input = props();input.round.baseline.session.formData.date = '13 November 2026';
  input.round.baseline.session.paragraphs[0].text = 'Due 5 Nov 2026.';
  input.current = structuredClone(input.round.baseline.session);
  const view = render(<ReviewSuggestionsPanel {...input} />);
  const formatting = screen.getByRole('region', { name: 'Formatting review proposals' });
  await userEvent.type(within(formatting).getByRole('textbox', { name: 'Reviewer name for formatting corrections' }), 'Example reviewer');
  await userEvent.selectOptions(within(formatting).getByRole('combobox', { name: 'Body date audience for review' }), 'military');
  await userEvent.click(within(formatting).getByRole('button', { name: 'Propose 2 corrections' }));
  const proposal = input.onCreate.mock.calls[0][0];
  expect(proposal.origin.kind).toBe('mechanical');expect(proposal.changes).toHaveLength(2);
  input.state.proposals.push(proposal);view.rerender(<ReviewSuggestionsPanel {...input} />);
  const group = screen.getByRole('article', { name: 'Suggestion 1: Formatting corrections (2)' });
  expect(group).toHaveTextContent('All members are checked before any change is applied');
  await userEvent.click(within(group).getByRole('button', { name: 'Accept suggestion' }));
  expect(input.onDecide).toHaveBeenCalledWith(proposal.id, 'accepted');
  expect(input.current.formData.date).toBe('13 November 2026');
});

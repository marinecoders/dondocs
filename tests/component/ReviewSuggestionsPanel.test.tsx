import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReviewSuggestionsPanel } from '@/components/editor/ReviewSuggestionsPanel';
import { appendReviewSuggestions, createParagraphStructureSuggestion, createSelectedTextSuggestion, createReviewSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision, planReviewSuggestionHistory } from '@/lib/reviewSuggestions';
import { getSerializedSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import * as reconciliation from '@/lib/reconcileReviewText';

function props() {
  const current = getSerializedSession();current.documentCategory = 'correspondence';current.docType = 'naval_letter';
  current.formData.to = 'Original recipient';current.paragraphs = [{ id: 'paragraph-one', text: 'Original body.', level: 0 }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt: current.timestamp, label: 'Example', sourceDocumentId: 'source', ownerDocumentId: 'source', baselineDigest: 'a'.repeat(64),
    baseline: { ts: current.timestamp, session: structuredClone(current) } };
  return { round, current, state: emptyReviewSuggestionState(round), owner: true, busy: false,
    onCreate: vi.fn().mockResolvedValue(true), onDecide: vi.fn().mockResolvedValue(true) };
}
it('protects a manual replacement draft until it is submitted or cancelled', async () => {
  const input = props(), onDraftChange = vi.fn(), user = userEvent.setup();
  render(<ReviewSuggestionsPanel {...input} compact onDraftChange={onDraftChange} />);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), 'field:to');
  await user.clear(screen.getByRole('textbox', { name: 'Proposed replacement' }));
  await user.type(screen.getByRole('textbox', { name: 'Proposed replacement' }), 'Unfinished recipient');
  expect(onDraftChange).toHaveBeenLastCalledWith(true);
  await user.click(screen.getByRole('button', { name: 'Cancel replacement' }));
  expect(onDraftChange).toHaveBeenLastCalledWith(false);
  expect(input.onCreate).not.toHaveBeenCalled();
});
it('distinguishes accepted paragraph identities from identical readable move text',()=>{
  const input=props();input.current.paragraphs=[{id:'first',text:'Repeated body.',level:0},{id:'second',text:'Repeated body.',level:0}];
  input.round.baseline.session=structuredClone(input.current);
  const proposal=createParagraphStructureSuggestion(input.round,{author:'Reviewer',operation:{kind:'move-paragraph',paragraphId:'first',destinationId:'second',placement:'after'}});
  input.state.proposals.push(proposal);
  const accepted=planReviewSuggestionDecision(input.round,input.current,input.state,proposal.id,'accepted');
  input.state=accepted.state;
  const view=render(<ReviewSuggestionsPanel {...input} current={accepted.session}/>);
  expect(within(screen.getByRole('article',{name:'Suggestion 1: Move paragraph'})).getByText(/· Accepted$/)).toBeVisible();
  view.rerender(<ReviewSuggestionsPanel {...input}/>);
  expect(screen.getByRole('article',{name:'Suggestion 1: Move paragraph'})).toHaveTextContent('Accepted earlier; current draft text has changed');
});

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
  const comparison = screen.getByRole('region', { name: 'To replacement comparison, suggestion 1' });
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

it('keeps current text as the resolution default when repeated text makes overlap ambiguous', async () => {
  const input = props();input.round.baseline.session.paragraphs[0].text = 'Alpha Alpha team reports.';
  input.current.paragraphs[0].text = 'Alpha team reports.';
  input.state.proposals.push(createReviewSuggestion(input.round, { author: 'Reviewer', label: 'Team', changes: [
    { target: { kind: 'paragraph', paragraphId: 'paragraph-one', docType: 'naval_letter' }, proposed: 'Bravo Alpha team reports.' },
  ] }));
  render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.click(screen.getByRole('button', { name: 'Reconcile suggestion' }));
  expect(screen.getByText(/These edits overlap/)).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Resolved replacement' })).toHaveValue('Alpha team reports.');
  expect(input.onDecide).not.toHaveBeenCalled();
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
  input.state = { ...input.state, proposals: [...input.state.proposals, proposal] };view.rerender(<ReviewSuggestionsPanel {...input} />);
  const group = screen.getByRole('article', { name: 'Suggestion 1: Formatting corrections (2)' });
  expect(group).toHaveTextContent('All members are checked before any change is applied');
  await userEvent.click(within(group).getByRole('button', { name: 'Accept suggestion' }));
  expect(input.onDecide).toHaveBeenCalledWith(proposal.id, 'accepted');
  expect(input.current.formData.date).toBe('13 November 2026');
});

it('creates categorized feedback and filters without renumbering or changing decisions', async () => {
  const input = props();
  const legacy = createReviewSuggestion(input.round, { author: 'Example', label: 'Legacy', changes: [
    { target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Legacy recipient' },
  ] });
  const required = createReviewSuggestion(input.round, { author: 'Example', label: 'Required', category: 'required-correction', changes: [
    { target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Required recipient' },
  ] });
  input.state.proposals.push(legacy, required);
  render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter suggestion category' }), 'required-correction');
  expect(screen.queryByRole('article', { name: 'Suggestion 1: Legacy' })).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'Suggestion 2: Required' })).toHaveTextContent('Reviewer intent');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter suggestion category' }), 'unclassified');
  expect(screen.getByRole('article', { name: 'Suggestion 1: Legacy' })).toBeInTheDocument();
  expect(screen.queryByRole('article', { name: 'Suggestion 2: Required' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for suggestion' }), 'Example reviewer');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion category' }), 'required-correction');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), 'field:to');
  fireEvent.change(screen.getByRole('textbox', { name: 'Proposed replacement' }), { target: { value: 'Categorized recipient' } });
  await userEvent.click(screen.getByRole('button', { name: 'Add suggestion' }));
  expect(input.onCreate).toHaveBeenCalledWith(expect.objectContaining({ category: 'required-correction' }));
  expect(input.onDecide).not.toHaveBeenCalled();
});


it('captures an actual baseline text selection, cancels without submission, then proposes only the selected word', async () => {
  const input = props();const view = render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Reviewer name for suggestion' }), 'Synthetic reviewer');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), 'paragraph:paragraph-one');
  const selectWord = () => {
    const editor = screen.getByRole('textbox', { name: 'Select text in reviewed paragraph' }) as HTMLTextAreaElement;
    editor.setSelectionRange(9, 13);fireEvent.select(editor);
  };
  selectWord();await userEvent.click(screen.getByRole('button', { name: 'Use selected text' }));
  expect(screen.getByRole('region', { name: 'Suggestion baseline value' })).toHaveTextContent('body');
  fireEvent.change(screen.getByRole('textbox', { name: 'Proposed replacement' }), { target: { value: 'text' } });
  await userEvent.click(screen.getByRole('button', { name: 'Cancel replacement' }));
  expect(input.onCreate).not.toHaveBeenCalled();expect(input.onDecide).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Suggestion target' }), 'paragraph:paragraph-one');
  selectWord();await userEvent.click(screen.getByRole('button', { name: 'Use selected text' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Proposed replacement' }), { target: { value: 'text' } });
  await userEvent.click(screen.getByRole('button', { name: 'Add suggestion' }));
  const proposal = input.onCreate.mock.calls[0][0];
  expect(proposal.changes[0]).toMatchObject({ expected: 'body', proposed: 'text', target: { kind: 'range', paragraphId: 'paragraph-one', context: 'Original body.', start: 9, end: 13 } });
  const state = { ...input.state, proposals: [proposal] };
  view.rerender(<ReviewSuggestionsPanel {...input} state={state} />);
  await userEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }));
  expect(input.onDecide).toHaveBeenCalledWith(proposal.id, 'accepted');
  const accepted = planReviewSuggestionDecision(input.round, input.current, state, proposal.id, 'accepted');
  view.rerender(<ReviewSuggestionsPanel {...input} state={accepted.state} current={accepted.session} />);
  expect(screen.getByText(/ · Accepted$/)).toBeVisible();expect(accepted.session.paragraphs[0].text).toBe('Original text.');
  const undone = planReviewSuggestionHistory(input.round, accepted.session, input.current, accepted.state, accepted.state.decisions[0].id, 'undo');
  view.rerender(<ReviewSuggestionsPanel {...input} state={undone} />);
  expect(screen.getByText(/Acceptance undone/)).toBeVisible();expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeEnabled();
});

it('offers scoped reconciliation for changed selected text and hides decisions from reviewer copies', () => {
  const input = props();input.state.proposals.push(createSelectedTextSuggestion(input.round, { author: 'Synthetic reviewer', paragraphId: 'paragraph-one', start: 9, end: 13, proposed: 'text' }));
  input.current.paragraphs[0].text = 'Original work.';
  const view = render(<ReviewSuggestionsPanel {...input} />);
  expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reject suggestion' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Reconcile suggestion' })).toBeEnabled();
  view.rerender(<ReviewSuggestionsPanel {...input} owner={false} />);
  expect(screen.queryByRole('button', { name: 'Accept suggestion' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject suggestion' })).not.toBeInTheDocument();
});


it('gives distinct comparison landmarks to different selected spans in one paragraph', () => {
  const input = props();
  for (const [start, end] of [[0, 8], [9, 13]]) input.state.proposals.push(createSelectedTextSuggestion(input.round,
    { author: 'Synthetic chief', paragraphId: 'paragraph-one', start, end, proposed: 'replacement' }));
  render(<ReviewSuggestionsPanel {...input} />);
  expect(screen.getByRole('region', { name: 'Selected text in paragraph 1 replacement comparison, suggestion 1' })).toHaveTextContent('Original');
  expect(screen.getByRole('region', { name: 'Selected text in paragraph 1 replacement comparison, suggestion 2' })).toHaveTextContent('body');
  const regions = screen.getAllByRole('region').map(element => element.getAttribute('aria-label'));
  expect(new Set(regions).size).toBe(regions.length);
});

it('requires an explicit current scope for an ambiguous repeated range and cancels without deciding', async () => {
  const input = props();input.round.baseline.session.paragraphs[0].text = 'Alpha Alpha end.';input.current.paragraphs[0].text = 'Alpha end.';
  const proposal = createSelectedTextSuggestion(input.round, { author: 'Reviewer', paragraphId: 'paragraph-one', start: 0, end: 5, proposed: 'Bravo' });
  input.state.proposals.push(proposal);render(<ReviewSuggestionsPanel {...input} />);
  expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Reconcile suggestion' }));
  expect(screen.getByText(/current boundaries cannot be mapped safely/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply resolution' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel reconciliation' }));expect(input.onDecide).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Reconcile suggestion' }));
  const current = screen.getByRole('textbox', { name: 'Select current text to resolve' }) as HTMLTextAreaElement;
  current.setSelectionRange(0, 5);fireEvent.select(current);
  await userEvent.click(screen.getByRole('button', { name: 'Use current selection' }));
  expect(screen.getByText('Current selected scope: Alpha')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Use proposed text' }));
  expect(screen.getByRole('textbox', { name: 'Resolved replacement' })).toHaveValue('Bravo');
  await userEvent.click(screen.getByRole('button', { name: 'Apply resolution' }));
  expect(input.onDecide).toHaveBeenCalledWith(proposal.id, 'accepted', [{ changeId: proposal.changes[0].id, expectedCurrent: 'Alpha', value: 'Bravo',
    range: { context: 'Alpha end.', start: 0, end: 5 } }]);
});

it('shows range baseline, current, proposal and resolution, and blocks changes outside the captured current scope', async () => {
  const input = props();input.current.paragraphs[0].text = 'Original work.';
  const proposal = createSelectedTextSuggestion(input.round, { author: 'Reviewer', paragraphId: 'paragraph-one', start: 9, end: 13, proposed: 'text' });
  input.state.proposals.push(proposal);const view = render(<ReviewSuggestionsPanel {...input} />);
  const comparison = screen.getByRole('region', { name: 'Selected text in paragraph 1 replacement comparison, suggestion 1' });
  expect(comparison).toHaveTextContent('body');expect(comparison).toHaveTextContent('work');expect(comparison).toHaveTextContent('text');
  await userEvent.click(screen.getByRole('button', { name: 'Reconcile suggestion' }));
  await userEvent.click(screen.getByRole('button', { name: 'Keep current text' }));
  expect(screen.getByRole('textbox', { name: 'Resolved replacement' })).toHaveValue('work');
  const current = structuredClone(input.current);current.paragraphs[0].text += ' Later outside work.';
  view.rerender(<ReviewSuggestionsPanel {...input} current={current} />);
  expect(screen.getByRole('button', { name: 'Apply resolution' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('draft changed');expect(input.onDecide).not.toHaveBeenCalled();
});

it('does not realign unchanged source text while editing a resolution, but rechecks a new source revision', async () => {
  const input = props();input.current.paragraphs[0].text = 'Original work.';
  input.state.proposals.push(createSelectedTextSuggestion(input.round, { author: 'Reviewer', paragraphId: 'paragraph-one', start: 9, end: 13, proposed: 'text' }));
  const align = vi.spyOn(reconciliation, 'reconcileReviewRange');
  try {
    const view = render(<ReviewSuggestionsPanel {...input} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile suggestion' }));
    align.mockClear();
    fireEvent.change(screen.getByRole('textbox', { name: 'Resolved replacement' }), { target: { value: 'Deliberate combined text' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Reviewer name for suggestion' }), { target: { value: 'Another reviewer' } });
    const scope = screen.getByRole('textbox', { name: 'Select current text to resolve' }) as HTMLTextAreaElement;
    scope.setSelectionRange(9, 13);fireEvent.select(scope);
    expect(screen.getByRole('textbox', { name: 'Resolved replacement' })).toHaveValue('Deliberate combined text');
    expect(align).not.toHaveBeenCalled();

    const current = structuredClone(input.current);current.paragraphs[0].text += ' New outside work.';
    view.rerender(<ReviewSuggestionsPanel {...input} current={current} />);
    expect(align).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply resolution' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('draft changed');
  } finally { align.mockRestore(); }
});

it('refreshes inspections when proposals, decisions or the review round change', () => {
  const input = props(), proposal = createSelectedTextSuggestion(input.round, { author: 'Reviewer', paragraphId: 'paragraph-one', start: 9, end: 13, proposed: 'text' });
  const align = vi.spyOn(reconciliation, 'reconcileReviewRange');
  try {
    const view = render(<ReviewSuggestionsPanel {...input} />);
    const state = { ...input.state, proposals: [proposal] };
    align.mockClear();view.rerender(<ReviewSuggestionsPanel {...input} state={state} />);
    expect(align).toHaveBeenCalled();expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeEnabled();

    const rejected = planReviewSuggestionDecision(input.round, input.current, state, proposal.id, 'rejected');
    align.mockClear();view.rerender(<ReviewSuggestionsPanel {...input} state={rejected.state} />);
    expect(align).toHaveBeenCalled();expect(screen.getByText(/· Rejected$/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).not.toBeInTheDocument();

    align.mockClear();view.rerender(<ReviewSuggestionsPanel {...input} state={rejected.state} round={{ ...input.round, label: 'Refreshed review' }} />);
    expect(align).toHaveBeenCalled();expect(screen.getByText(/· Rejected$/)).toBeVisible();
  } finally { align.mockRestore(); }
});

it('aligns an identical range once per displayed batch and starts fresh for a new source', () => {
  const input = props(), text = 'a'.repeat(450) + ' UNIQUE! ' + 'b'.repeat(450);
  input.round.baseline.session.paragraphs[0].text = text;
  input.current.paragraphs[0].text = 'c' + text.slice(1, 451) + 'ALTERED' + text.slice(458, -1) + 'd';
  const proposals = Array.from({ length: 100 }, () => createSelectedTextSuggestion(input.round, {
    author: 'Reviewer', paragraphId: 'paragraph-one', start: 451, end: 458, proposed: 'distinct',
  }));
  const state = appendReviewSuggestions(input.round, input.state, proposals);
  expect(new Set(proposals.map(proposal => JSON.stringify(proposal.changes[0].target))).size).toBe(1);
  const align = vi.spyOn(reconciliation, 'reconcileReviewRange');
  try {
    const view = render(<ReviewSuggestionsPanel {...input} state={state} />);
    expect(screen.getAllByRole('article', { name: /^Suggestion / })).toHaveLength(100);
    expect(align.mock.calls.filter(([, current]) => current === input.current.paragraphs[0].text)).toHaveLength(1);

    const current = structuredClone(input.current);current.paragraphs[0].text += ' Later.';
    align.mockClear();view.rerender(<ReviewSuggestionsPanel {...input} state={state} current={current} />);
    expect(align.mock.calls.filter(([, context]) => context === current.paragraphs[0].text)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Accept suggestion' }).every(button => button.hasAttribute('disabled'))).toBe(true);
  } finally { align.mockRestore(); }
});

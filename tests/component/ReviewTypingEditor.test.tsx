import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReviewSuggestionsPanel } from '@/components/editor/ReviewSuggestionsPanel';
import { createSelectedTextSuggestion, emptyReviewSuggestionState, REVIEW_SUGGESTION_LIMITS } from '@/lib/reviewSuggestions';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
function fixture(text = 'Keep Alpha Alpha ending.') {
  const current = createBlankSession();current.paragraphs = [{ id: 'typed-body', text, level: 0 }, { id: 'unsupported', text: '{{value}}', level: 0 }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 1,
    label: 'Typing', sourceDocumentId: 'source', ownerDocumentId: 'source', baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session: structuredClone(current) } };
  return { current, round, state: emptyReviewSuggestionState(round), owner: false, busy: false, onCreate: vi.fn().mockResolvedValue(true), onDecide: vi.fn(), onDraftChange: vi.fn() };
}
async function open(input = fixture()) {
  const view = render(<ReviewSuggestionsPanel {...input} />);
  await userEvent.type(screen.getByLabelText('Reviewer name for suggestion'), 'Synthetic');
  await userEvent.click(screen.getByRole('button', { name: 'Suggest Changes mode' }));
  await userEvent.selectOptions(screen.getByLabelText('Paragraph for suggested typing'), 'typed-body');
  return { input, view, editor: screen.getByRole('textbox', { name: 'Suggested paragraph text' }) as HTMLTextAreaElement };
}
function select(editor: HTMLTextAreaElement, start: number, end = start) { editor.focus();editor.setSelectionRange(start, end);fireEvent.select(editor); }
function ime(editor: HTMLTextAreaElement, value: string) {
  fireEvent.compositionStart(editor);fireEvent.change(editor, { target: { value } });fireEvent.compositionEnd(editor);
}
it('keeps mode off by default and ordinary replacement editing unchanged', async () => {
  const input = fixture();render(<ReviewSuggestionsPanel {...input} />);
  expect(screen.getByRole('button', { name: 'Suggest Changes mode' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('textbox', { name: 'Suggested paragraph text' })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Suggestion target'), 'paragraph:typed-body');
  await userEvent.type(screen.getByLabelText('Proposed replacement'), ' More.');
  expect(input.current.paragraphs[0].text).toBe('Keep Alpha Alpha ending.');expect(input.onCreate).not.toHaveBeenCalled();
});
it('captures natural caret typing as one insertion, preserves cursor and saves exactly once without changing baseline', async () => {
  const { input, editor } = await open();select(editor, 11);
  await userEvent.keyboard('new ');
  expect(editor).toHaveValue('Keep Alpha new Alpha ending.');expect(editor.selectionStart).toBe(15);
  expect(screen.getByText('Unsaved suggested changes · Insertion')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Suggest Changes mode' })).toBeDisabled();expect(screen.getByLabelText('Paragraph for suggested typing')).toBeDisabled();
  expect(input.onCreate).not.toHaveBeenCalled();expect(input.onDraftChange).toHaveBeenLastCalledWith(true);
  await userEvent.click(screen.getByRole('button', { name: 'Save typed suggestion' }));
  expect(input.onCreate).toHaveBeenCalledTimes(1);expect(input.onCreate.mock.calls[0][0].changes[0]).toMatchObject({ expected: '', proposed: 'new ', target: { start: 11, end: 11 } });
  expect(input.current.paragraphs[0].text).toBe('Keep Alpha Alpha ending.');expect(editor).toHaveValue('Keep Alpha Alpha ending.');
  expect(screen.queryByRole('button', { name: 'Accept suggestion' })).not.toBeInTheDocument();await waitFor(() => expect(input.onDraftChange).toHaveBeenLastCalledWith(false));
});
it('captures repeated-character location rather than guessing a matching occurrence', async () => {
  const { input, editor } = await open(fixture('aaaa'));select(editor, 2);await userEvent.keyboard('a');
  await userEvent.click(screen.getByRole('button', { name: 'Save typed suggestion' }));
  expect(input.onCreate.mock.calls[0][0].changes[0]).toMatchObject({ target: { start: 2, end: 2 }, proposed: 'a' });
});
it('captures Backspace, Delete and selected deletion as complete graphemes; cancellation restores the draft', async () => {
  const { input, editor } = await open(fixture('A 👩🏽‍✈️ é Z'));select(editor, 9);await userEvent.keyboard('{Backspace}');
  expect(editor).toHaveValue('A  é Z');expect(editor.selectionStart).toBe(2);expect(screen.getByText('Unsaved suggested changes · Deletion')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel typed changes' }));
  select(editor, 2);await userEvent.keyboard('{Delete}');expect(editor).toHaveValue('A  é Z');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel typed changes' }));
  select(editor, 2, 9);await userEvent.keyboard('{Backspace}');expect(editor).toHaveValue('A  é Z');
  expect(input.onCreate).not.toHaveBeenCalled();
});
it('handles mobile beforeinput deletion without keydown', async () => {
  const { editor } = await open(fixture('A 👩🏽‍✈️ Z'));select(editor, 9);
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' });
  act(() => { editor.dispatchEvent(event); });expect(event.defaultPrevented).toBe(true);expect(editor).toHaveValue('A  Z');
});
it('pastes plain text and commits an IME sequence together while preserving earlier edits', async () => {
  const { input, editor } = await open();select(editor, 11, 16);
  fireEvent.paste(editor, { clipboardData: { getData: () => 'Équipe 👩🏽‍✈️' } });
  select(editor, 0);ime(editor, '日本語Keep Alpha Équipe 👩🏽‍✈️ ending.');
  expect(editor).toHaveValue('日本語Keep Alpha Équipe 👩🏽‍✈️ ending.');
  expect(screen.getByText('Unsaved suggested changes · Replacement')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Save typed suggestion' }));
  expect(input.onCreate).toHaveBeenCalledTimes(1);expect(input.onCreate.mock.calls[0][0].changes[0]).toMatchObject({ target: { start: 0, end: 16 }, expected: 'Keep Alpha Alpha', proposed: '日本語Keep Alpha Équipe 👩🏽‍✈️' });
});
it('retains the last valid draft after unsupported paste, incomplete character edits, IME or structural operations', async () => {
  const { editor, input } = await open();select(editor, 0);await userEvent.keyboard('Good ');
  for (const value of ['bad\nline', '{{variable}}', '**bold**', 'x'.repeat(20_001)]) {
    select(editor, 0);fireEvent.paste(editor, { clipboardData: { getData: () => value } });expect(editor).toHaveValue('Good Keep Alpha Alpha ending.');
  }
  fireEvent.paste(editor, { clipboardData: { types: ['text/html', 'text/plain'], getData: (type: string) => type === 'text/html' ? '<b>Rich</b>' : 'Rich' } });expect(editor).toHaveValue('Good Keep Alpha Alpha ending.');
  select(editor, 0);ime(editor, 'bad\nGood Keep Alpha Alpha ending.');expect(editor).toHaveValue('Good Keep Alpha Alpha ending.');
  await userEvent.keyboard('{Enter}');expect(screen.getByRole('alert')).toHaveTextContent('unsupported');expect(input.onCreate).not.toHaveBeenCalled();
});
it('does not save during IME and retains unsaved text across a storage failure or double click', async () => {
  const { input, editor } = await open();select(editor, 0);fireEvent.compositionStart(editor);fireEvent.change(editor, { target: { value: '日本Keep Alpha Alpha ending.' } });
  expect(screen.getByRole('button', { name: 'Save typed suggestion' })).toBeDisabled();fireEvent.compositionEnd(editor);
  let fail!: (cause: Error) => void;input.onCreate.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  await userEvent.dblClick(screen.getByRole('button', { name: 'Save typed suggestion' }));expect(input.onCreate).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error('Storage quota reached.')));expect(screen.getByRole('alert')).toHaveTextContent('quota');expect(editor).toHaveValue('日本Keep Alpha Alpha ending.');
  await userEvent.click(screen.getByRole('button', { name: 'Save typed suggestion' }));expect(input.onCreate).toHaveBeenCalledTimes(2);
});
it('excludes unsupported paragraphs, blocks stale targets and refuses quota-full editing', async () => {
  const { input, editor, view } = await open();expect(screen.getByRole('option', { name: /unsupported content/ })).toBeDisabled();
  select(editor, 0);await userEvent.keyboard('New ');
  const current = structuredClone(input.current);current.paragraphs[0].text += ' Newer.';view.rerender(<ReviewSuggestionsPanel {...input} current={current} />);
  expect(editor).toBeDisabled();expect(screen.getByRole('button', { name: 'Save typed suggestion' })).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('differs');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel typed changes' }));expect(input.onCreate).not.toHaveBeenCalled();
  view.rerender(<ReviewSuggestionsPanel {...input} state={{ ...input.state, proposals: Array.from({ length: REVIEW_SUGGESTION_LIMITS.proposals }, () => createSelectedTextSuggestion(input.round, { author: 'Synthetic', paragraphId: 'typed-body', start: 0, end: 0, proposed: 'New ' })) }} />);
  expect(screen.getByRole('button', { name: 'Save typed suggestion' })).toBeDisabled();
});

it('refuses selections that split a character and still permits cancellation when the proposal quota changes', async () => {
  const { editor, input, view } = await open(fixture('A 👩🏽‍✈️ Z'));
  select(editor, 3, 4);await userEvent.keyboard('{Backspace}');
  expect(editor).toHaveValue('A 👩🏽‍✈️ Z');expect(screen.getByRole('alert')).toHaveTextContent('complete characters');
  select(editor, 0);await userEvent.keyboard('New ');
  const proposals = Array.from({ length: REVIEW_SUGGESTION_LIMITS.proposals }, () => createSelectedTextSuggestion(input.round, { author: 'Synthetic', paragraphId: 'typed-body', start: 0, end: 0, proposed: 'Earlier ' }));
  view.rerender(<ReviewSuggestionsPanel {...input} state={{ ...input.state, proposals }} />);
  expect(editor).toBeDisabled();expect(screen.getByRole('button', { name: 'Save typed suggestion' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel typed changes' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel typed changes' }));expect(editor).toHaveValue('A 👩🏽‍✈️ Z');expect(input.onCreate).not.toHaveBeenCalled();
});

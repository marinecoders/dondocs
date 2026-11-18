import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageIntakeQuestions } from '@/components/PackageIntakeQuestions';
import { freshPackageTemplateAnswers } from '@/lib/conditionalIntakeView';
import type { PackageTemplateAnswers, PackageTemplateProgram } from '@/lib/packageTemplateProgram';

const program: PackageTemplateProgram = { revision: '1', requirements: [], participantGroups: [{ id: 'people', label: 'Participants', role: 'subject', min: 1, max: 2 }], questions: [
  { id: 'subject', label: 'Subject', kind: 'text', required: true }, { id: 'include', label: 'Include details?', kind: 'boolean', required: true },
  { id: 'details', label: 'Details', kind: 'text', required: true, when: { op: 'equals', questionId: 'include', value: true } },
  { id: 'name', label: 'Name', kind: 'text', required: true, groupId: 'people' },
] };
function Harness({ source = program, initial, disabled = false, capture }: { source?: PackageTemplateProgram; initial?: PackageTemplateAnswers; disabled?: boolean; capture?(value: PackageTemplateAnswers): void }) {
  const [answers, setAnswers] = useState(() => initial ?? freshPackageTemplateAnswers(source));
  return <PackageIntakeQuestions program={source} answers={answers} disabled={disabled} onChange={value => { capture?.(value); setAnswers(value); }} />;
}

it('keeps an edited question visible and distinguishes an unanswered boolean from No', async () => {
  const capture = vi.fn(), user = userEvent.setup(); render(<Harness capture={capture} />);
  const subject = screen.getByLabelText('Subject', { exact: true });
  await user.type(subject, 'Keep this entire answer'); expect(subject).toHaveValue('Keep this entire answer');
  const include = screen.getByLabelText('Include details?', { exact: true }); expect(include).toHaveValue('');
  expect(screen.queryByLabelText('Details', { exact: true })).not.toBeInTheDocument();
  await user.selectOptions(include, 'false'); expect(capture.mock.lastCall![0].values.include).toBe(false);
  await user.selectOptions(include, 'true');
  const details = screen.getByLabelText('Details', { exact: true }); await user.type(details, 'Only relevant when included');
  expect(details).toHaveValue('Only relevant when included');
});

it('reorders people without moving answers and tolerates an unfinished label edit', async () => {
  const answers = freshPackageTemplateAnswers(program);
  answers.groups.people = [{ id: 'alpha', label: 'Same', answers: { name: 'Alpha' } }, { id: 'bravo', label: 'Same', answers: { name: 'Bravo' } }];
  const capture = vi.fn(), user = userEvent.setup(); render(<Harness initial={answers} capture={capture} />);
  await user.click(screen.getByRole('button', { name: 'Show answered questions' }));
  await user.click(screen.getByRole('button', { name: 'Move Participants · person 2 · Same up' }));
  expect(capture.mock.lastCall![0].groups.people.map((person: { id: string }) => person.id)).toEqual(['bravo', 'alpha']);
  expect(screen.getByLabelText('Participants · person 1 · Same · Name', { exact: true })).toHaveValue('Bravo');
  const label = screen.getByLabelText('Participants person 1 label', { exact: true }); await user.clear(label);
  expect(label).toHaveValue(''); expect(screen.getByText('Participants person 1 needs a single-line label.')).toBeVisible();
  await user.type(label, 'Current owner'); expect(screen.getByLabelText('Participants · person 1 · Current owner · Name', { exact: true })).toHaveValue('Bravo');
  await user.click(screen.getByRole('button', { name: 'Remove Participants · person 2 · Same' }));
  expect(capture.mock.lastCall![0].groups.people).toEqual([{ id: 'bravo', label: 'Current owner', answers: { name: 'Bravo' } }]);
  expect(screen.getByRole('button', { name: 'Add person to Participants' })).toHaveFocus();
});

it('allows read-only answer inspection while keeping edits disabled', async () => {
  const answers = freshPackageTemplateAnswers(program); answers.values.subject = 'Saved subject'; answers.values.include = false;
  render(<Harness initial={answers} disabled />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show answered questions' }));
  expect(screen.getByLabelText('Subject', { exact: true })).toHaveValue('Saved subject');
  expect(screen.getByLabelText('Subject', { exact: true })).toBeDisabled();
});

it('associates an invalid required date with its visible validation message and clears the error after correction', async () => {
  const source: PackageTemplateProgram = { revision: '1', participantGroups: [], requirements: [],
    questions: [{ id: 'date', label: 'Request date', kind: 'date', required: true }] };
  render(<Harness source={source} initial={{ version: 1, values: { date: '2026-02-30' }, groups: {} }} />);
  const date = screen.getByRole('textbox', { name: 'Request date' });
  expect(date).toHaveAttribute('aria-required', 'true');
  expect(date).toHaveAttribute('aria-invalid', 'true');
  expect(date).toHaveAccessibleDescription('Enter a valid date value.');
  expect(document.getElementById(date.getAttribute('aria-describedby')!)).toBeVisible();
  const user = userEvent.setup(); await user.clear(date); await user.type(date, '2026-11-17');
  expect(date).toHaveValue('2026-11-17'); expect(date).not.toHaveAttribute('aria-invalid');
  expect(date).not.toHaveAttribute('aria-describedby');
  expect(screen.queryByText('Enter a valid date value.')).toBeNull();
});

it('bounds a large question list and keeps values across its pages', async () => {
  const source: PackageTemplateProgram = { revision: '1', participantGroups: [], requirements: [],
    questions: Array.from({ length: 100 }, (_, index) => ({ id: `question_${index}`, label: `Question ${index + 1}`, kind: 'text', required: true })) };
  const user = userEvent.setup(); render(<Harness source={source} />);
  expect(screen.getAllByRole('textbox')).toHaveLength(26);
  await user.type(screen.getByLabelText('Question 1', { exact: true }), 'First page value');
  await user.click(screen.getByRole('button', { name: 'Next questions' }));
  expect(screen.queryByLabelText('Question 1', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText('Questions 26–50 of 100')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Previous questions' }));
  expect(screen.getByLabelText('Question 1', { exact: true })).toHaveValue('First page value');
});

import { expect, it } from 'vitest';
import { freshPackageTemplateAnswers, intakeAttachmentSlots, intakeQuestionKey, intakeQuestions, withIntakeAnswer } from '@/lib/conditionalIntakeView';
import { packageTemplateAnswersSchema, type PackageTemplateProgram } from '@/lib/packageTemplateProgram';
import { maintainedPackageAction } from '@/lib/maintainedPackageActions';
import { packageTemplateInstanceKey } from '@/lib/packageConditionalState';

const program: PackageTemplateProgram = { revision: '1', requirements: [], participantGroups: [{ id: 'people', label: 'Participants', role: 'subject', min: 1, max: 2 }],
  questions: [{ id: 'include', label: 'Include details?', kind: 'boolean', required: true },
    { id: 'details', label: 'Details', kind: 'text', required: true, when: { op: 'equals', questionId: 'include', value: true } },
    { id: 'name', label: 'Name', kind: 'text', required: true, groupId: 'people' }] };

it('starts each action with fresh participant identities and no personal or boolean defaults', () => {
  const first = freshPackageTemplateAnswers(program), second = freshPackageTemplateAnswers(program);
  expect(first.values).toEqual({}); expect(first.groups.people[0].answers).toEqual({});
  expect(first.groups.people[0].id).not.toBe(second.groups.people[0].id);
  first.groups.people[0].label = 'Edited locally'; expect(second.groups.people[0].label).toBe('Participants 1');
  const unanswered = intakeQuestions(program, first);
  expect(unanswered.questions.find(item => item.question.id === 'include')?.instance.answered).toBe(false);
  expect(unanswered.questions.find(item => item.question.id === 'details')?.instance.visibility).toBe('unknown');
  const answered = withIntakeAnswer(first, { questionId: 'include' }, false);
  expect(answered.values.include).toBe(false);
  expect(intakeQuestions(program, answered).questions.find(item => item.question.id === 'details')?.instance.visibility).toBe(false);
  expect(first.values).toEqual({});
});

it('keeps field identities and answers with their owner when identically labeled people move', () => {
  const answers = freshPackageTemplateAnswers(program);
  answers.groups.people = [{ id: 'alpha', label: 'Same label', answers: { name: 'Alpha' } }, { id: 'bravo', label: 'Same label', answers: { name: 'Bravo' } }];
  const before = intakeQuestions(program, answers).questions.filter(item => item.question.id === 'name');
  expect(before[0].label).toContain('person 1'); expect(before[1].label).toContain('person 2');
  const reordered = structuredClone(answers); reordered.groups.people.reverse();
  const after = intakeQuestions(program, reordered).questions.filter(item => item.question.id === 'name');
  expect(after.map(item => item.instance.value)).toEqual(['Bravo', 'Alpha']);
  expect(intakeQuestionKey(after[1].instance)).toBe(intakeQuestionKey(before[0].instance));
  expect(new Set(after.map(item => item.label)).size).toBe(2);
});

it('lets an empty label be edited without storing a display fallback as a real participant', () => {
  const answers = freshPackageTemplateAnswers(program); answers.groups.people[0].label = '';
  const view = intakeQuestions(program, answers);
  expect(view.invalidLabels).toHaveLength(1); expect(view.questions.find(item => item.instance.scope)?.label).toContain('Unnamed person');
  expect(answers.groups.people[0].label).toBe(''); expect(packageTemplateAnswersSchema.safeParse(answers).success).toBe(false);
});

it('shows only active attachment slots using the materializer logical identities', async () => {
  const template = await maintainedPackageAction('administrative-request'), answers = freshPackageTemplateAnswers(template.program);
  expect(intakeAttachmentSlots(template, answers)).toEqual([]);
  answers.values.supportingEvidence = false; expect(intakeAttachmentSlots(template, answers)).toEqual([]);
  answers.values.supportingEvidence = true;
  expect(intakeAttachmentSlots(template, answers)).toEqual([{ key: packageTemplateInstanceKey('supporting-record'), label: 'Supporting PDF', required: true }]);
});
